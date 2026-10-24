// OAuth may start through the frontend proxy and finish on api.kalpira.in.
// Both the temporary OAuth cookies and the session must cover those sibling
// hosts. Only infer our DNS-controlled domain from deployment configuration;
// never trust a request Host / Referer or guess another site's parent domain.
export function getAuthCookieDomain(): string | undefined {
  if (process.env.NODE_ENV === 'development') return undefined;

  const configuredDomain = process.env.COOKIE_DOMAIN?.trim();
  if (configuredDomain) return configuredDomain;

  const isFirstPartyUrl = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        (url.hostname === 'kalpira.in' || url.hostname.endsWith('.kalpira.in'));
    } catch {
      return false;
    }
  };

  if (isFirstPartyUrl(process.env.OAUTH_CALLBACK_BASE_URL) &&
      isFirstPartyUrl(process.env.NEXT_PUBLIC_BASE_URL)) {
    return '.kalpira.in';
  }

  return undefined;
}
