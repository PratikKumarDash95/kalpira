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

// GET /api/studies - List all saved studies
export async function GET() {
  try {
    const { authorized, context, error } = await getRequestContext();
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

    const studies = await getAllStudies();
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

    // Create server-assigned ID
    const now = Date.now();
    const studyId = randomUUID();

    // Update config with server-assigned ID
    const serverConfig: StudyConfig = {
      ...config,
      id: studyId,
      createdAt: now
    };

    const storedStudy: StoredStudy = {
      id: studyId,
      config: serverConfig,
      createdAt: now,
      updatedAt: now,
      interviewCount: 0,
      isLocked: false
    };

    const success = await saveStudy(storedStudy);
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to save study' },
        { status: 500 }
      );
    }

    // In hosted mode, register study ownership for cross-tenant lookup
    if (isHostedMode() && researcherId) {
      try {
        await registerStudyOwnership(studyId, researcherId);
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
