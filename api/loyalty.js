// Loyalty card: 30 stamps per character. Players see their own card after logging in with GTA World.
// Only the owner (ADMIN_KEY) can add stamps, set a count, redeem or change the reward text.
// Stored in Redis: only the character name and the number of stamps.
const crypto = require('crypto');
const { COOKIE, verify, parseCookies } = require('./_lib');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'cc_loyalty';
const CFG = 'cc_loyalty_reward';
const GOAL = 30;

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
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const fieldOf = (name) => name.toLowerCase();

async function getCard(name) {
  const d = await redis(['HGET', HASH, fieldOf(name)]);
  if (!d || !d.result) return 0;
  try { return Math.min(GOAL, Math.max(0, JSON.parse(d.result).n | 0)); } catch (e) { return 0; }
}
async function setCard(name, n) {
  n = Math.min(GOAL, Math.max(0, n | 0));
  if (n === 0) await redis(['HDEL', HASH, fieldOf(name)]);
  else await redis(['HSET', HASH, fieldOf(name), JSON.stringify({ name: name, n: n })]);
  return n;
}
async function getReward() {
  const d = await redis(['GET', CFG]);
  return (d && d.result) || 'A free service of your choice';
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { goal: GOAL, reward: '', configured: false, loggedIn: false });
      let s = null;
      try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
      const reward = await getReward();
      if (!s) return send(200, { goal: GOAL, reward: reward, configured: configured, loggedIn: false });
      const names = s.c.map(function (c) { return (c[0] + ' ' + c[1]).trim(); }).filter(Boolean);
      const cards = [];
      for (const n of names) cards.push({ name: n, stamps: await getCard(n) });
      return send(200, { goal: GOAL, reward: reward, configured: configured, loggedIn: true, cards: cards });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });

    if (b.action === 'reward') {
      const text = clean(b.text, 120);
      if (!text) return send(400, { error: 'write the reward' });
      await redis(['SET', CFG, text]);
      return send(200, { reward: text });
    }
    if (b.action === 'all') {
      const d = await redis(['HGETALL', HASH]);
      const flat = (d && d.result) || [];
      const rows = [];
      for (let i = 1; i < flat.length; i += 2) { try { const o = JSON.parse(flat[i]); rows.push(o.name + ': ' + o.n + '/' + GOAL); } catch (e) {} }
      rows.sort();
      return send(200, { rows: rows });
    }
    const name = clean(b.name, 70);
    if (name.length < 3 || name.indexOf(' ') < 1) return send(400, { error: 'Write the full character name (first and last)' });
    const cur = await getCard(name);
    if (b.action === 'lookup') return send(200, { name: name, stamps: cur });
    if (b.action === 'add') {
      const n = Math.max(1, Math.min(GOAL, Math.floor(Number(b.n) || 1)));
      return send(200, { name: name, stamps: await setCard(name, cur + n) });
    }
    if (b.action === 'set') {
      const n = Math.floor(Number(b.n));
      if (!(n >= 0)) return send(400, { error: 'number needed' });
      return send(200, { name: name, stamps: await setCard(name, n) });
    }
    if (b.action === 'redeem') {
      if (cur < GOAL) return send(400, { error: name + ' has only ' + cur + '/' + GOAL + ' stamps' });
      return send(200, { name: name, stamps: await setCard(name, 0), redeemed: true });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { goal: GOAL, reward: '', configured: configured, loggedIn: false });
  }
};
