// Offline regression checks for OAuth and session cookie scoping.
// No real Google authorization codes, accounts, or database requests are used.
import assert from 'node:assert/strict';
import * as arctic from 'arctic';
import { getAuthCookieDomain } from '../app/lib/cookieDomain';
import { clearSessionCookie, createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME, verifySessionToken } from '../app/lib/auth';
import { getOauthCookieClearOptions, getOauthStateCookieOptions } from '../app/lib/oauthOrigin';
import { adapt } from '../next-compat/adapt';

const envKeys = [
  'NODE_ENV', 'COOKIE_DOMAIN', 'OAUTH_CALLBACK_BASE_URL', 'NEXT_PUBLIC_BASE_URL',
  'RENDER', 'RENDER_EXTERNAL_URL', 'CROSS_SITE_COOKIES', 'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'DEPLOYMENT_MODE',
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CORS_ORIGIN',
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

function configure(values: Record<string, string>) {
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, values);
}

function assertCookieDomain(expected: string | undefined) {
  assert.equal(getAuthCookieDomain(), expected);
  const oauth = getOauthStateCookieOptions();
  const oauthClear = getOauthCookieClearOptions();
  const session = getSessionCookieOptions();
  let logout: Record<string, unknown> | undefined;
  clearSessionCookie({ set: (_name, _value, options) => { logout = options; } });
  for (const options of [oauth, oauthClear, session, logout!]) {
    assert.equal(options.domain, expected);
    assert.equal(options.path, '/');
    assert.equal(options.httpOnly, true);
  }
  assert.equal(oauth.sameSite, 'lax');
  assert.equal(oauthClear.maxAge, 0);
  assert.equal(logout!.maxAge, 0);
}

async function runRoute(handler: (request: Request) => Promise<Response>, url: string, cookie = '', body?: Record<string, unknown>) {
  const parsed = new URL(url);
  const headers = new Map<string, string | string[]>();
  let status = 200;
  let responseBody = '';
  const req = {
    method: body ? 'PATCH' : 'GET', protocol: parsed.protocol.slice(0, -1),
    originalUrl: parsed.pathname + parsed.search, params: {}, body,
    headers: { host: parsed.host, cookie, referer: 'https://kalpira.in/login' },
  };
  const res = {
    status(value: number) { status = value; return this; },
    setHeader(name: string, value: string | string[]) { headers.set(name.toLowerCase(), value); },
    send(body: Buffer) { responseBody = body.toString(); },
    json(body: unknown) { throw new Error(`Unexpected route error: ${JSON.stringify(body)}`); },
  };
  await adapt(handler)(req as any, res as any);
  return { status, headers, cookies: (headers.get('set-cookie') || []) as string[], body: responseBody };
}

async function main() {
  const live = {
    NODE_ENV: 'production',
    OAUTH_CALLBACK_BASE_URL: 'https://api.kalpira.in',
    NEXT_PUBLIC_BASE_URL: 'https://www.kalpira.in',
  };
  configure(live);
  assertCookieDomain('.kalpira.in');
  assert.equal(getOauthStateCookieOptions().secure, true);
  assert.equal(getSessionCookieOptions().secure, true);

  configure({ ...live, COOKIE_DOMAIN: '' });
  assertCookieDomain('.kalpira.in');
  configure({ ...live, COOKIE_DOMAIN: '  .custom.example  ' });
  assertCookieDomain('.custom.example');
  configure({ ...live, NODE_ENV: 'development', COOKIE_DOMAIN: '.kalpira.in' });
  assertCookieDomain(undefined);
  assert.equal(getOauthStateCookieOptions().secure, false);
  assert.equal(getSessionCookieOptions().secure, false);

  for (const callback of ['http://localhost:3003', 'https://kalpira-backend.onrender.com',
    'https://kalpira.in.attacker.example', 'https://notkalpira.in', 'not-a-url', 'http://api.kalpira.in']) {
    configure({ ...live, OAUTH_CALLBACK_BASE_URL: callback });
    assertCookieDomain(undefined);
  }
  configure({ ...live, NEXT_PUBLIC_BASE_URL: 'https://preview.vercel.app' });
  assertCookieDomain(undefined);
  configure({ NODE_ENV: 'production' });
  assertCookieDomain(undefined);
  configure({ ...live, NODE_ENV: '', RENDER: 'true' });
  assertCookieDomain('.kalpira.in');
  console.log('PASS: shared domain, explicit override, development, and unrelated-host safeguards');

  // Populate only dummy configuration BEFORE loading routes that import the DB.
  configure({
    ...live, GOOGLE_CLIENT_ID: 'offline-test-client', GOOGLE_CLIENT_SECRET: 'offline-test-secret',
    SESSION_SECRET: 'offline-session-signing-secret-not-used-in-production', DEPLOYMENT_MODE: 'hosted',
    NEXT_PUBLIC_SUPABASE_URL: 'https://offline.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-test-key',
  });
  const db = require('../app/lib/supabaseDb').default;
  const originalFindFirst = db.user.findFirst;
  const originalExchange = arctic.Google.prototype.validateAuthorizationCode;
  let exchanges = 0;
  let lookups = 0;
  arctic.Google.prototype.validateAuthorizationCode = async () => {
    exchanges++;
    const claims = Buffer.from(JSON.stringify({ sub: 'offline-google-user', email: 'test@example.invalid', name: 'Test User' })).toString('base64url');
    return { idToken: () => `e30.${claims}.offline`, accessToken: () => 'offline' } as any;
  };
  db.user.findFirst = async ({ where }: any) => {
    lookups++;
    return { id: 'offline-user', role: where.role };
  };

  try {
    for (const flow of [
      { name: 'user', role: 'candidate', landing: '/studies' },
      { name: 'interviewer', role: 'interviewer', landing: '/interviewer/dashboard' },
    ]) {
      const start = require(`../app/api/auth/oauth/google/${flow.name}/route`).GET;
      const callback = require(`../app/api/auth/oauth/google/${flow.name}/callback/route`).GET;
      const routePath = `/api/auth/oauth/google/${flow.name}`;
      const initiated = await runRoute(start, `https://kalpira.in${routePath}`);
      assert.equal(initiated.status, 307);
      const googleUrl = new URL(initiated.headers.get('location') as string);
      assert.equal(googleUrl.searchParams.get('redirect_uri'), `https://api.kalpira.in${routePath}/callback`);
      assert.equal(initiated.cookies.length, 3);
      for (const cookie of initiated.cookies) {
        assert.match(cookie, /; Domain=\.kalpira\.in(?:;|$)/);
        assert.match(cookie, /; Secure(?:;|$)/);
        assert.match(cookie, /; SameSite=Lax(?:;|$)/);
      }
      const cookieHeader = initiated.cookies.map((cookie) => cookie.split(';')[0]).join('; ');
      const state = googleUrl.searchParams.get('state')!;
      const callbackUrl = `https://api.kalpira.in${routePath}/callback?code=offline&state=${encodeURIComponent(state)}`;
      const before = exchanges;
      for (const rejected of [
        { url: callbackUrl, cookies: '' },
        { url: callbackUrl.replace(encodeURIComponent(state), 'wrong-state'), cookies: cookieHeader },
        { url: callbackUrl, cookies: cookieHeader.split('; ').filter((c) => !c.startsWith(`google_${flow.name}_oauth_code_verifier=`)).join('; ') },
      ]) {
        const response = await runRoute(callback, rejected.url, rejected.cookies);
        assert.equal(new URL(response.headers.get('location') as string).searchParams.get('error'), 'invalid_state');
      }
      assert.equal(exchanges, before, 'Invalid state must never reach Google');

      const completed = await runRoute(callback, callbackUrl, cookieHeader);
      const landing = new URL(completed.headers.get('location') as string);
      assert.equal(completed.status, 307);
      assert.equal(landing.origin, 'https://kalpira.in', 'Stay on the initiating portal');
      assert.equal(landing.pathname, flow.landing);
      const sessionCookie = completed.cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))!;
      assert.ok(sessionCookie, 'Successful OAuth must issue a session');
      assert.match(sessionCookie, /; Domain=\.kalpira\.in(?:;|$)/);
      const token = decodeURIComponent(sessionCookie.split(';')[0].slice(SESSION_COOKIE_NAME.length + 1));
      const session = await verifySessionToken(token);
      assert.equal(session.valid, true);
      assert.equal(session.role, flow.role);
      const cleared = completed.cookies.filter((cookie) => cookie.includes('Max-Age=0'));
      assert.equal(cleared.length, 3);
      for (const cookie of cleared) assert.match(cookie, /; Domain=\.kalpira\.in(?:;|$)/);
      console.log(`PASS: ${flow.name} initiation, rejected state, callback, matching cleanup, and valid session`);
    }
    assert.equal(exchanges, 2);
    assert.equal(lookups, 2);

    const profileRoute = require('../app/api/auth/me/route');
    const authRoute = require('../app/api/auth/route');
    const originalFindUnique = db.user.findUnique;
    const originalUpdate = db.user.update;
    let identityLookups = 0;
    const user = {
      id: 'offline-interviewer', role: 'interviewer', name: 'Test Interviewer',
      email: 'test@example.invalid', avatarUrl: null, coverUrl: null,
      onboardingComplete: true, password: 'x'.repeat(16),
      encryptedGeminiApiKey: 'invalid-encrypted-data',
      encryptedAnthropicApiKey: 'invalid-encrypted-data',
    };
    db.user.findUnique = async ({ where }: any) => {
      identityLookups++;
      assert.equal(where.id, user.id, 'Profile must resolve only the session-bound identity');
      return user;
    };
    db.user.update = async ({ where, data }: any) => {
      assert.equal(where.id, user.id);
      return { ...user, ...data };
    };
    try {
      const url = 'https://kalpira.in/api/auth/me';
      for (const mode of ['hosted', 'standalone']) {
        process.env.DEPLOYMENT_MODE = mode;
        const token = await createSessionToken(user.id, user.role);
        const cookie = `${SESSION_COOKIE_NAME}=${token}`;
        const auth = await runRoute(authRoute.GET, 'https://kalpira.in/api/auth', cookie);
        assert.equal(JSON.parse(auth.body).authenticated, true);
        const profile = await runRoute(profileRoute.GET, url, cookie);
        assert.equal(profile.status, 200);
        const data = JSON.parse(profile.body);
        assert.equal(data.authenticated, true);
        assert.equal(data.profile.id, user.id);
        assert.equal(data.profile.role, 'interviewer');
        assert.equal(data.profile.password, undefined);
        assert.equal(data.profile.encryptedGeminiApiKey, undefined);
        assert.equal(data.profile.encryptedAnthropicApiKey, undefined);
        const updated = await runRoute(profileRoute.PATCH, url, cookie, { name: 'Updated Name' });
        assert.equal(updated.status, 200);
        assert.equal(JSON.parse(updated.body).profile.name, 'Updated Name');
        console.log(`PASS: ${mode} auth/profile agreement and updates despite unusable AI credentials`);
      }
      const before = identityLookups;
      for (const cookie of ['', `${SESSION_COOKIE_NAME}=invalid`,
        `${SESSION_COOKIE_NAME}=${await createSessionToken(undefined, 'admin')}`]) {
        assert.equal((await runRoute(profileRoute.GET, url, cookie)).status, 401);
        assert.equal((await runRoute(profileRoute.PATCH, url, cookie, { name: 'No access' })).status, 401);
      }
      assert.equal(identityLookups, before, 'Anonymous/global-admin sessions must not look up arbitrary profiles');
      console.log('PASS: missing, tampered, and identity-less sessions cannot read or edit profiles');
    } finally {
      db.user.findUnique = originalFindUnique;
      db.user.update = originalUpdate;
    }
  } finally {
    arctic.Google.prototype.validateAuthorizationCode = originalExchange;
    db.user.findFirst = originalFindFirst;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
