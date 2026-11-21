// Referral codes. Each logged-in character gets a code. When a friend names it at the shop,
// the owner redeems it here and both characters get one bonus loyalty stamp (once per friend).
const crypto = require('crypto');
const { COOKIE, verify, parseCookies } = require('./_lib');
const notify = require('./_notify');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CODES = 'cc_ref', USED = 'cc_ref_used', LOY = 'cc_loyalty', GOAL = 30;
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
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function codeFor(name) {
  const h = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'x').update('ref:' + name.toLowerCase()).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHA[h[i] % ALPHA.length];
  return 'CC-' + out;
}
async function addStamp(name) {
  const f = name.toLowerCase();
  const d = await redis(['HGET', LOY, f]);
  let n = 0;
  if (d && d.result) { try { n = JSON.parse(d.result).n | 0; } catch (e) {} }
  const was = n;
  n = Math.min(GOAL, n + 1);
  if (n >= GOAL && was < GOAL) await notify('Loyalty reward unlocked', name + ' has collected ' + GOAL + '/' + GOAL + ' stamps and can claim the reward.', 0x1f6b44);
  await redis(['HSET', LOY, f, JSON.stringify({ name: name, n: n })]);
  return n;
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
      if (!s || !(URL_ && TOKEN)) return send(200, { loggedIn: !!s, configured: configured, codes: [] });
      const codes = [];
      for (const c of s.c) {
        const name = (c[0] + ' ' + c[1]).trim();
        if (!name) continue;
        const code = codeFor(name);
        await redis(['HSET', CODES, code, name]);
        codes.push({ name: name, code: code });
      }
      return send(200, { loggedIn: true, configured: configured, codes: codes });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });
    if (b.action !== 'redeem') return send(400, { error: 'bad action' });
    const code = clean(b.code, 12).toUpperCase();
    const friend = clean(b.name, 70);
    if (friend.length < 3 || friend.indexOf(' ') < 1) return send(400, { error: 'Write the friend\'s full character name' });
    const d = await redis(['HGET', CODES, code]);
    if (!d || !d.result) return send(404, { error: 'Unknown code. The player must open My account once so the code exists.' });
    const referrer = d.result;
    if (referrer.toLowerCase() === friend.toLowerCase()) return send(400, { error: 'A character cannot refer itself' });
    const u = await redis(['HGET', USED, friend.toLowerCase()]);
    if (u && u.result) return send(400, { error: friend + ' already used a referral code' });
    await redis(['HSET', USED, friend.toLowerCase(), referrer]);
    const a = await addStamp(referrer), c = await addStamp(friend);
    return send(200, { referrer: referrer, referrerStamps: a, friend: friend, friendStamps: c });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { loggedIn: false, configured: configured, codes: [] });
  }
};
