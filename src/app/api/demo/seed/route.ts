// POST /api/demo/seed - Seed demo data to database
// DELETE /api/demo/seed - Clear demo data from database
// Protected: Requires authenticated admin session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@/lib/researcherContext';
import { saveStudy, saveInterview, isKVAvailable, getAllStudies } from '@/lib/kv';
import { DEMO_STUDIES, DEMO_INTERVIEWS } from '@/lib/demoData';
import prisma from '@/lib/prisma';

export async function POST() {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured.' },
        { status: 503 }
      );
    }

    // Check if demo data already exists
    const existingStudies = await getAllStudies();
    const demoExists = existingStudies.some(s => s.id.startsWith('demo-'));
    if (demoExists) {
      return NextResponse.json(
        { error: 'Demo data already loaded. Clear it first if you want to reload.' },
        { status: 409 }
      );
    }

    // Seed studies
    let studiesSeeded = 0;
    for (const study of DEMO_STUDIES) {
      const success = await saveStudy(study);
      if (success) studiesSeeded++;
    }

    // Seed interviews
    let interviewsSeeded = 0;
    for (const interview of DEMO_INTERVIEWS) {
      const success = await saveInterview(interview);
      if (success) interviewsSeeded++;
    }

    return NextResponse.json({
      success: true,
      message: 'Demo data loaded successfully',
      data: {
        studiesSeeded,
        interviewsSeeded,
        aggregateSynthesisAvailable: true
      }
    });
  } catch (error) {
    console.error('Demo seed error:', error);
    return NextResponse.json(
      { error: 'Failed to seed demo data' },
      { status: 500 }
    );
  }
}

// DELETE /api/demo/seed - Clear demo data from database
export async function DELETE() {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured.' },
        { status: 503 }
      );
    }

    // Delete demo interviews first (referential integrity)
    const interviewResult = await prisma.storedInterview.deleteMany({
      where: { studyId: { startsWith: 'demo-' } },
    });

    // Delete demo studies
    const studyResult = await prisma.study.deleteMany({
      where: { id: { startsWith: 'demo-' } },
    });

    return NextResponse.json({
      success: true,
      message: 'Demo data cleared',
      data: {
        studiesDeleted: studyResult.count,
        interviewsDeleted: interviewResult.count
      }
    });
  } catch (error) {
    console.error('Demo clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear demo data' },
      { status: 500 }
    );
  }
}
