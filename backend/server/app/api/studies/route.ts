// GET /api/studies - List all studies
// POST /api/studies - Create new study
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAllStudies, saveStudy, isKVAvailable } from '@/lib/kv';
import { getRequestContext } from '@/lib/researcherContext';
import { registerStudyOwnership } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';
import { StudyConfig, StoredStudy } from '@/types';
import { randomUUID } from 'crypto';
import supabaseDb from '@/lib/supabaseDb';
import { resolveEffectiveCandidatePlan } from '@/lib/candidatePlans';
import { withPlatformAiConfig } from '@/lib/platformAiConfig';

// Split a user's own studies into custom-study vs self-practice counts. Both are
// candidate-owned Study rows; a missing kind marker (older rows) counts as 'study'.
function countOwnStudies(studies: StoredStudy[]): { studies: number; practices: number } {
  let studyCount = 0;
  let practiceCount = 0;
  for (const s of studies) {
    if (s.config?.kind === 'practice') practiceCount += 1;
    else studyCount += 1;
  }
  return { studies: studyCount, practices: practiceCount };
}

// GET /api/studies - List all saved studies
export async function GET() {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json({
        studies: [],
        warning: 'Storage not configured.'
      });
    }

    const studies = await getAllStudies(researcherId || context.userId);
    return NextResponse.json({ studies });
  } catch (error) {
    console.error('Studies API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch studies' },
      { status: 500 }
    );
  }
}

// POST /api/studies - Create new study
export async function POST(request: Request) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
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

    const body = await request.json();
    const { config } = body as { config: StudyConfig };

    if (!config) {
      return NextResponse.json(
        { error: 'Missing required field: config' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!config.name || !config.researchQuestion || !config.coreQuestions?.length) {
      return NextResponse.json(
        { error: 'Study must have name, researchQuestion, and at least one core question' },
        { status: 400 }
      );
    }

    const ownerId = researcherId || context.userId;

    // Enforce the candidate's self-service subscription. Custom studies and
    // self-practices have SEPARATE caps. Interviewer-assigned interviews are
    // InterviewSession rows (not created here) and are never counted.
    // A missing kind marker defaults to a custom study.
    const kind: 'study' | 'practice' = config.kind === 'practice' ? 'practice' : 'study';
    if (ownerId) {
      const owner = await supabaseDb.user.findUnique({ where: { id: ownerId } });
      // Only candidates are gated here. Interviewers/admins creating via their own
      // flows are unaffected; this route is the candidate self-service path.
      if (owner && owner.role !== 'interviewer' && owner.role !== 'admin') {
        const { limits } = resolveEffectiveCandidatePlan(owner);
        const existing = await getAllStudies(ownerId);
        const used = countOwnStudies(existing);

        if (kind === 'practice' && used.practices >= limits.maxPractices) {
          return NextResponse.json(
            {
              error: `You've reached your plan's limit of ${limits.maxPractices} practice session${limits.maxPractices !== 1 ? 's' : ''}. Upgrade your subscription to create more.`,
              code: 'PLAN_LIMIT',
            },
            { status: 403 },
          );
        }
        if (kind === 'study' && used.studies >= limits.maxStudies) {
          return NextResponse.json(
            {
              error: `You've reached your plan's limit of ${limits.maxStudies} custom stud${limits.maxStudies !== 1 ? 'ies' : 'y'}. Upgrade your subscription to create more.`,
              code: 'PLAN_LIMIT',
            },
            { status: 403 },
          );
        }
      }
    }

    // Create server-assigned ID
    const now = Date.now();
    const studyId = randomUUID();

    // Update config with server-assigned ID and force platform AI. Candidates no
    // longer supply their own keys, so any client-sent aiProvider/aiModel is
    // overridden with the platform default here. The kind marker is preserved.
    const serverConfig: StudyConfig = withPlatformAiConfig({
      ...config,
      id: studyId,
      kind,
      createdAt: now
    });

    const storedStudy: StoredStudy = {
      id: studyId,
      config: serverConfig,
      createdAt: now,
      updatedAt: now,
      interviewCount: 0,
      isLocked: false
    };

    const success = await saveStudy(storedStudy, ownerId);
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to save study' },
        { status: 500 }
      );
    }

    // In hosted mode, register study ownership for cross-tenant lookup
    if (ownerId) {
      try {
        await registerStudyOwnership(studyId, ownerId);
      } catch (err) {
        console.warn('Failed to register study ownership:', err);
      }
    }

    return NextResponse.json({
      study: storedStudy,
      message: 'Study saved successfully'
    });
  } catch (error) {
    console.error('Create study API error:', error);
    return NextResponse.json(
      { error: 'Failed to create study' },
      { status: 500 }
    );
  }
}
