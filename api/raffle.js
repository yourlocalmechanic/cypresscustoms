// Shared helpers for the raffle (not a route: files starting with _ are not exposed).
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const FLEECA = 'https://banking.gta.world/api/v2';
const KEY = 'cc_raffle';

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
async function load() {
  const d = await redis(['GET', KEY]);
  if (!d || !d.result) return null;
  try { const r = JSON.parse(d.result); if (!Array.isArray(r.tickets)) r.tickets = []; return r; } catch (e) { return null; }
}
const save = (r) => redis(['SET', KEY, JSON.stringify(r)]);
function total(r) { return r.tickets.reduce(function (s, t) { return s + t.n; }, 0); }
function owned(r, name) {
  const low = name.toLowerCase();
  return r.tickets.filter(function (t) { return t.name.toLowerCase() === low; }).reduce(function (s, t) { return s + t.n; }, 0);
}
function isClosed(r) {
  if (r.winner) return true;
  const end = Date.parse(r.ends + 'T23:59:59Z');
  return !isNaN(end) && Date.now() > end;
}
function pub(r) {
  return { prize: r.prize, text: r.text, ends: r.ends, winner: r.winner || null, count: total(r), closed: isClosed(r), price: r.price || 0, max: r.max || 1 };
}
function clean(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function fleeca(method, path, body) {
  const r = await fetch(FLEECA + path, {
    method: method,
    headers: { Authorization: 'Bearer ' + process.env.FLEECA_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let d = {};
  try { d = await r.json(); } catch (e) {}
  return { status: r.status, data: d };
}

// Checks a payment with the bank (the only source of truth) and adds the tickets once.
async function credit(paymentId) {
  paymentId = String(paymentId || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(paymentId)) return { status: 'unknown' };
  const pk = 'cc_pay_' + paymentId;
  const g = await redis(['GET', pk]);
  if (!g || !g.result) return { status: 'unknown' };
  const p = JSON.parse(g.result);
  if (p.credited) return { status: 'credited', qty: p.qty };
  const lock = await redis(['SET', 'cc_lock_' + paymentId, '1', 'NX', 'EX', '30']);
  if (!lock || lock.result !== 'OK') return { status: 'pending' };
  try {
    const f = await fleeca('GET', '/payments/' + paymentId);
    const d = f.data && f.data.data;
    if (f.status !== 200 || !d) return { status: 'pending' };
    if (d.status === 'payment_failed') return { status: 'failed' };
    if (d.status !== 'payment_successful') return { status: 'pending' };
    if (d.mode === 'sandbox') return { status: 'sandbox' };
    if (Number(d.amount) !== p.amount) return { status: 'mismatch' };
    const r = await load();
    if (!r || r.id !== p.rid) return { status: 'raffle_gone' };
    if (r.winner) return { status: 'late' };
    r.tickets.push({ name: p.name, n: p.qty, payer: d.payer_name || null, pid: paymentId });
    await save(r);
    p.credited = true;
    await redis(['SET', pk, JSON.stringify(p), 'EX', 2592000]);
    return { status: 'credited', qty: p.qty };
  } finally {
    await redis(['DEL', 'cc_lock_' + paymentId]).catch(function () {});
  }
}

module.exports = { redis, load, save, total, owned, isClosed, pub, clean, same, fleeca, credit, URL_, TOKEN };
