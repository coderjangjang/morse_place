// Vercel Serverless Function: GET/POST /api/messages (위치: api/messages.js)
// 저장소: Redis (REDIS_URL) / 관리자: 환경변수 ADMIN_PASSWORD

const { createClient } = require('redis');
const crypto = require('crypto');


// 설정
const KEEP_MESSAGES = 200;            // 방마다 최근 N개만 보관
const ROOM_TTL = 60 * 60 * 24 * 7;    // 7일 지나면 방 자동 삭제
const MAX_TIMEOUT_MIN = 60 * 24 * 7;  // 타임아웃 최대 7일
const LANGS = ['en', 'ko'];           // 메시지 언어 (영문 / 한글)

// 도배 제한 (IP 기준): win초 동안 max개 초과하면 block초 동안 전송 차단
const RATE_TIERS = [
  { win: 10,  max: 8,  block: 30 },
  { win: 600, max: 80, block: 300 },
];

// 관리자 로그인 실패 5회 → 10분 잠금
const AUTH_MAX_FAIL = 5;
const AUTH_WINDOW = 600;

const REDIS_URL = process.env.REDIS_URL ||
  process.env[Object.keys(process.env).find(k => /REDIS_URL$/.test(k)) || ''];


// Redis 연결
let client = null;
let connecting = null;

async function getClient() {
  if (client && client.isOpen) return client;
  if (!connecting) {
    client = createClient({
      url: REDIS_URL,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
    });
    client.on('error', () => {});
    connecting = client.connect().finally(() => { connecting = null; });
  }
  await connecting;
  return client;
}


// 공통 도구
const isValidRoom = s => typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();

function isAdmin(key) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || typeof key !== 'string' || !key) return false;
  return crypto.timingSafeEqual(sha256(key), sha256(password));
}

const getIp = req =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.headers['x-real-ip'] ||
  (req.socket && req.socket.remoteAddress) ||
  '?';

const isStorageFull = e => /OOM|maxmemory|max memory|used memory|quota/i.test(String((e && e.message) || ''));

const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
const nameKey = (room, name) => `nm:${room}:${name.toLowerCase()}`;   // 이름 → 마지막 IP


// 메시지 삭제 도구
const parseMessage = s => { try { return JSON.parse(s); } catch { return null; } };

// 보낸 사람 확인용 해시 (IP 원본은 저장하지 않고, 클라이언트에도 내려주지 않음)
const ownerHash = ip => crypto.createHash('sha256').update('own:' + REDIS_URL + ip).digest('hex').slice(0, 16);

// 목록에서 해당 메시지들을 지우고 삭제 횟수(rev)를 올려 다른 기기에 알림
async function removeMessages(r, room, rawList) {
  let removed = 0;
  for (const raw of rawList) removed += await r.lRem('m:' + room, 1, raw);
  if (removed) {
    await r.incr('rv:' + room);
    await r.expire('rv:' + room, ROOM_TTL);
  }
  return removed;
}


// 관리자 인증 (실패 횟수 제한 포함)
// 'ok' | 'wrong' | { rate: 남은초 }
async function checkAuth(r, ip, key) {
  const failKey = 'af:' + ip;
  const fails = parseInt(await r.get(failKey), 10) || 0;

  if (fails >= AUTH_MAX_FAIL) {
    const ttl = await r.ttl(failKey);
    return { rate: ttl > 0 ? ttl : AUTH_WINDOW };
  }
  if (isAdmin(key)) return 'ok';

  const count = await r.incr(failKey);
  if (count === 1) await r.expire(failKey, AUTH_WINDOW);
  return 'wrong';
}


// 관리자 명령어: /ban 이름 · /timeout 분 이름 · /unban 이름
// 이름으로 IP 찾기: 최근 메시지 기록 → 없으면 밴 목록에서
async function findIp(r, room, name) {
  const ip = await r.get(nameKey(room, name));
  if (ip) return ip;
  const bans = await r.hGetAll('bans');
  return Object.keys(bans).find(k => String(bans[k]).toLowerCase() === name.toLowerCase()) || null;
}

const notFound = (name, withHint) => ({
  status: 404,
  msg: `'${name}' 사용자를 찾지 못했어요` + (withHint ? ' (이 방에서 최근 7일 안에 보낸 기록이 필요해요)' : ''),
});

async function runCommand(r, room, adminIp, text) {
  const input = String(text || '').trim();
  const usage = {
    status: 400,
    msg: '사용법: /ban 이름 · /timeout 분 이름 · /unban 이름 · /chatdel all|숫자|이름',
  };
  let match;

  // 차단
  if ((match = input.match(/^\/ban\s+(.+)$/i))) {
    const name = cleanName(match[1]);
    const ip = name && await findIp(r, room, name);
    if (!ip) return notFound(name, true);
    if (ip === adminIp) return { status: 400, msg: '자기 자신(같은 IP)은 차단할 수 없어요' };

    await r.hSet('bans', ip, name);
    return { status: 200, msg: `${name} 님을 차단했어요 (/unban ${name} 으로 해제)` };
  }

  // 타임아웃
  if ((match = input.match(/^\/timeout\s+(\d+)\s+(.+)$/i))) {
    const minutes = Math.min(parseInt(match[1], 10), MAX_TIMEOUT_MIN);
    const name = cleanName(match[2]);
    if (minutes < 1 || !name) return usage;

    const ip = await findIp(r, room, name);
    if (!ip) return notFound(name, true);
    if (ip === adminIp) return { status: 400, msg: '자기 자신(같은 IP)은 제한할 수 없어요' };

    await r.set('to:' + ip, '1', { EX: minutes * 60 });
    return { status: 200, msg: `${name} 님을 ${minutes}분 동안 타임아웃했어요` };
  }

  // 해제
  if ((match = input.match(/^\/unban\s+(.+)$/i))) {
    const name = cleanName(match[1]);
    const ip = name && await findIp(r, room, name);
    if (!ip) return notFound(name, false);

    await r.hDel('bans', ip);
    await r.del('to:' + ip);
    return { status: 200, msg: `${name} 님의 차단/타임아웃을 해제했어요` };
  }

  // 메시지 삭제: all(방 전체) · 숫자(최근 N개) · 이름(그 사람 메시지)
  if ((match = input.match(/^\/chatdel\s+(.+)$/i))) {
    const arg = match[1].trim();
    const raw = await r.lRange('m:' + room, 0, -1);
    let targets;

    if (/^all$/i.test(arg)) {
      targets = raw;
    } else if (/^\d+$/.test(arg)) {
      const count = parseInt(arg, 10);
      if (count < 1) return usage;
      targets = raw.slice(-count);
    } else {
      const name = cleanName(arg).toLowerCase();
      targets = raw.filter(s => (parseMessage(s) || {}).name?.toLowerCase() === name);
    }

    const removed = await removeMessages(r, room, targets);
    return { status: 200, msg: removed ? `메시지 ${removed}개를 삭제했어요` : '삭제할 메시지가 없어요' };
  }

  return usage;
}


// 전송 제한 확인 (차단 · 타임아웃 · 도배)
// 막혀 있으면 { status, body }, 통과하면 null
async function checkSendLimits(r, ip) {
  if (await r.hExists('bans', ip)) return { status: 403, body: { error: 'banned' } };

  const timeoutLeft = await r.ttl('to:' + ip);
  if (timeoutLeft > 0) return { status: 429, body: { error: 'timeout', retryAfter: timeoutLeft } };

  const blockLeft = await r.ttl('blk:' + ip);
  if (blockLeft > 0) return { status: 429, body: { error: 'rate', retryAfter: blockLeft } };

  for (const tier of RATE_TIERS) {
    const key = `rl:${tier.win}:${ip}`;
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, tier.win);

    if (count > tier.max) {
      await r.set('blk:' + ip, '1', { EX: tier.block });
      return { status: 429, body: { error: 'rate', retryAfter: tier.block } };
    }
  }
  return null;
}


// GET: 메시지 목록
async function handleGet(r, req, res) {
  const room = String(req.query.room || '');
  const since = parseInt(req.query.since, 10) || 0;
  if (!isValidRoom(room)) return res.status(400).json({ error: 'bad-room' });

  // 삭제 횟수를 먼저 읽어야 목록이 더 최신이어도 다음 요청에서 다시 맞춰짐
  const rev = parseInt(await r.get('rv:' + room), 10) || 0;
  const all = (await r.lRange('m:' + room, -100, -1)).map(parseMessage).filter(Boolean);

  // 보낸 사람 해시(h)는 내려주지 않음
  const msgs = all.filter(m => m.id > since).map(({ h, ...rest }) => rest);
  const out = { msgs, rev };

  // 삭제가 있었으면 남아 있는 메시지 목록을 같이 보내서 클라이언트가 정리
  if (String(req.query.rev) !== String(rev)) {
    out.cids = all.map(m => m.cid);
    out.from = all.length ? all[0].id : 0;
  }
  return res.status(200).json(out);
}


// POST: 내 메시지 삭제 (보낸 사람 확인은 IP 해시, 관리자 메시지는 관리자만)
async function handleDelete(r, res, body, ip) {
  if (!isValidRoom(body.room)) return res.status(400).json({ error: 'bad-room' });
  const cid = String(body.cid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  if (!cid) return res.status(400).json({ error: 'bad-request' });

  const raw = (await r.lRange('m:' + body.room, 0, -1)).find(s => (parseMessage(s) || {}).cid === cid);
  if (!raw) return res.status(404).json({ error: 'not-found' });

  const msg = parseMessage(raw);
  const admin = isAdmin(body.key);
  const isOwner = msg.h && msg.h === ownerHash(ip);
  if (!admin && (!isOwner || msg.admin)) return res.status(403).json({ error: 'forbidden' });

  await removeMessages(r, body.room, [raw]);
  return res.status(200).json({ ok: true });
}


// POST: 관리자 로그인 확인
async function handleAuth(r, res, body, ip) {
  if (!process.env.ADMIN_PASSWORD) return res.status(501).json({ error: 'no-admin' });

  const auth = await checkAuth(r, ip, body.key);
  if (auth === 'ok') return res.status(200).json({ ok: true });
  if (auth === 'wrong') return res.status(401).json({ error: 'wrong' });
  return res.status(429).json({ error: 'rate', retryAfter: auth.rate });
}


// POST: 관리자 명령어
async function handleCommand(r, res, body, ip) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(501).json({ error: 'no-admin', msg: '서버에 관리자 비밀번호가 없어요' });
  }
  if (!isValidRoom(body.room)) {
    return res.status(400).json({ error: 'bad-room', msg: '방 이름이 올바르지 않아요' });
  }

  const auth = await checkAuth(r, ip, body.key);
  if (auth === 'wrong') {
    return res.status(401).json({ error: 'wrong', msg: '관리자 인증이 풀렸어요' });
  }
  if (auth !== 'ok') {
    return res.status(429).json({
      error: 'rate',
      retryAfter: auth.rate,
      msg: `인증 실패가 너무 많아요. ${auth.rate}초 뒤에 다시 시도하세요`,
    });
  }

  const out = await runCommand(r, body.room, ip, body.text);
  return res.status(out.status).json({ ok: out.status === 200, msg: out.msg });
}


// POST: 메시지 전송
async function handleSend(r, res, body, ip) {
  const room = body.room;
  const morse = String(body.morse || '').replace(/[^.\-\/ ]/g, '').replace(/[ /]+$/, '').trim().slice(0, 400);
  const cid = String(body.cid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
  const lang = LANGS.includes(body.lang) ? body.lang : 'en';   // 해독에 쓸 언어
  if (!isValidRoom(room) || !morse || !cid) return res.status(400).json({ error: 'bad-request' });

  const admin = isAdmin(body.key);
  let name = cleanName(body.name || 'OP') || 'OP';
  if (!admin && /admin|관리자|운영자/i.test(name)) name = 'OP';   // 관리자 사칭 방지

  // 관리자는 밴 · 타임아웃 · 도배 제한 없음
  if (!admin) {
    const blocked = await checkSendLimits(r, ip);
    if (blocked) return res.status(blocked.status).json(blocked.body);
  }

  const id = await r.incr('s:' + room);
  const msg = { id, cid, name, morse, lang, t: Date.now(), h: ownerHash(ip) };
  if (admin) msg.admin = true;

  const tx = r.multi()
    .rPush('m:' + room, JSON.stringify(msg))
    .lTrim('m:' + room, -KEEP_MESSAGES, -1)
    .expire('m:' + room, ROOM_TTL)
    .expire('s:' + room, ROOM_TTL);
  if (!admin) tx.set(nameKey(room, name), ip, { EX: ROOM_TTL });   // /ban · /timeout 대상 찾기용
  await tx.exec();

  return res.status(200).json({ ok: true, id });
}


// POST: 요청 종류별로 나누기
async function handlePost(r, req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const ip = getIp(req);

  if (body.action === 'auth') return handleAuth(r, res, body, ip);
  if (body.action === 'cmd') return handleCommand(r, res, body, ip);
  if (body.action === 'del') return handleDelete(r, res, body, ip);
  return handleSend(r, res, body, ip);
}


// 진입점
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL) return res.status(503).json({ error: 'no-storage' });

  try {
    const r = await getClient();

    if (req.method === 'GET') return await handleGet(r, req, res);
    if (req.method === 'POST') return await handlePost(r, req, res);

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    // 저장 용량 부족
    if (isStorageFull(e)) {
      res.setHeader('Retry-After', '60');
      return res.status(503).json({ error: 'full', retryAfter: 60 });
    }
    return res.status(500).json({ error: 'server' });
  }
};
