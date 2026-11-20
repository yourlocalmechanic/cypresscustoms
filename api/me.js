const { COOKIE, verify, parseCookies } = require('./_lib');

module.exports = function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  let s = null;
  try { s = verify(parseCookies(req)[COOKIE]); } catch (e) {}
  if (!s) { res.end(JSON.stringify({ loggedIn: false })); return; }
  res.end(JSON.stringify({
    loggedIn: true,
    username: s.u,
    characters: s.c.map(function (c) { return { firstname: c[0], lastname: c[1] }; })
  }));
};
