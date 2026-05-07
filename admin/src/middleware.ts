import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from './lib/auth';

const mainAppUrl = process.env.NEXT_PUBLIC_MAIN_APP_URL || 'http://localhost:3000';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : { valid: false };

  if (!session.valid) {
    const loginUrl = new URL('/login', mainAppUrl);
    loginUrl.searchParams.set('redirect', request.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
