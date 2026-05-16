import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sessions = await prisma.interviewSession.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        averageScore: true,
        role: true,
        user: {
          select: { role: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Admin sessions error:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}
