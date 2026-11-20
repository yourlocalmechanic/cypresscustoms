const { COOKIE, cookie } = require('./_lib');

module.exports = function (req, res) {
  res.setHeader('Set-Cookie', cookie(COOKIE, '', 0));
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
};
