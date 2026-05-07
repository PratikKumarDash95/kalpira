import * as jose from 'jose';

export const SESSION_COOKIE_NAME = 'research-auth';

function getSecret(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  return secret ? new TextEncoder().encode(secret) : null;
}

export async function verifySessionToken(token: string): Promise<{ valid: boolean; researcherId?: string }> {
  const secret = getSecret();
  if (!token || !secret) return { valid: false };

  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.type !== 'session') return { valid: false };
    return { valid: true, researcherId: payload.researcherId as string | undefined };
  } catch {
    return { valid: false };
  }
}
