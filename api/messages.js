// Vercel Serverless Function — GET/POST /api/messages   (파일 위치: api/messages.js)
// 저장소: Redis (REDIS_URL)  /  관리자: 환경변수 ADMIN_PASSWORD
const { createClient } = require('redis');
const crypto = require('crypto');

const KEEP = 200;               // 방마다 최근 N개만 보관
const TTL = 60 * 60 * 24 * 7;   // 7일 지나면 방 자동 삭제
// 도배 제한 (IP 기준). win초 동안 max개 초과하면 block초 동안 전송 차단
const TIERS = [
  { win: 10,  max: 8,  block: 30  },
  { win: 600, max: 80, block: 300 },
];
const AUTH_MAX_FAIL = 5, AUTH_WIN = 600;   // 관리자 로그인 실패 5회 → 10분 잠금
const MAX_TIMEOUT_MIN = 60 * 24 * 7;       // 타임아웃 최대 7일

const REDIS_URL = process.env.REDIS_URL ||
  process.env[Object.keys(process.env).find(k => /REDIS_URL$/.test(k)) || ''];

let client = null, connecting = null;
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

const okRoom = s => typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function isAdmin(k) {
  const p = process.env.ADMIN_PASSWORD;
  if (!p || typeof k !== 'string' || !k) return false;
  return crypto.timingSafeEqual(sha(k), sha(p));
}
const getIp = req =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '?';
const isFull = e => /OOM|maxmemory|max memory|used memory|quota/i.test(String((e && e.message) || ''));

const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
const nameKey = (room, name) => 'nm:' + room + ':' + name.toLowerCase(); // 이름 → 마지막 IP

/* 관리자 인증 (실패 횟수 제한 포함) → 'ok' | 'wrong' | { rate: 남은초 } */
async function checkAuth(r, ip, key) {
  const fk = 'af:' + ip;
  const fails = parseInt(await r.get(fk), 10) || 0;
  if (fails >= AUTH_MAX_FAIL) {
    const t = await r.ttl(fk);
    return { rate: t > 0 ? t : AUTH_WIN };
  }
  if (isAdmin(key)) return 'ok';
  const n = await r.incr(fk);
  if (n === 1) await r.expire(fk, AUTH_WIN);
  return 'wrong';
}

/* 이름으로 IP 찾기: 최근 메시지 기록 → 없으면 밴 목록에서 */
async function findIp(r, room, name) {
  const ip = await r.get(nameKey(room, name));
  if (ip) return ip;
  const all = await r.hGetAll('bans');
  return Object.keys(all).find(k => String(all[k]).toLowerCase() === name.toLowerCase()) || null;
}

/* 관리자 명령어: /ban 이름 · /timeout 분 이름 · /unban 이름 */
async function runCommand(r, room, adminIp, text) {
  const t = String(text || '').trim();
  const usage = { status: 400, msg: '사용법: /ban 이름 · /timeout 분 이름 · /unban 이름' };
  let m;

  if ((m = t.match(/^\/ban\s+(.+)$/i))) {
    const name = cleanName(m[1]);
    const ip = name && await findIp(r, room, name);
    if (!ip) return { status: 404, msg: `'${name}' 사용자를 찾지 못했어요 (이 방에서 최근 7일 안에 보낸 기록이 필요해요)` };
    if (ip === adminIp) return { status: 400, msg: '자기 자신(같은 IP)은 차단할 수 없어요' };
    await r.hSet('bans', ip, name);
    return { status: 200, msg: `${name} 님을 차단했어요 (/unban ${name} 으로 해제)` };
  }

  if ((m = t.match(/^\/timeout\s+(\d+)\s+(.+)$/i))) {
    const min = Math.min(parseInt(m[1], 10), MAX_TIMEOUT_MIN);
    const name = cleanName(m[2]);
    if (min < 1 || !name) return usage;
    const ip = await findIp(r, room, name);
    if (!ip) return { status: 404, msg: `'${name}' 사용자를 찾지 못했어요 (이 방에서 최근 7일 안에 보낸 기록이 필요해요)` };
    if (ip === adminIp) return { status: 400, msg: '자기 자신(같은 IP)은 제한할 수 없어요' };
    await r.set('to:' + ip, '1', { EX: min * 60 });
    return { status: 200, msg: `${name} 님을 ${min}분 동안 타임아웃했어요` };
  }

  if ((m = t.match(/^\/unban\s+(.+)$/i))) {
    const name = cleanName(m[1]);
    const ip = name && await findIp(r, room, name);
    if (!ip) return { status: 404, msg: `'${name}' 사용자를 찾지 못했어요` };
    await r.hDel('bans', ip);
    await r.del('to:' + ip);
    return { status: 200, msg: `${name} 님의 차단/타임아웃을 해제했어요` };
  }

  return usage;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!REDIS_URL) return res.status(503).json({ error: 'no-storage' });

  try {
    const r = await getClient();

    if (req.method === 'GET') {
      const room = String(req.query.room || '');
      const since = parseInt(req.query.since, 10) || 0;
      if (!okRoom(room)) return res.status(400).json({ error: 'bad-room' });
      const raw = await r.lRange('m:' + room, -100, -1);
      const msgs = raw.map(s => { try { return JSON.parse(s); } catch { return null; } })
        .filter(m => m && m.id > since);
      return res.status(200).json({ msgs });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
      b = b || {};
      const ip = getIp(req);

      /* 관리자 로그인 확인 */
      if (b.action === 'auth') {
        if (!process.env.ADMIN_PASSWORD) return res.status(501).json({ error: 'no-admin' });
        const a = await checkAuth(r, ip, b.key);
        if (a === 'ok') return res.status(200).json({ ok: true });
        if (a === 'wrong') return res.status(401).json({ error: 'wrong' });
        return res.status(429).json({ error: 'rate', retryAfter: a.rate });
      }

      /* 관리자 명령어 (/ban, /timeout, /unban) */
      if (b.action === 'cmd') {
        if (!process.env.ADMIN_PASSWORD) return res.status(501).json({ error: 'no-admin', msg: '서버에 관리자 비밀번호가 없어요' });
        if (!okRoom(b.room)) return res.status(400).json({ error: 'bad-room', msg: '방 이름이 올바르지 않아요' });
        const a = await checkAuth(r, ip, b.key);
        if (a === 'wrong') return res.status(401).json({ error: 'wrong', msg: '관리자 인증이 풀렸어요' });
        if (a !== 'ok') return res.status(429).json({ error: 'rate', retryAfter: a.rate, msg: `인증 실패가 너무 많아요. ${a.rate}초 뒤에 다시 시도하세요` });
        const out = await runCommand(r, b.room, ip, b.text);
        return res.status(out.status).json({ ok: out.status === 200, msg: out.msg });
      }

      /* 메시지 전송 */
      const room = b.room;
      const morse = String(b.morse || '').replace(/[^.\-\/ ]/g, '').replace(/[ /]+$/, '').trim().slice(0, 400);
      const cid = String(b.cid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
      if (!okRoom(room) || !morse || !cid) return res.status(400).json({ error: 'bad-request' });

      const admin = isAdmin(b.key);
      let name = cleanName(b.name || 'OP') || 'OP';
      if (!admin && /admin|관리자|운영자/i.test(name)) name = 'OP'; // 관리자 사칭 방지

      if (!admin) { // 관리자는 밴·타임아웃·도배 제한 없음
        if (await r.hExists('bans', ip)) return res.status(403).json({ error: 'banned' });
        const to = await r.ttl('to:' + ip);
        if (to > 0) return res.status(429).json({ error: 'timeout', retryAfter: to });

        const blk = await r.ttl('blk:' + ip);
        if (blk > 0) return res.status(429).json({ error: 'rate', retryAfter: blk });
        for (const t of TIERS) {
          const k = `rl:${t.win}:${ip}`;
          const n = await r.incr(k);
          if (n === 1) await r.expire(k, t.win);
          if (n > t.max) {
            await r.set('blk:' + ip, '1', { EX: t.block });
            return res.status(429).json({ error: 'rate', retryAfter: t.block });
          }
        }
      }

      const id = await r.incr('s:' + room);
      const msg = { id, cid, name, morse, t: Date.now() };
      if (admin) msg.admin = true;
      const tx = r.multi()
        .rPush('m:' + room, JSON.stringify(msg))
        .lTrim('m:' + room, -KEEP, -1)
        .expire('m:' + room, TTL)
        .expire('s:' + room, TTL);
      if (!admin) tx.set(nameKey(room, name), ip, { EX: TTL }); // /ban·/timeout 대상 찾기용
      await tx.exec();
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    if (isFull(e)) { // 저장 용량 부족
      res.setHeader('Retry-After', '60');
      return res.status(503).json({ error: 'full', retryAfter: 60 });
    }
    return res.status(500).json({ error: 'server' });
  }
};
