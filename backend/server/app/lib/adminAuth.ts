// Shared admin authorization for /api/admin/* routes.
//
// The admin console can be reached two ways:
//   1. Legacy admin-password login → session token has NO researcherId
//      (see createSessionToken() with no args). accessControl.getAuthUser()
//      already maps this to { id: null, role: 'admin', isLegacyAdmin: true }.
//   2. A real user account whose role === 'admin' (email/OAuth login) → the
//      session carries a researcherId.
//
// The old per-route isAdmin() rejected case (1) outright (it required
// result.researcherId), so the legacy admin — the very account that logs into
// the console — got 401 on every request and the UI silently rendered zeros.
// Centralizing here fixes that and keeps all admin routes consistent.

import { NextResponse } from 'next/server';
import { getAuthUser, type AuthUser } from './accessControl';

// Returns the AuthUser when the caller is an admin, otherwise null.
export async function getAdminUser(): Promise<AuthUser | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return user.role === 'admin' ? user : null;
}

// Convenience for route handlers: returns a 401 NextResponse when not an admin,
// or null when authorized (so the caller can proceed).
export async function requireAdmin(): Promise<NextResponse | null> {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
