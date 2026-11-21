// Fleeca calls this after a payment. We never trust the message itself:
// the payment is checked again with the bank API before any ticket is added.
const H = require('./_raffle');

module.exports = async function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    if (req.method === 'POST' && b && b.payment_id && process.env.FLEECA_API_KEY) await H.credit(b.payment_id);
  } catch (e) {}
  res.end(JSON.stringify({ ok: true }));
};
