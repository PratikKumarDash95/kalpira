// Keep browser API calls same-origin by default so Next.js rewrites proxy /api/*
// to the backend. This avoids depending on a public API DNS record and keeps
// session cookies first-party on www.kalpira.in.
const useDirectApi = process.env.NEXT_PUBLIC_API_DIRECT === 'true';
const apiBaseUrl = (useDirectApi ? process.env.NEXT_PUBLIC_API_URL || '' : '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    return apiBaseUrl ? `${apiBaseUrl}/${path}` : `/${path}`;
  }

  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

// Clear cached UI drafts (profile name/avatar, login email, admin tab, etc.)
// on logout so a NEXT visitor / role never sees the previous session's data.
export function clearSessionDrafts() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith('kalpira:')) keys.push(key);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Storage may be unavailable (private mode); nothing to clear then.
  }
}

export function apiFetch(input: string, init: RequestInit = {}) {
  return fetch(apiUrl(input), {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}
