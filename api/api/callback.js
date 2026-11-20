const { COOKIE, STATE_COOKIE, SESSION_SECONDS, env, sign, verify, parseCookies, cookie, redirectUri } = require('./_lib');

module.exports = async function (req, res) {
  const fail = function () {
    res.statusCode = 302;
    res.setHeader('Location', '/?login=failed#book');
    res.end();
  };
  try {
    const q = new URL(req.url, 'https://x').searchParams;
    const code = q.get('code'), state = q.get('state');
    const saved = verify(parseCookies(req)[STATE_COOKIE]);
    if (!code || !state || !saved || saved.s !== state) return fail();

    const tokenRes = await fetch('https://ucp.gta.world/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env('GTAW_CLIENT_ID'),
        client_secret: env('GTAW_CLIENT_SECRET'),
        redirect_uri: redirectUri(),
        code: code
      }).toString()
    });
    if (!tokenRes.ok) return fail();
    const tok = await tokenRes.json();
    if (!tok.access_token) return fail();

    const userRes = await fetch('https://ucp.gta.world/api/user', {
      headers: { Authorization: 'Bearer ' + tok.access_token, Accept: 'application/json' }
    });
    if (!userRes.ok) return fail();
    const data = await userRes.json();
    const user = data.user || data;
    const chars = (data.user && data.user.characters) || data.characters || user.characters || [];

    const session = {
      u: String(user.username || '').slice(0, 40),
      c: chars.slice(0, 12).map(function (c) {
        return [String(c.firstname || '').slice(0, 30), String(c.lastname || '').slice(0, 30)];
      }),
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
    };
    res.setHeader('Set-Cookie', [
      cookie(COOKIE, sign(session), SESSION_SECONDS),
      cookie(STATE_COOKIE, '', 0)
    ]);
    res.statusCode = 302;
    res.setHeader('Location', '/#book');
    res.end();
  } catch (e) {
    fail();
  }
};
