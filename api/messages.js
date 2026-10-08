// Vercel Serverless Function — GET/POST /api/messages
const { createClient } = require('redis');

const KEEP = 200;               // 방마다 최근 N개만 보관
const TTL = 60 * 60 * 24 * 7;   // 7일 지나면 방 자동 삭제

// REDIS_URL 또는 접두사가 붙은 변수(예: STORAGE_REDIS_URL)도 자동으로 찾음
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
      const room = b.room;
      const morse = String(b.morse || '').replace(/[^.\-\/ ]/g, '').replace(/[ /]+$/, '').trim().slice(0, 400);
      const name = String(b.name || 'OP').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || 'OP';
      const cid = String(b.cid || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
      if (!okRoom(room) || !morse || !cid) return res.status(400).json({ error: 'bad-request' });

      const id = await r.incr('s:' + room);
      const msg = { id, cid, name, morse, t: Date.now() };
      await r.multi()
        .rPush('m:' + room, JSON.stringify(msg))
        .lTrim('m:' + room, -KEEP, -1)
        .expire('m:' + room, TTL)
        .expire('s:' + room, TTL)
        .exec();
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
