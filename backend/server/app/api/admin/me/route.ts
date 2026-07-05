// GET /api/admin/me — lightweight admin session check for the admin console.
// Returns 200 { admin: true, role, id } only for an admin session; 401 otherwise.
// The admin app calls this on load to gate its shell so a non-admin (candidate /
// interviewer) session can't view the admin UI by navigating to its URL.

import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getAdminUser();
  if (!user) {
    return NextResponse.json({ admin: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ admin: true, role: user.role, id: user.id });
}
