import { decodeJwt } from 'jose';

type GoogleProfileClaims = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type GoogleProfile = {
  id: string;
  email: string;
  name: string;
  picture: string | null;
};

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseGoogleIdToken(idToken: string): GoogleProfile | null {
  try {
    const claims = decodeJwt(idToken) as GoogleProfileClaims;
    const id = getString(claims.sub);
    const email = getString(claims.email);

    if (!id || !email) return null;

    return {
      id,
      email,
      name: getString(claims.name) || email.split('@')[0] || 'User',
      picture: getString(claims.picture),
    };
  } catch {
    return null;
  }
}

export async function getGoogleProfile(tokens: { idToken(): string; accessToken(): string }): Promise<GoogleProfile> {
  const idToken = tokens.idToken();
  const profileFromToken = parseGoogleIdToken(idToken);
  if (profileFromToken) {
    return profileFromToken;
  }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });

  if (!userResponse.ok) {
    throw new Error(`Google userinfo request failed (${userResponse.status})`);
  }

  const googleUser = await userResponse.json() as {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  const id = getString(googleUser.id);
  const email = getString(googleUser.email);

  if (!id || !email) {
    throw new Error('Google profile response missing required fields');
  }

  return {
    id,
    email,
    name: getString(googleUser.name) || email.split('@')[0] || 'User',
    picture: getString(googleUser.picture),
  };
}
