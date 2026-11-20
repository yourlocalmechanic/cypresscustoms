// Events list for the "Car shows and cruises" section.
// GET  -> { events: [...], configured }          (everyone)
// POST -> { key, action: "add", event:{date,title,text} } or { key, action: "delete", id }   (owner only)
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'cc_events';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (d && d.error) throw new Error(d.error);
  return d;
}

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function load() {
  const d = await redis(['GET', KEY]);
  if (!d || !d.result) return [];
  try { const a = JSON.parse(d.result); return Array.isArray(a) ? a : []; } catch (e) { return []; }
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
      let list = await load();
      if (body.action === 'add') {
        const e = body.event || {};
        const date = String(e.date || '');
        const title = String(e.title || '').trim().slice(0, 60);
        const text = String(e.text || '').trim().slice(0, 200);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) { res.statusCode = 400; res.end(JSON.stringify({ error: 'date and title needed' })); return; }
        if (list.length >= 30) { res.statusCode = 400; res.end(JSON.stringify({ error: 'too many events' })); return; }
        list.push({ id: crypto.randomBytes(6).toString('hex'), date: date, title: title, text: text });
      } else if (body.action === 'delete') {
        list = list.filter(function (x) { return x.id !== body.id; });
      } else { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad action' })); return; }
      list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      await redis(['SET', KEY, JSON.stringify(list)]);
      res.end(JSON.stringify({ events: list, configured: true }));
      return;
    }
    if (!(URL_ && TOKEN)) { res.end(JSON.stringify({ events: null, configured: false })); return; }
    res.end(JSON.stringify({ events: await load(), configured: configured }));
  } catch (e) {
    if (req.method === 'POST') { res.statusCode = 500; res.end(JSON.stringify({ error: String(e && e.message || e) })); return; }
    res.end(JSON.stringify({ events: null, configured: configured }));
  }
};
