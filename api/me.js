const { COOKIE, verify, parseCookies } = require('./_lib');

module.exports = function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  let s = null;
  try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
  const configured = !!(process.env.GTAW_CLIENT_ID && process.env.GTAW_CLIENT_SECRET);
  if (!s) { res.end(JSON.stringify({ loggedIn: false, configured: configured })); return; }
  res.end(JSON.stringify({
    loggedIn: true,
    username: s.u,
    characters: s.c.map(function (c) { return { firstname: c[0], lastname: c[1] }; })
  }));
};
