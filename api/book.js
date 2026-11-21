// Booking status. Players see their own requests after logging in with GTA World.
// Owner sees the latest requests and sets the status (Received / In progress / Ready / Done / Declined).
// Requests are stored for 30 days: character name, vehicle, jobs, status. No phone number.
const crypto = require('crypto');
const { COOKIE, verify, parseCookies } = require('./_lib');
const notify = require('./_notify');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const IDS = 'cc_book_ids';
const STATUS = ['Received', 'In progress', 'Ready', 'Done', 'Declined'];

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
async function latest(n) {
  const d = await redis(['LRANGE', IDS, 0, n - 1]);
  const out = [];
  for (const id of (d && d.result) || []) {
    const g = await redis(['GET', 'cc_b_' + id]);
    if (g && g.result) { try { out.push(JSON.parse(g.result)); } catch (e) {} }
  }
  return out;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      let s = null;
      try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
      if (!(URL_ && TOKEN) || !s) return send(200, { loggedIn: !!s, configured: configured, bookings: [] });
      const names = s.c.map(function (c) { return (c[0] + ' ' + c[1]).trim().toLowerCase(); }).filter(Boolean);
      const mine = (await latest(100)).filter(function (x) { return names.indexOf(String(x.name).toLowerCase()) >= 0; });
      return send(200, { loggedIn: true, configured: configured, bookings: mine.slice(0, 10) });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });
    if (b.action === 'list') return send(200, { bookings: await latest(30), statuses: STATUS });
    if (b.action === 'status') {
      const id = String(b.id || '').replace(/[^a-f0-9]/g, '').slice(0, 20);
      if (STATUS.indexOf(b.status) < 0) return send(400, { error: 'bad status' });
      const g = await redis(['GET', 'cc_b_' + id]);
      if (!g || !g.result) return send(404, { error: 'Booking not found (it may have expired)' });
      const x = JSON.parse(g.result);
      x.status = b.status;
      await redis(['SET', 'cc_b_' + id, JSON.stringify(x), 'EX', String(60 * 60 * 24 * 30)]);
      if (b.status === 'Ready') await notify('Booking ready', x.name + ': ' + x.car + ' is ready for pickup.', 0x1f6b44);
      return send(200, { booking: x });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { loggedIn: false, configured: configured, bookings: [] });
  }
};
