// Vercel Serverless Function — GET/POST /api/messages
// 저장소: Upstash Redis (Vercel Marketplace에서 연결하면 환경변수 자동 주입)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEEP = 200;               // 방마다 최근 N개만 보관
const TTL = 60 * 60 * 24 * 7;   // 7일 지나면 방 자동 삭제

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

const okRoom = s => typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'no-storage' });

  try {
    if (req.method === 'GET') {
      const room = String(req.query.room || '');
      const since = parseInt(req.query.since, 10) || 0;
      if (!okRoom(room)) return res.status(400).json({ error: 'bad-room' });
      const [raw] = await redis([['LRANGE', 'm:' + room, -100, -1]]);
      const msgs = (raw || []).map(s => { try { return JSON.parse(s); } catch { return null; } })
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

      const [id] = await redis([['INCR', 's:' + room]]);
      const msg = { id, cid, name, morse, t: Date.now() };
      await redis([
        ['RPUSH', 'm:' + room, JSON.stringify(msg)],
        ['LTRIM', 'm:' + room, -KEEP, -1],
        ['EXPIRE', 'm:' + room, TTL],
        ['EXPIRE', 's:' + room, TTL],
      ]);
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
