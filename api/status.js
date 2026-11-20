// Open / closed status for the home screen.
// GET  -> { state: "open" | "closed" }   (everyone)
// POST -> body { key, state }            (owner only, needs ADMIN_KEY)
// Storage: Upstash Redis (free) added from Vercel -> Storage.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'cc_status';

async function redis(path) {
  const r = await fetch(URL_ + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  return r.json();
}

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  try {
    if (req.method === 'POST') {
      if (!configured) { res.statusCode = 503; res.end(JSON.stringify({ error: 'not set up' })); return; }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      if (!same(body.key || '', process.env.ADMIN_KEY)) { res.statusCode = 401; res.end(JSON.stringify({ error: 'wrong key' })); return; }
      const state = body.state === 'closed' ? 'closed' : 'open';
      await redis('/set/' + KEY + '/' + state);
      res.end(JSON.stringify({ state: state }));
      return;
    }
    let state = 'open';
    if (URL_ && TOKEN) {
      const d = await redis('/get/' + KEY);
      if (d && d.result === 'closed') state = 'closed';
    }
    res.end(JSON.stringify({ state: state, configured: configured }));
  } catch (e) {
    res.end(JSON.stringify({ state: 'open', configured: configured }));
  }
};
