// Promo banner shown at the top of the site. Public read, owner sets or clears the text.
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'cc_promo';
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

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { text: '', configured: false });
      const d = await redis(['GET', KEY]);
      return send(200, { text: (d && d.result) || '', configured: configured });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });
    const text = clean(b.text, 140);
    if (!text) await redis(['DEL', KEY]); else await redis(['SET', KEY, text]);
    return send(200, { text: text });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { text: '', configured: configured });
  }
};
