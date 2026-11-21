// Reviews. Logged-in players (GTA World) write one review per character; the owner approves before it is shown.
// Stored: character name, stars, short text. Nothing else.
const crypto = require('crypto');
const { COOKIE, verify, parseCookies } = require('./_lib');
const notify = require('./_notify');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'cc_reviews';
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
async function all() {
  const d = await redis(['HGETALL', HASH]);
  const flat = (d && d.result) || [];
  const out = [];
  for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch (e) {} }
  out.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
  return out;
}
const pub = (r) => ({ id: r.id, name: r.name, stars: r.stars, text: r.text, t: r.t });

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  let s = null;
  try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { reviews: [], configured: false, loggedIn: !!s, names: [] });
      const list = await all();
      const names = s ? s.c.map(function (c) { return (c[0] + ' ' + c[1]).trim(); }).filter(Boolean) : [];
      const low = names.map(function (n) { return n.toLowerCase(); });
      const mine = list.filter(function (r) { return low.indexOf(r.name.toLowerCase()) >= 0; }).map(function (r) { return { id: r.id, name: r.name, stars: r.stars, text: r.text, ok: !!r.ok }; });
      return send(200, { reviews: list.filter(function (r) { return r.ok; }).slice(0, 30).map(pub), configured: configured, loggedIn: !!s, names: names, mine: mine });
    }
    if (!(URL_ && TOKEN)) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (b.action === 'write') {
      if (!s) return send(401, { error: 'Log in with GTA World first' });
      const names = s.c.map(function (c) { return (c[0] + ' ' + c[1]).trim(); });
      const name = names.filter(function (n) { return n.toLowerCase() === String(b.name || '').toLowerCase(); })[0];
      if (!name) return send(400, { error: 'Choose one of your characters' });
      const stars = Math.floor(Number(b.stars));
      if (!(stars >= 1 && stars <= 5)) return send(400, { error: 'Choose 1 to 5 stars' });
      const text = clean(b.text, 220);
      if (text.length < 3) return send(400, { error: 'Write a short review' });
      const id = crypto.createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 12);
      await redis(['HSET', HASH, id, JSON.stringify({ id: id, name: name, stars: stars, text: text, ok: false, t: Date.now() })]);
      await notify('New review to approve', name + ' gave ' + stars + '/5: ' + text.slice(0, 200), 0xe0a526);
      return send(200, { ok: true });
    }
    if (!configured) return send(503, { error: 'not set up' });
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });
    const id = String(b.id || '').replace(/[^a-f0-9]/g, '').slice(0, 20);
    if (b.action === 'pending') return send(200, { reviews: (await all()).filter(function (r) { return !r.ok; }).map(pub) });
    if (b.action === 'approve') {
      const d = await redis(['HGET', HASH, id]);
      if (!d || !d.result) return send(404, { error: 'not found' });
      const r = JSON.parse(d.result); r.ok = true;
      await redis(['HSET', HASH, id, JSON.stringify(r)]);
      return send(200, { ok: true });
    }
    if (b.action === 'delete') { await redis(['HDEL', HASH, id]); return send(200, { ok: true }); }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { reviews: [], configured: configured, loggedIn: false, names: [] });
  }
};
