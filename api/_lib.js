const crypto = require('crypto');

const COOKIE = 'cc_session';
const STATE_COOKIE = 'cc_state';
const SESSION_SECONDS = 60 * 60 * 8;

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error('Missing environment variable ' + name);
  return v;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', env('SESSION_SECRET')).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', env('SESSION_SECRET')).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch (e) { return null; }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

function redirectUri() {
  return process.env.GTAW_REDIRECT_URI || 'https://cypress-customs.vercel.app/api/callback';
}

module.exports = { COOKIE, STATE_COOKIE, SESSION_SECONDS, env, sign, verify, parseCookies, cookie, redirectUri };
