// Offline tests for the actual shared frontend session/query modules.
import assert from 'node:assert/strict';
import { fetchQuery, invalidateQuery, peekQuery, setQuery } from '../../../user/src/lib/queryCache';
import { fetchProfile, PROFILE_QUERY_KEY } from '../../../user/src/lib/profileQuery';
import { getAuthStatus, invalidateAuthStatus, peekAuthStatus } from '../../../user/src/lib/authStatus';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const originalFetch = globalThis.fetch;
const profile = { authenticated: true, profile: { id: 'new-user', name: 'New User', role: 'interviewer' } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

async function main() {
  invalidateAuthStatus();
  const oldProfile = deferred<null>();
  const beforeLogin = fetchQuery(PROFILE_QUERY_KEY, () => oldProfile.promise);
  invalidateAuthStatus();
  setQuery(PROFILE_QUERY_KEY, profile);
  oldProfile.resolve(null);
  await beforeLogin;
  assert.deepEqual(peekQuery(PROFILE_QUERY_KEY), profile, 'First-ever guest request cannot overwrite a new login');

  const oldName = deferred<typeof profile>();
  const beforeSave = fetchQuery(PROFILE_QUERY_KEY, () => oldName.promise);
  const updated = { ...profile, profile: { ...profile.profile, name: 'Updated Name' } };
  setQuery(PROFILE_QUERY_KEY, updated);
  oldName.resolve(profile);
  await beforeSave;
  assert.deepEqual(peekQuery(PROFILE_QUERY_KEY), updated, 'Late GET cannot undo a saved profile');

  const dashboard = deferred<{ interviewer: { id: string } }>();
  const beforeLogout = fetchQuery('/api/interviewer/dashboard-data', () => dashboard.promise);
  setQuery('/api/studies', ['private-study']);
  invalidateAuthStatus();
  dashboard.resolve({ interviewer: { id: 'old-user' } });
  await beforeLogout;
  assert.equal(peekQuery('/api/interviewer/dashboard-data'), undefined);
  assert.equal(peekQuery('/api/studies'), undefined);
  assert.equal(peekQuery(PROFILE_QUERY_KEY), undefined);
  console.log('PASS: late guest/profile/dashboard responses cannot restore pre-mutation or logged-out data');

  const pending = deferred<number>();
  let calls = 0;
  const first = fetchQuery('/api/test/dedup', () => { calls++; return pending.promise; });
  const second = fetchQuery('/api/test/dedup', () => { calls++; return pending.promise; });
  assert.equal(first, second);
  pending.resolve(42);
  await first;
  assert.equal(calls, 1);
  assert.equal(peekQuery('/api/test/dedup'), 42);

  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store');
    return json(profile);
  };
  await fetchQuery(PROFILE_QUERY_KEY, fetchProfile);
  for (const status of [403, 404, 429, 500, 503]) {
    globalThis.fetch = async () => json({ error: 'temporary' }, status);
    await assert.rejects(fetchQuery(PROFILE_QUERY_KEY, fetchProfile));
    assert.deepEqual(peekQuery(PROFILE_QUERY_KEY), profile);
  }
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(fetchQuery(PROFILE_QUERY_KEY, fetchProfile));
  assert.deepEqual(peekQuery(PROFILE_QUERY_KEY), profile);
  globalThis.fetch = async () => json({ authenticated: true, profile: null });
  await assert.rejects(fetchQuery(PROFILE_QUERY_KEY, fetchProfile));
  assert.deepEqual(peekQuery(PROFILE_QUERY_KEY), profile);
  globalThis.fetch = async () => json({ error: 'Unauthorized' }, 401);
  await fetchQuery(PROFILE_QUERY_KEY, fetchProfile);
  assert.equal(peekQuery(PROFILE_QUERY_KEY), null);
  console.log('PASS: profile errors preserve identity; only confirmed unauthenticated responses show Sign in');

  invalidateAuthStatus();
  const staleAuth = deferred<Response>();
  const currentAuth = deferred<Response>();
  let authCalls = 0;
  globalThis.fetch = async () => ++authCalls === 1 ? staleAuth.promise : currentAuth.promise;
  const staleRequest = getAuthStatus();
  assert.equal(getAuthStatus(), staleRequest, 'Auth requests are deduplicated');
  invalidateAuthStatus();
  const currentRequest = getAuthStatus();
  staleAuth.resolve(json({ authenticated: false }));
  currentAuth.resolve(json({ authenticated: true, researcherId: 'new-user' }));
  assert.equal((await staleRequest).researcherId, 'new-user', 'Existing guard must use post-login auth instead of redirecting back');
  assert.equal((await currentRequest).authenticated, true);
  assert.equal(authCalls, 2);
  assert.equal(peekAuthStatus()?.researcherId, 'new-user');

  invalidateAuthStatus();
  const staleSignedIn = deferred<Response>();
  globalThis.fetch = async () => staleSignedIn.promise;
  const previousSession = getAuthStatus();
  invalidateAuthStatus();
  globalThis.fetch = async () => json({ authenticated: false });
  staleSignedIn.resolve(json({ authenticated: true, researcherId: 'old-user' }));
  assert.equal((await previousSession).authenticated, false);
  assert.equal(peekAuthStatus(), null);
  console.log('PASS: old auth responses cannot redirect a new login or restore the previous session');
  invalidateQuery('/api/');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
  invalidateAuthStatus();
});
