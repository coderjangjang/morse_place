// Vercel Serverless Function: GET/POST /api/messages (위치: api/messages.js)
// 저장소: Redis (REDIS_URL) / 관리자: 환경변수 ADMIN_PASSWORD

const { createClient } = require('redis');
const crypto = require('crypto');


// 설정
const KEEP_MESSAGES = 200;            // 방마다 최근 N개만 보관
const ROOM_TTL = 60 * 60 * 24 * 7;    // 7일 지나면 방 자동 삭제
const MAX_TIMEOUT_MIN = 60 * 24 * 7;  // 타임아웃 최대 7일
const MAX_SLOW_SEC = 3600;            // 슬로우 모드 최대 1시간
const NOTICE_MAX = 200;               // 공지 최대 글자 수
const LANGS = ['en', 'ko'];           // 메시지 언어 (영문 / 한글)
const TYPING_TTL_MS = 4000;           // 입력 중 표시 유지 시간
const PRESENCE_MS = 30000;            // 이 시간 안에 요청이 있으면 접속 중
const ADMIN_TOKEN_TTL = ROOM_TTL;     // 관리자 로그인 유지 기간
const LOG_KEEP = 100;                 // 관리자 로그 보관 개수

// 도배 제한 (IP 기준): win초 동안 max개 초과하면 block초 동안 전송 차단
const RATE_TIERS = [
  { win: 10,  max: 8,  block: 30 },
  { win: 600, max: 80, block: 300 },
];

// 관리자 로그인 실패 5회 → 10분 잠금
const AUTH_MAX_FAIL = 5;
const AUTH_WINDOW = 600;

const USAGE =
  '명령어: /ban 이름 · /unban 이름 · /timeout 분 이름 · /chatdel all|숫자|이름 · ' +
  '/close · /open · /slow 초(0=끄기) · /notice 내용|off · /banlist · /timeoutlist · /log [개수]';

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
const parseJson = s => { try { return JSON.parse(s); } catch { return null; } };

const getIp = req =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.headers['x-real-ip'] ||
  (req.socket && req.socket.remoteAddress) ||
  '?';

const isStorageFull = e => /OOM|maxmemory|max memory|used memory|quota/i.test(String((e && e.message) || ''));

const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
const cleanId = s => String(s || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
const nameKey = (room, name) => `nm:${room}:${name.toLowerCase()}`;   // 이름 → 마지막 IP

// 관리자 사칭 방지
function pickName(raw, admin) {
  let name = cleanName(raw || 'OP') || 'OP';
  if (!admin && /admin|관리자|운영자/i.test(name)) name = 'OP';
  return name;
}

// 보낸 사람 확인용 해시 (원본 ID/IP는 저장하지 않고, 클라이언트에도 내려주지 않음)
// 기기 고유 ID(uid)가 있으면 그걸 쓰고, 없으면 IP로 대신함
const ownerHash = id => crypto.createHash('sha256').update('own:' + REDIS_URL + id).digest('hex').slice(0, 16);
const ownerOf = (uid, ip) => ownerHash(uid ? 'u:' + uid : 'ip:' + ip);

const fmtTime = t => new Date(t).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});


// 관리자 인증 (비밀번호로 로그인 → 토큰 발급, 이후 요청은 토큰만 사용)
function passwordOk(key) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || typeof key !== 'string' || !key) return false;
  return crypto.timingSafeEqual(sha256(key), sha256(password));
}

const tokenKey = token => 'at:' + crypto.createHash('sha256').update(token).digest('hex');

async function isAdmin(r, token) {
  if (!process.env.ADMIN_PASSWORD) return false;
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return false;
  return (await r.exists(tokenKey(token))) === 1;
}

// 로그인 (실패 횟수 제한 포함)
// { token } | 'wrong' | { rate: 남은초 }
async function loginAdmin(r, ip, password) {
  const failKey = 'af:' + ip;
  const fails = parseInt(await r.get(failKey), 10) || 0;

  if (fails >= AUTH_MAX_FAIL) {
    const ttl = await r.ttl(failKey);
    return { rate: ttl > 0 ? ttl : AUTH_WINDOW };
  }
  if (passwordOk(password)) {
    await r.del(failKey);
    const token = crypto.randomBytes(24).toString('hex');
    await r.set(tokenKey(token), '1', { EX: ADMIN_TOKEN_TTL });
    return { token };
  }

  const count = await r.incr(failKey);
  if (count === 1) await r.expire(failKey, AUTH_WINDOW);
  return 'wrong';
}


// 방 상태 (닫힘 · 슬로우 모드 · 공지) — 해시 하나에 저장
const parseRoomState = h => ({
  closed: h.closed === '1',
  slow: parseInt(h.slow, 10) || 0,
  notice: h.notice || '',
});

async function getRoomState(r, room) {
  return parseRoomState(await r.hGetAll('rs:' + room));
}

async function setRoomField(r, room, field, value) {
  const key = 'rs:' + room;
  if (value == null) await r.hDel(key, field);
  else await r.hSet(key, field, String(value));
  await r.expire(key, ROOM_TTL);
}


// 관리자 로그 (전체 방 공통, 최근 N개)
const logAdmin = (r, room, text) =>
  r.multi()
    .lPush('lg', JSON.stringify({ t: Date.now(), room, text }))
    .lTrim('lg', 0, LOG_KEEP - 1)
    .exec();


// 메시지 삭제 도구
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


// 관리자 명령어
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
  const usage = { status: 400, msg: USAGE };
  let match;

  if (/^\/help$/i.test(input)) return { status: 200, msg: USAGE };

  // 채팅 닫기 / 열기
  if (/^\/close$/i.test(input)) {
    if ((await getRoomState(r, room)).closed) return { status: 409, msg: '이미 닫혀 있어요' };
    await setRoomField(r, room, 'closed', 1);
    return { status: 200, msg: '채팅을 닫았어요 (/open 으로 다시 열기)' };
  }
  if (/^\/open$/i.test(input)) {
    if (!(await getRoomState(r, room)).closed) return { status: 409, msg: '이미 열려 있어요' };
    await setRoomField(r, room, 'closed', null);
    return { status: 200, msg: '채팅을 다시 열었어요' };
  }

  // 슬로우 모드
  if ((match = input.match(/^\/slow\s+(\d+|off)$/i))) {
    const sec = /^off$/i.test(match[1]) ? 0 : Math.min(parseInt(match[1], 10), MAX_SLOW_SEC);
    await setRoomField(r, room, 'slow', sec > 0 ? sec : null);
    return { status: 200, msg: sec > 0 ? `슬로우 모드를 켰어요 (${sec}초에 한 번)` : '슬로우 모드를 껐어요' };
  }

  // 공지
  if ((match = input.match(/^\/notice\s+([\s\S]+)$/i))) {
    const body = match[1].replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NOTICE_MAX);
    if (!body) return usage;
    if (/^off$/i.test(body)) {
      await setRoomField(r, room, 'notice', null);
      return { status: 200, msg: '공지를 내렸어요' };
    }
    await setRoomField(r, room, 'notice', body);
    return { status: 200, msg: '공지를 등록했어요' };
  }

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
    await r.hSet('tos', ip, JSON.stringify({ name, until: Date.now() + minutes * 60000 }));   // /timeoutlist용
    return { status: 200, msg: `${name} 님을 ${minutes}분 동안 타임아웃했어요` };
  }

  // 해제
  if ((match = input.match(/^\/unban\s+(.+)$/i))) {
    const name = cleanName(match[1]);
    const ip = name && await findIp(r, room, name);
    if (!ip) return notFound(name, false);

    await r.hDel('bans', ip);
    await r.hDel('tos', ip);
    await r.del('to:' + ip);
    return { status: 200, msg: `${name} 님의 차단/타임아웃을 해제했어요` };
  }

  // 차단 목록
  if (/^\/banlist$/i.test(input)) {
    const names = Object.values(await r.hGetAll('bans'));
    return { status: 200, msg: names.length ? `차단된 사용자 (${names.length}명): ${names.join(', ')}` : '차단된 사용자가 없어요' };
  }

  // 타임아웃 목록
  if (/^\/timeoutlist$/i.test(input)) {
    const now = Date.now();
    const lines = [];
    for (const [ip, raw] of Object.entries(await r.hGetAll('tos'))) {
      const v = parseJson(raw);
      if (!v || v.until <= now) { await r.hDel('tos', ip); continue; }   // 끝난 항목은 정리
      lines.push(`${v.name} (${Math.ceil((v.until - now) / 60000)}분 남음)`);
    }
    return { status: 200, msg: lines.length ? '타임아웃 중:\n' + lines.join('\n') : '타임아웃 중인 사용자가 없어요' };
  }

  // 관리자 로그
  if ((match = input.match(/^\/log(?:\s+(\d+))?$/i))) {
    const count = Math.min(Math.max(parseInt(match[1], 10) || 10, 1), 30);
    const entries = (await r.lRange('lg', 0, count - 1)).map(parseJson).filter(Boolean);
    if (!entries.length) return { status: 200, msg: '기록이 없어요' };
    return { status: 200, msg: entries.map(e => `${fmtTime(e.t)} #${e.room} ${e.text}`).join('\n') };
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
      targets = raw.filter(s => (parseJson(s) || {}).name?.toLowerCase() === name);
    }

    const removed = await removeMessages(r, room, targets);
    return { status: 200, msg: removed ? `메시지 ${removed}개를 삭제했어요` : '삭제할 메시지가 없어요' };
  }

  return usage;
}


// 전송 제한 확인 (차단 · 타임아웃 · 슬로우 모드 · 도배)
// 막혀 있으면 { status, body }, 통과하면 null
async function checkSendLimits(r, ip, room, slowSec) {
  if (await r.hExists('bans', ip)) return { status: 403, body: { error: 'banned' } };

  const timeoutLeft = await r.ttl('to:' + ip);
  if (timeoutLeft > 0) return { status: 429, body: { error: 'timeout', retryAfter: timeoutLeft } };

  const blockLeft = await r.ttl('blk:' + ip);
  if (blockLeft > 0) return { status: 429, body: { error: 'rate', retryAfter: blockLeft } };

  // 슬로우 모드: 방마다 IP당 N초에 한 번
  if (slowSec > 0) {
    const slowKey = `sw:${room}:${ip}`;
    const ok = await r.set(slowKey, '1', { EX: slowSec, NX: true });
    if (!ok) {
      const left = await r.ttl(slowKey);
      return { status: 429, body: { error: 'slow', retryAfter: left > 0 ? left : slowSec } };
    }
  }

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


// GET: 메시지 목록 + 방 상태 + 입력 중 + 접속자 수
async function handleGet(r, req, res) {
  const room = String(req.query.room || '');
  const since = parseInt(req.query.since, 10) || 0;
  if (!isValidRoom(room)) return res.status(400).json({ error: 'bad-room' });

  const uid = cleanId(req.query.uid);
  const me = uid ? ownerOf(uid) : '';
  const now = Date.now();

  // 한 번에 읽기 (삭제 횟수를 목록과 같은 시점에 읽어야 어긋나지 않음)
  const tx = r.multi()
    .get('rv:' + room)
    .lRange('m:' + room, -100, -1)
    .hGetAll('rs:' + room)
    .zRemRangeByScore('ty:' + room, 0, now)          // 만료된 입력 중 표시 정리
    .zRange('ty:' + room, 0, -1)
    .zRemRangeByScore('on:' + room, 0, now - PRESENCE_MS);
  if (me) tx.zAdd('on:' + room, { score: now, value: me }).expire('on:' + room, 120);
  tx.zCard('on:' + room);

  const results = await tx.exec();
  const rev = parseInt(results[0], 10) || 0;
  const all = (results[1] || []).map(parseJson).filter(Boolean);
  const state = parseRoomState(results[2] || {});
  const typing = [...new Set(
    (results[4] || [])
      .filter(m => !me || !m.startsWith(me + '|'))   // 나는 제외
      .map(m => m.slice(m.indexOf('|') + 1))
  )].slice(0, 5);
  const online = results[results.length - 1] || 0;

  // 보낸 사람 해시(h)는 내려주지 않고, 내 메시지인지만 알려줌
  const msgs = all.filter(m => m.id > since).map(({ h, ...rest }) => ({ ...rest, mine: !!me && h === me }));
  const out = { msgs, rev, state, typing, online };

  // 삭제가 있었으면 남아 있는 메시지 목록을 같이 보내서 클라이언트가 정리
  if (String(req.query.rev) !== String(rev)) {
    out.cids = all.map(m => m.cid);
    out.from = all.length ? all[0].id : 0;
  }
  return res.status(200).json(out);
}


// POST: 내 메시지 삭제 (보낸 사람 확인은 기기 ID 해시, 관리자 메시지는 관리자만)
async function handleDelete(r, res, body, ip) {
  if (!isValidRoom(body.room)) return res.status(400).json({ error: 'bad-room' });
  const cid = cleanId(body.cid).slice(0, 24);
  if (!cid) return res.status(400).json({ error: 'bad-request' });

  const raw = (await r.lRange('m:' + body.room, 0, -1)).find(s => (parseJson(s) || {}).cid === cid);
  if (!raw) return res.status(404).json({ error: 'not-found' });

  const msg = parseJson(raw);
  const admin = await isAdmin(r, body.key);
  const isOwner = msg.h && msg.h === ownerOf(cleanId(body.uid), ip);
  if (!admin && (!isOwner || msg.admin)) return res.status(403).json({ error: 'forbidden' });

  await removeMessages(r, body.room, [raw]);
  return res.status(200).json({ ok: true });
}


// POST: 관리자 로그인 (성공하면 토큰 발급)
async function handleAuth(r, res, body, ip) {
  if (!process.env.ADMIN_PASSWORD) return res.status(501).json({ error: 'no-admin' });

  const out = await loginAdmin(r, ip, body.key);
  if (out === 'wrong') return res.status(401).json({ error: 'wrong' });
  if (out.rate) return res.status(429).json({ error: 'rate', retryAfter: out.rate });
  return res.status(200).json({ ok: true, token: out.token });
}


// POST: 관리자 로그아웃 (토큰 폐기)
async function handleLogout(r, res, body) {
  if (typeof body.key === 'string' && /^[a-f0-9]{48}$/.test(body.key)) await r.del(tokenKey(body.key));
  return res.status(200).json({ ok: true });
}


// POST: 관리자 명령어
async function handleCommand(r, res, body, ip) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(501).json({ error: 'no-admin', msg: '서버에 관리자 비밀번호가 없어요' });
  }
  if (!isValidRoom(body.room)) {
    return res.status(400).json({ error: 'bad-room', msg: '방 이름이 올바르지 않아요' });
  }
  if (!(await isAdmin(r, body.key))) {
    return res.status(401).json({ error: 'wrong', msg: '관리자 인증이 풀렸어요. 다시 로그인하세요' });
  }

  const out = await runCommand(r, body.room, ip, body.text);
  if (out.status === 200 && !/^\/(log|help|banlist|timeoutlist)\b/i.test(String(body.text || '').trim())) {
    await logAdmin(r, body.room, String(body.text || '').trim().slice(0, 200));
  }
  return res.status(out.status).json({ ok: out.status === 200, msg: out.msg });
}


// POST: 입력 중 표시 (켜기 / 끄기)
async function handleTyping(r, res, body, ip) {
  const uid = cleanId(body.uid);
  if (!isValidRoom(body.room) || !uid) return res.status(400).json({ error: 'bad-request' });
  const done = () => res.status(200).json({ ok: true });

  const admin = await isAdmin(r, body.key);
  const h = ownerOf(uid, ip);
  const member = h + '|' + pickName(body.name, admin);
  const key = 'ty:' + body.room;

  if (body.on === false) {
    await r.zRem(key, member);
    return done();
  }

  // 막힌 사람은 입력 중 표시도 안 보임
  if (!admin) {
    if (await r.hExists('bans', ip)) return done();
    if ((await r.ttl('to:' + ip)) > 0) return done();
    if ((await r.hGet('rs:' + body.room, 'closed')) === '1') return done();
  }

  // 사용자당 1초에 한 번만 반영
  if (!(await r.set('tyl:' + h, '1', { EX: 1, NX: true }))) return done();

  await r.multi()
    .zAdd(key, { score: Date.now() + TYPING_TTL_MS, value: member })
    .expire(key, 30)
    .exec();
  return done();
}


// POST: 메시지 전송
async function handleSend(r, res, body, ip) {
  const room = body.room;
  const morse = String(body.morse || '').replace(/[^.\-\/ ]/g, '').replace(/[ /]+$/, '').trim().slice(0, 400);
  const cid = cleanId(body.cid).slice(0, 24);
  const lang = LANGS.includes(body.lang) ? body.lang : 'en';   // 해독에 쓸 언어
  if (!isValidRoom(room) || !morse || !cid) return res.status(400).json({ error: 'bad-request' });

  const admin = await isAdmin(r, body.key);
  const name = pickName(body.name, admin);

  // 관리자는 닫힘 · 밴 · 타임아웃 · 슬로우 · 도배 제한 없음
  if (!admin) {
    const state = await getRoomState(r, room);
    if (state.closed) return res.status(403).json({ error: 'closed' });

    const blocked = await checkSendLimits(r, ip, room, state.slow);
    if (blocked) return res.status(blocked.status).json(blocked.body);
  }

  const owner = ownerOf(cleanId(body.uid), ip);
  const id = await r.incr('s:' + room);
  const msg = { id, cid, name, morse, lang, t: Date.now(), h: owner };
  if (admin) msg.admin = true;

  const tx = r.multi()
    .rPush('m:' + room, JSON.stringify(msg))
    .lTrim('m:' + room, -KEEP_MESSAGES, -1)
    .zRem('ty:' + room, owner + '|' + name)    // 보냈으면 입력 중 표시 제거
    .expire('m:' + room, ROOM_TTL)
    .expire('s:' + room, ROOM_TTL)
    .expire('rs:' + room, ROOM_TTL);
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
  if (body.action === 'logout') return handleLogout(r, res, body);
  if (body.action === 'cmd') return handleCommand(r, res, body, ip);
  if (body.action === 'del') return handleDelete(r, res, body, ip);
  if (body.action === 'typing') return handleTyping(r, res, body, ip);
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
