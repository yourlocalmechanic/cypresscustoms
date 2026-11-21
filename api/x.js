// One serverless function for the small features, to stay under the Hobby plan limit (12 functions).
// /api/x?m=promo | reviews | referral | bookings
const handlers = {
  promo: require('./_promo'),
  reviews: require('./_reviews'),
  referral: require('./_referral'),
  bookings: require('./_bookings')
};
module.exports = function (req, res) {
  let m = req.query && req.query.m;
  if (!m) { try { m = new URL(req.url, 'http://x').searchParams.get('m'); } catch (e) {} }
  const h = Object.prototype.hasOwnProperty.call(handlers, m) ? handlers[m] : null;
  if (!h) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'not found' })); return; }
  return h(req, res);
};
