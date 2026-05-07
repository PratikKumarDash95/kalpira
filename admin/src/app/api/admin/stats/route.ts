import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [totalUsers, totalStudies, totalSessions, recentUsers] = await Promise.all([
      prisma.user.count(),
      prisma.study.count(),
      prisma.interviewSession.count(),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, email: true, createdAt: true },
      }),
    ]);

    return NextResponse.json({ totalUsers, totalStudies, totalSessions, recentUsers });
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
