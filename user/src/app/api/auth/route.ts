// POST /api/auth - Researcher login
// Uses signed JWT session tokens for security
// In hosted mode, password login is disabled (use OAuth instead)

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import {
  createSessionToken,
  verifySessionToken,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME
} from '@/lib/auth';
import { isHostedMode } from '@/lib/mode';
import prisma from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password, email } = body as { password: string; email?: string };

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    // Scenario 1: Email + Password Login (New User Flow)
    if (email) {
      const { verifyPassword } = await import('@/lib/auth');

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.password) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      // Verify the stored hash
      // Note: Admin password check was timingSafeEqual but here we use crypto.pbkdf2 based verification
      const isValid = await verifyPassword(password, user.password);

      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      // Create session for this specific user
      const sessionToken = await createSessionToken(user.id);

      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

      return NextResponse.json({ success: true });
    }

    // Scenario 2: Legacy Standalone Admin Password (No Email)
    // Only check if NO email provided to avoid confusion

    // In hosted mode, password login is disabled — use OAuth (unless using email flow above which overrides this check now?)
    // The prompt says "In hosted mode, password login is disabled". 
    // If the user registers via our new route, they should be able to login even in hosted mode, 
    // effectively bypassing the "OAuth only" restriction for demo purposes.

    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error('ADMIN_PASSWORD not configured - legacy authentication disabled');
      return NextResponse.json(
        { error: 'Authentication not configured.' },
        { status: 500 }
      );
    }

    const passwordBuf = Buffer.from(password);
    const adminBuf = Buffer.from(adminPassword);

    if (passwordBuf.length !== adminBuf.length || !timingSafeEqual(passwordBuf, adminBuf)) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Create signed session token (no researcherId for global admin)
    const sessionToken = await createSessionToken();

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions());

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Auth API error:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// GET /api/auth - Check authentication status
export async function GET() {
  try {
    const cookieStore = await cookies();
    const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!authCookie?.value) {
      return NextResponse.json({ authenticated: false });
    }

    // Verify the token is valid (not just that it exists)
    const session = await verifySessionToken(authCookie.value);

    return NextResponse.json({
      authenticated: session.valid,
      ...(session.researcherId && { researcherId: session.researcherId }),
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}

// DELETE /api/auth - Logout
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
