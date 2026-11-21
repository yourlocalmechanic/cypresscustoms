// Raffle: one active raffle, free entry by character name, owner draws the winner.
// GET  -> { raffle: null | {prize,text,ends,winner,count,closed}, configured }
// POST public : { action:"enter", name }
// POST owner  : { key, action:"create"|"draw"|"delete"|"entrants", ... }
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'cc_raffle';
const MAX = 3000;

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
  if (!d || !d.result) return null;
  try { return JSON.parse(d.result); } catch (e) { return null; }
}
function isClosed(r) {
  if (r.winner) return true;
  const end = Date.parse(r.ends + 'T23:59:59Z');
  return !isNaN(end) && Date.now() > end;
}
function pub(r) {
  return { prize: r.prize, text: r.text, ends: r.ends, winner: r.winner || null, count: r.entrants.length, closed: isClosed(r) };
}
function clean(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

let lastEnter = 0;

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { raffle: null, configured: false });
      const r = await load();
      return send(200, { raffle: r ? pub(r) : null, configured: configured });
    }
    if (!(URL_ && TOKEN)) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};

    if (b.action === 'enter') {
      const now = Date.now();
      if (now - lastEnter < 300) return send(429, { error: 'Try again in a moment' });
      lastEnter = now;
      const r = await load();
      if (!r) return send(404, { error: 'No raffle right now' });
      if (isClosed(r)) return send(400, { error: 'This raffle is closed' });
      const name = clean(b.name, 50);
      if (name.length < 3 || name.indexOf(' ') < 1) return send(400, { error: 'Write your full character name (first and last)' });
      const low = name.toLowerCase();
      if (r.entrants.some(function (n) { return n.toLowerCase() === low; })) return send(400, { error: 'This character is already entered' });
      if (r.entrants.length >= MAX) return send(400, { error: 'Raffle is full' });
      r.entrants.push(name);
      await redis(['SET', KEY, JSON.stringify(r)]);
      return send(200, { ok: true, raffle: pub(r) });
    }

    if (!configured) return send(503, { error: 'not set up' });
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });

    if (b.action === 'create') {
      const prize = clean(b.prize, 80), text = clean(b.text, 240), ends = String(b.ends || '');
      if (!prize || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return send(400, { error: 'prize and end date needed' });
      const r = { prize: prize, text: text, ends: ends, winner: null, entrants: [] };
      await redis(['SET', KEY, JSON.stringify(r)]);
      return send(200, { raffle: pub(r), configured: true });
    }
    const r = await load();
    if (b.action === 'delete') { await redis(['DEL', KEY]); return send(200, { raffle: null, configured: true }); }
    if (!r) return send(404, { error: 'No raffle' });
    if (b.action === 'entrants') return send(200, { entrants: r.entrants, raffle: pub(r) });
    if (b.action === 'draw') {
      if (!r.entrants.length) return send(400, { error: 'Nobody has entered yet' });
      r.winner = r.entrants[crypto.randomInt(r.entrants.length)];
      await redis(['SET', KEY, JSON.stringify(r)]);
      return send(200, { raffle: pub(r), configured: true });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { raffle: null, configured: configured });
  }
};
