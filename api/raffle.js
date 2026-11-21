// Raffle with free or paid tickets (paid through Fleeca Banking merchant API v2).
const crypto = require('crypto');
const H = require('./_raffle');

let lastCall = 0;

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const configured = !!(H.URL_ && H.TOKEN && process.env.ADMIN_KEY);
  const payReady = !!process.env.FLEECA_API_KEY;
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  try {
    if (req.method !== 'POST') {
      if (!(H.URL_ && H.TOKEN)) return send(200, { raffle: null, configured: false });
      const r = await H.load();
      return send(200, { raffle: r ? H.pub(r) : null, configured: configured, payReady: payReady });
    }
    if (!(H.URL_ && H.TOKEN)) return send(503, { error: 'not set up' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    b = b || {};

    if (b.action === 'verify') {
      const out = await H.credit(b.payment_id);
      const r = await H.load();
      return send(200, { result: out, raffle: r ? H.pub(r) : null });
    }

    if (b.action === 'enter' || b.action === 'buy') {
      const now = Date.now();
      if (now - lastCall < 600) return send(429, { error: 'Try again in a moment' });
      lastCall = now;
      const r = await H.load();
      if (!r) return send(404, { error: 'No raffle right now' });
      if (H.isClosed(r)) return send(400, { error: 'This raffle is closed' });
      const name = H.clean(b.name, 50);
      if (name.length < 3 || name.indexOf(' ') < 1) return send(400, { error: 'Write your full character name (first and last)' });
      const have = H.owned(r, name);
      const max = r.max || 1;

      if (b.action === 'enter') {
        if (r.price > 0) return send(400, { error: 'Tickets for this raffle are paid' });
        if (have > 0) return send(400, { error: 'This character is already entered' });
        r.tickets.push({ name: name, n: 1, payer: null, pid: null });
        await H.save(r);
        return send(200, { ok: true, raffle: H.pub(r) });
      }

      if (!(r.price > 0)) return send(400, { error: 'This raffle is free, use Enter' });
      if (!payReady) return send(503, { error: 'Payments are not set up yet' });
      const qty = Math.floor(Number(b.qty));
      if (!(qty >= 1)) return send(400, { error: 'Choose how many tickets' });
      if (have + qty > max) return send(400, { error: 'Limit is ' + max + ' tickets per character (you have ' + have + ')' });
      const amount = r.price * qty;
      const mode = process.env.FLEECA_MODE === '1' ? 1 : 0;
      const f = await H.fleeca('POST', '/payment', { amount: amount, mode: mode, description: ('Raffle: ' + r.prize + ' | ' + name + ' x' + qty).slice(0, 250) });
      if (f.status !== 201 || !f.data || !f.data.payment_id || !f.data.payment_link) {
        const why = f.status === 401 ? 'API key is missing or wrong (401)' : f.status === 422 ? 'bank says the data is invalid (422): ' + JSON.stringify(f.data && (f.data.errors || f.data.message) || '').slice(0, 160) : f.status === 429 ? 'too many requests, wait a minute (429)' : 'bank answered ' + f.status + ' ' + String(f.data && f.data.message || '').slice(0, 120);
        return send(502, { error: 'The bank did not accept the request: ' + why });
      }
      if (String(f.data.payment_link).indexOf('https://banking.gta.world/') !== 0) return send(502, { error: 'Unexpected payment link' });
      await H.redis(['SET', 'cc_pay_' + f.data.payment_id, JSON.stringify({ name: name, qty: qty, amount: amount, rid: r.id, credited: false }), 'EX', 2592000]);
      return send(200, { link: f.data.payment_link, amount: amount, sandbox: mode === 0 });
    }

    if (!configured) return send(503, { error: 'not set up' });
    if (!H.same(b.key || '', process.env.ADMIN_KEY)) return send(401, { error: 'wrong key' });

    if (b.action === 'create') {
      const prize = H.clean(b.prize, 80), text = H.clean(b.text, 240), ends = String(b.ends || '');
      const price = Math.max(0, Math.floor(Number(b.price) || 0));
      const max = Math.min(100, Math.max(1, Math.floor(Number(b.max) || 1)));
      if (!prize || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) return send(400, { error: 'prize and end date needed' });
      if (price > 99999999) return send(400, { error: 'price too high' });
      const r = { id: crypto.randomBytes(6).toString('hex'), prize: prize, text: text, ends: ends, price: price, max: max, winner: null, tickets: [] };
      await H.save(r);
      return send(200, { raffle: H.pub(r), configured: true });
    }
    const r = await H.load();
    if (b.action === 'delete') { await H.redis(['DEL', 'cc_raffle']); return send(200, { raffle: null, configured: true }); }
    if (!r) return send(404, { error: 'No raffle' });
    if (b.action === 'entrants') {
      return send(200, { entrants: r.tickets.map(function (t) { return t.name + ' x' + t.n + (t.payer ? ' (paid by ' + t.payer + ')' : ''); }), raffle: H.pub(r) });
    }
    if (b.action === 'draw') {
      const tot = H.total(r);
      if (!tot) return send(400, { error: 'Nobody has entered yet' });
      let k = crypto.randomInt(tot), win = r.tickets[0].name;
      for (let i = 0; i < r.tickets.length; i++) { if (k < r.tickets[i].n) { win = r.tickets[i].name; break; } k -= r.tickets[i].n; }
      r.winner = win;
      await H.save(r);
      return send(200, { raffle: H.pub(r), configured: true });
    }
    return send(400, { error: 'bad action' });
  } catch (e) {
    if (req.method === 'POST') return send(500, { error: String(e && e.message || e) });
    return send(200, { raffle: null, configured: configured });
  }
};
