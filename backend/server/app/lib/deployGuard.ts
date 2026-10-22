// ============================================
// deployGuard.ts — refuse to boot a real deployment on dev-default secrets.
//
// Why this exists: `SESSION_SECRET` is what signs every session JWT (see
// ./auth.ts getSecret()), and it falls back to `ADMIN_PASSWORD` when unset.
// The repo's own `backend/.env` carries obviously-placeholder dev values for
// these four secrets. That file is correctly gitignored and was never
// committed, so the values themselves aren't "public" — but they are weak,
// short, and trivially guessable, and nothing in the code stops someone from
// copying this exact .env straight onto a production host (Render) instead of
// generating fresh secrets there. If that ever happens, anyone who guesses
// "demo123" (or just reads this file) can forge an admin session offline —
// no login required, full database access, since every route trusts the JWT
// signature and the DB layer bypasses RLS (see supabaseDb.ts).
//
// A warn-in-the-logs is not enough for this — it scrolls past unnoticed on a
// real deploy. This throws instead, so the app fails loudly at boot rather
// than quietly running in production with a guessable signing key.
// ============================================

// The exact known-weak values currently sitting in backend/.env's dev config,
// plus a few other common placeholders worth catching proactively.
const KNOWN_INSECURE_VALUES = new Set([
  'demo123',
  'kalpira-local-dev-session-secret',
  'kalpira-local-dev-participant-secret',
  'jYQti281vOuDbTzTrtIU7jWPIe7RSLYfx7iDsUONvsc=',
  'changeme',
  'change-me',
  'secret',
  'password',
  'your-session-secret',
  'your-participant-token-secret',
  'your-admin-password',
]);

const MIN_SECRET_LENGTH = 32;

function isWeak(value: string | undefined): boolean {
  if (!value) return true;
  if (KNOWN_INSECURE_VALUES.has(value)) return true;
  if (value.length < MIN_SECRET_LENGTH) return true;
  return false;
}

/**
 * Call this at process startup, before anything accepts traffic. Throws when
 * the deployment looks like a real (cross-site / hosted) one but is still
 * running on a dev-default or too-short signing secret.
 *
 * `isRealDeployment` is passed in (rather than computed here from
 * isCrossSiteDeployment) so this module stays dependency-free and testable —
 * server.ts already computes that signal for cookie config and can reuse it.
 */
export function assertDeployedSecretsAreStrong(isRealDeployment: boolean): void {
  if (!isRealDeployment) return;

  const problems: string[] = [];

  if (isWeak(process.env.SESSION_SECRET)) {
    problems.push('SESSION_SECRET is missing, too short (<32 chars), or a known dev placeholder.');
  }
  if (isWeak(process.env.PARTICIPANT_TOKEN_SECRET)) {
    problems.push('PARTICIPANT_TOKEN_SECRET is missing, too short (<32 chars), or a known dev placeholder.');
  }
  if (isWeak(process.env.ADMIN_PASSWORD)) {
    problems.push('ADMIN_PASSWORD is missing, too short (<32 chars), or a known dev placeholder — this also keys the session fallback in ./auth.ts.');
  }
  if (process.env.CREDENTIAL_ENCRYPTION_KEY && KNOWN_INSECURE_VALUES.has(process.env.CREDENTIAL_ENCRYPTION_KEY)) {
    problems.push('CREDENTIAL_ENCRYPTION_KEY is the known dev placeholder value.');
  }

  // The whole authorization model rests on the service-role key: every query
  // runs through it and the tables rely on app-level ownership checks, not
  // Postgres RLS (see supabaseDb.ts). If that key is missing on a real
  // deployment, supabaseDb silently falls back to the browser PUBLISHABLE key,
  // and every read/write then runs under RLS with no matching policy — returning
  // empty sets that look like "no data" or a login bug, not a misconfig. That
  // silent degradation is far worse to debug than a boot failure, and the
  // publishable key is public by design, so leaning on it is never correct.
  const hasServiceRoleKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  );
  if (!hasServiceRoleKey) {
    problems.push('No SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) is set — the app would run against the public anon key and silently degrade every data route.');
  }

  if (problems.length) {
    throw new Error(
      '[deployGuard] Refusing to start on insecure secrets in a real deployment:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nGenerate fresh values (e.g. `openssl rand -base64 48`) and set them on the host ' +
        '(Render dashboard → Environment Variables) — do NOT just edit backend/.env, since ' +
        'it is gitignored and never reaches the deployed app anyway.'
    );
  }
}
