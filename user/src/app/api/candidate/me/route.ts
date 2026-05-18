import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/accessControl';
import supabaseDb from '@/lib/supabaseDb';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authUser = await getAuthUser();

  if (!authUser?.id || authUser.role !== 'candidate') {
    return NextResponse.json({ error: 'Candidate login required' }, { status: 401 });
  }

  const user = await supabaseDb.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}
