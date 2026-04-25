// GET /api/studies/[id] - Get study details
// PUT /api/studies/[id] - Update study config (soft lock: warns if has interviews)
// DELETE /api/studies/[id] - Delete study (fails if has interviews)
// Protected: Requires authenticated session

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getStudy, saveStudy, deleteStudy, isKVAvailable } from '@/lib/kv';
import { getRequestContext } from '@/lib/researcherContext';
import { deleteStudyOwnership } from '@/lib/platformDb';
import { isHostedMode } from '@/lib/mode';
import { StudyConfig } from '@/types';

// GET /api/studies/[id] - Get single study
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured' },
        { status: 503 }
      );
    }

    const study = await getStudy(id);
    if (!study) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ study });
  } catch (error) {
    console.error('Get study API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch study' },
      { status: 500 }
    );
  }
}

// PUT /api/studies/[id] - Update study config
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured' },
        { status: 503 }
      );
    }

    const study = await getStudy(id);
    if (!study) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { config, confirmed } = body as {
      config: Partial<StudyConfig>;
      confirmed?: boolean;  // User acknowledged the warning
    };

    // Soft lock: warn if study has interviews, allow if user confirms
    if (study.interviewCount > 0 && !confirmed) {
      return NextResponse.json({
        warning: `This study has ${study.interviewCount} interview(s). Editing may affect data consistency.`,
        requiresConfirmation: true,
        interviewCount: study.interviewCount
      }, { status: 409 });
    }

    if (!config) {
      return NextResponse.json(
        { error: 'Missing required field: config' },
        { status: 400 }
      );
    }

    // Update config while preserving ID and createdAt
    const updatedConfig: StudyConfig = {
      ...study.config,
      ...config,
      id: study.id, // Preserve original ID
      createdAt: study.config.createdAt // Preserve original creation time
    };

    // Validate required fields still exist after merge
    if (!updatedConfig.name || !updatedConfig.researchQuestion) {
      return NextResponse.json(
        { error: 'Missing required fields: name and researchQuestion are required' },
        { status: 400 }
      );
    }
    if (!updatedConfig.coreQuestions || !Array.isArray(updatedConfig.coreQuestions) || updatedConfig.coreQuestions.length === 0) {
      return NextResponse.json(
        { error: 'At least one core question is required' },
        { status: 400 }
      );
    }

    const updatedStudy = {
      ...study,
      config: updatedConfig,
      updatedAt: Date.now()
    };

    const success = await saveStudy(updatedStudy);
    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update study' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      study: updatedStudy,
      message: 'Study updated successfully'
    });
  } catch (error) {
    console.error('Update study API error:', error);
    return NextResponse.json(
      { error: 'Failed to update study' },
      { status: 500 }
    );
  }
}

// DELETE /api/studies/[id] - Delete study
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const kvAvailable = await isKVAvailable();
    if (!kvAvailable) {
      return NextResponse.json(
        { error: 'Storage not configured' },
        { status: 503 }
      );
    }

    const study = await getStudy(id);
    if (!study) {
      return NextResponse.json(
        { error: 'Study not found' },
        { status: 404 }
      );
    }

    const result = await deleteStudy(id);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete study' },
        { status: 400 }
      );
    }

    // In hosted mode, clean up study ownership record
    if (isHostedMode() && researcherId) {
      try {
        await deleteStudyOwnership(id);
      } catch (err) {
        console.warn('Failed to delete study ownership:', err);
      }
    }

    return NextResponse.json({
      message: 'Study deleted successfully'
    });
  } catch (error) {
    console.error('Delete study API error:', error);
    return NextResponse.json(
      { error: 'Failed to delete study' },
      { status: 500 }
    );
  }
}
