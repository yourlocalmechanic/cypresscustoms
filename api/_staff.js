// Crew list. Public read, owner adds and deletes. The first time it is read, the current crew is saved as the starting list.
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'cc_staff', SEEDED = 'cc_staff_seeded';
const DEFAULTS = [
  { name: 'Andrew Capmany', role: 'Owner', bio: 'Owns Cypress Customs and has the final word on every build.' },
  { name: 'Charles Broderick', role: 'Manager and mechanic', bio: 'Runs the shop floor and works the bays alongside the crew.' },
  { name: 'Kevin Pousa', role: 'Manager and mechanic', bio: 'Manages the day-to-day and picks up a wrench when jobs stack up.' }
];
async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const d = await r.json();
  if (d && d.error) throw new Error(d.error);
  return d;
}
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
async function list() {
  const s = await redis(['GET', SEEDED]);
  if (!(s && s.result)) {
    const n = Date.now();
    for (let i = 0; i < DEFAULTS.length; i++) {
      const id = crypto.randomBytes(5).toString('hex');
      await redis(['HSET', HASH, id, JSON.stringify(Object.assign({ id: id, o: n + i }, DEFAULTS[i]))]);
    }
    await redis(['SET', SEEDED, '1']);
  }
  const d = await redis(['HGETALL', HASH]);
  const flat = (d && d.result) || [];
  const out = [];
  for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch (e) {} }
  out.sort(function (a, b) { return (a.o || 0) - (b.o || 0); });
  return out;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { staff: [], configured: false });
      return send(200, { staff: await list(), configured: configured });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });
    await list();
    if (b.action === 'add') {
      const name = clean(b.name, 60);
      if (name.length < 2) return send(400, { error: 'Write the name' });
      const id = crypto.randomBytes(5).toString('hex');
      const m = { id: id, name: name, role: clean(b.role, 60) || 'Mechanic', bio: clean(b.bio, 160), o: Date.now() };
      await redis(['HSET', HASH, id, JSON.stringify(m)]);
      return send(200, { member: m });
    }
    if (b.action === 'delete') {
      await redis(['HDEL', HASH, String(b.id || '').replace(/[^a-f0-9]/g, '').slice(0, 20)]);
      return send(200, { ok: true });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { staff: [], configured: configured });
  }
};
