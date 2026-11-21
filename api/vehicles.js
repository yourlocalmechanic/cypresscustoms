// Vehicle service history. The owner (ADMIN_KEY) records jobs by character name and plate.
// A player who logs in with GTA World sees only the vehicles registered to their own characters.
// Stored: plate, model, character name and the list of jobs (all in-game information).
const crypto = require('crypto');
const { COOKIE, verify, parseCookies } = require('./_lib');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'cc_veh';
const LOY = 'cc_loyalty';
const notify = require('./_notify');
const GOAL = 30;
const MAXJOBS = 200;

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

async function all() {
  const d = await redis(['HGETALL', HASH]);
  const flat = (d && d.result) || [];
  const out = [];
  for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch (e) {} }
  return out;
}
const save = (v) => redis(['HSET', HASH, v.id, JSON.stringify(v)]);
function view(v) {
  return { id: v.id, plate: v.plate, model: v.model, owner: v.owner, jobs: v.jobs.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (b.t || 0) - (a.t || 0); }) };
}
async function addStamp(owner) {
  const f = owner.toLowerCase();
  const d = await redis(['HGET', LOY, f]);
  let n = 0;
  if (d && d.result) { try { n = JSON.parse(d.result).n | 0; } catch (e) {} }
  const was = n;
  n = Math.min(GOAL, n + 1);
  if (n >= GOAL && was < GOAL) await notify('Loyalty reward unlocked', owner + ' has collected ' + GOAL + '/' + GOAL + ' stamps and can claim the reward.', 0x1f6b44);
  await redis(['HSET', LOY, f, JSON.stringify({ name: owner, n: n })]);
  return n;
}

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(URL_ && TOKEN && process.env.ADMIN_KEY);
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(URL_ && TOKEN)) return send(200, { loggedIn: false, configured: false, vehicles: [] });
      let s = null;
      try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
      if (!s) return send(200, { loggedIn: false, configured: configured, vehicles: [] });
      const names = s.c.map(function (c) { return (c[0] + ' ' + c[1]).trim().toLowerCase(); });
      const mine = (await all()).filter(function (v) { return names.indexOf(String(v.owner).toLowerCase()) >= 0; });
      return send(200, { loggedIn: true, configured: configured, vehicles: mine.map(view) });
    }
    if (!configured) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};
    if (!same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });

    if (b.action === 'list') {
      const q = clean(b.q, 40).toLowerCase();
      let list = await all();
      if (q) list = list.filter(function (v) { return v.plate.toLowerCase().indexOf(q) >= 0 || String(v.owner).toLowerCase().indexOf(q) >= 0 || String(v.model).toLowerCase().indexOf(q) >= 0; });
      list.sort(function (a, b) { return a.owner < b.owner ? -1 : 1; });
      return send(200, { vehicles: list.slice(0, 40).map(view), total: list.length });
    }
    if (b.action === 'add') {
      const owner = clean(b.owner, 70), plate = clean(b.plate, 12).toUpperCase(), model = clean(b.model, 40);
      const type = clean(b.type, 40), note = clean(b.note, 200);
      const price = Math.max(0, Math.floor(Number(b.price) || 0));
      if (owner.length < 3 || owner.indexOf(' ') < 1) return send(400, { error: 'Write the owner full name (first and last)' });
      if (!plate) return send(400, { error: 'Plate is needed' });
      if (!type) return send(400, { error: 'Choose the job' });
      let v = (await all()).find(function (x) { return x.plate === plate; });
      if (!v) {
        if (!model) return send(400, { error: 'New plate: write the model too' });
        v = { id: crypto.randomBytes(5).toString('hex'), plate: plate, model: model, owner: owner, jobs: [] };
      } else {
        if (v.owner.toLowerCase() !== owner.toLowerCase()) {
          if (!b.transfer) return send(400, { error: 'Plate ' + plate + ' belongs to ' + v.owner + '. Tick "Change owner" to move it.' });
          v.owner = owner;
        }
        if (model) v.model = model;
      }
      if (v.jobs.length >= MAXJOBS) return send(400, { error: 'Too many records on this vehicle' });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : new Date().toISOString().slice(0, 10);
      v.jobs.push({ d: date, t: Date.now(), type: type, note: note, price: price });
      await save(v);
      let stamps = null;
      if (b.stamp) stamps = await addStamp(v.owner);
      return send(200, { vehicle: view(v), stamps: stamps });
    }
    if (b.action === 'deljob') {
      const v = (await all()).find(function (x) { return x.id === b.id; });
      if (!v) return send(404, { error: 'not found' });
      const before = v.jobs.length;
      v.jobs = v.jobs.filter(function (j) { return j.t !== b.t; });
      if (v.jobs.length === before) return send(404, { error: 'record not found' });
      await save(v);
      return send(200, { vehicle: view(v) });
    }
    if (b.action === 'delete') {
      await redis(['HDEL', HASH, String(b.id || '')]);
      return send(200, { ok: true });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { loggedIn: false, configured: configured, vehicles: [] });
  }
};
