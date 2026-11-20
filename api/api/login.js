const crypto = require('crypto');
const { STATE_COOKIE, env, sign, cookie, redirectUri } = require('./_lib');

module.exports = function (req, res) {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    const url = 'https://ucp.gta.world/oauth/authorize?' + new URLSearchParams({
      client_id: env('GTAW_CLIENT_ID'),
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: '',
      state: state
    }).toString();
    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, sign({ s: state, exp: Math.floor(Date.now() / 1000) + 600 }), 600));
    res.statusCode = 302;
    res.setHeader('Location', url);
    res.end();
  } catch (e) {
    res.statusCode = 500;
    res.end('Login is not set up yet.');
  }
};
