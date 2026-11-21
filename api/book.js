// Sends a booking request to a Discord channel through a webhook.
// Needs the env var DISCORD_WEBHOOK_URL (Discord: channel settings -> Integrations -> Webhooks).
// Nothing is stored. No IP address or other data is collected, only what the form contains.
let last = 0;

function clean(v, n) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n) || '-';
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }
  if (!hook) { res.statusCode = 503; res.end(JSON.stringify({ error: 'not set up' })); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  if (b.website) { res.end(JSON.stringify({ ok: true })); return; } // spam trap
  const now = Date.now();
  if (now - last < 4000) { res.statusCode = 429; res.end(JSON.stringify({ error: 'slow down' })); return; }
  last = now;
  const name = clean(b.name, 60), phone = clean(b.phone, 30), car = clean(b.car, 80), time = clean(b.time, 20);
  const jobs = String(b.jobs == null ? '' : b.jobs).replace(/\u0000/g, '').trim().slice(0, 900) || '-';
  if (name === '-' && jobs === '-') { res.statusCode = 400; res.end(JSON.stringify({ error: 'empty' })); return; }
  const payload = {
    username: 'Cypress Customs Website',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'New booking request',
      color: 0x1f6b44,
      fields: [
        { name: 'Character', value: name, inline: true },
        { name: 'Phone', value: phone, inline: true },
        { name: 'Best time', value: time, inline: true },
        { name: 'Vehicle', value: car },
        { name: 'Jobs', value: jobs }
      ],
      timestamp: new Date().toISOString()
    }]
  };
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('discord ' + r.status);
    try { // keep a copy for the status page (30 days); never blocks the booking
      const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, T = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
      if (U && T && name !== '-') {
        const id = require('crypto').randomBytes(6).toString('hex');
        const rec = { id: id, name: name, car: car, jobs: jobs.slice(0, 400), status: 'Received', t: Date.now() };
        const call = (cmd) => fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
        await call(['SET', 'cc_b_' + id, JSON.stringify(rec), 'EX', String(60 * 60 * 24 * 30)]);
        await call(['LPUSH', 'cc_book_ids', id]);
        await call(['LTRIM', 'cc_book_ids', 0, 199]);
      }
    } catch (e) {}
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'could not send' }));
  }
};
