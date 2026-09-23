// POST /api/demo/seed - Seed demo data to database
// DELETE /api/demo/seed - Clear demo data from database
// Protected: Requires authenticated admin session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/adminAuth';
import { saveStudy, saveInterview, isKVAvailable, getAllStudies } from '@/lib/kv';
import { DEMO_STUDIES, DEMO_INTERVIEWS } from '@/lib/demoData';
import supabaseDb from '@/lib/supabaseDb';

// ── Why this route is gated twice ────────────────────────────────────────────
//
// It was guarded by `getRequestContext()`, which authorizes ANY valid session —
// every signed-in user, not just admins. That is the wrong question for a route
// that writes into a shared `demo-` namespace and, on DELETE, removes every demo
// study and interview in the database with no owner filter: a routine call let
// any account wipe demo data belonging to everyone.
//
// So: `getAdminUser()` (the same admin gate every other admin and destructive
// route uses), every write and delete scoped to the caller's own id, and a
// deployment guard. None of the three apps calls this route — its only
// reference in the frontends is a commented-out line — so it is a development
// convenience, and deployed it stays off until someone deliberately enables it.
function demoSeedingDisabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true';
}

export async function POST() {
  try {
    if (demoSeedingDisabled()) {
      return NextResponse.json(
        { error: 'Demo seeding is disabled in this deployment. Set ALLOW_DEMO_SEED=true to enable it.' },
        { status: 403 }
      );
    }

    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const ownerId = admin.id;

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
      const success = await saveStudy(study, ownerId);
      if (success) studiesSeeded++;
    }

    // Seed interviews
    let interviewsSeeded = 0;
    for (const interview of DEMO_INTERVIEWS) {
      const success = await saveInterview({ ...interview, userId: ownerId } as typeof interview);
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
    if (demoSeedingDisabled()) {
      return NextResponse.json(
        { error: 'Demo seeding is disabled in this deployment. Set ALLOW_DEMO_SEED=true to enable it.' },
        { status: 403 }
      );
    }

    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const ownerId = admin.id;

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured.' },
        { status: 503 }
      );
    }

    // Both deletes are scoped to the caller's own demo rows. The `demo-` prefix
    // bounded the blast radius but not the ownership: unscoped, this removed
    // every demo study and interview in the database for every account.
    const ownerScope = { userId: ownerId };

    // Delete demo interviews first (referential integrity)
    const interviewResult = await supabaseDb.storedInterview.deleteMany({
      where: { ...ownerScope, studyId: { startsWith: 'demo-' } },
    });

    // Delete demo studies
    const studyResult = await supabaseDb.study.deleteMany({
      where: { ...ownerScope, id: { startsWith: 'demo-' } },
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
