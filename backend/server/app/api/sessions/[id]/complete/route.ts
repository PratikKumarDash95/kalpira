// POST /api/sessions/[id]/complete — Mark session complete and compute ScoreBreakdown
import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { getParticipantRequestContext } from '@/lib/researcherContext';
import { getAuthUser } from '@/lib/accessControl';
import { recomputeUserAbilities } from '@/lib/measurement/abilityService';

export const dynamic = 'force-dynamic';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: sessionId } = await params;

        if (sessionId.startsWith('guest-') || sessionId.startsWith('fallback-')) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            include: { responses: true, study: true },
        });

        if (!session) {
            return NextResponse.json({ success: true, skipped: true });
        }

        if (session.studyId) {
            const authUser = await getAuthUser();
            if (authUser?.id && authUser.role === 'candidate' && session.userId === authUser.id) {
                // Authenticated candidate owns this assigned session.
            } else {
            const participantAuth = await getParticipantRequestContext(request);
            if (
                !participantAuth.valid ||
                !participantAuth.context ||
                participantAuth.studyId !== session.studyId ||
                participantAuth.context.userId !== session.study?.userId
            ) {
                return NextResponse.json({ error: 'Valid participant link required for this session' }, { status: 401 });
            }
            }
        }

        const responses = session.responses;
        const count = responses.length || 1;

        // Compute averages
        const avg = (field: keyof typeof responses[0]) =>
            responses.reduce((sum: number, r: any) => sum + (r[field] as number), 0) / count;

        const technicalAverage = avg('technicalScore');
        const communicationAverage = avg('communicationScore');
        const confidenceAverage = avg('confidenceScore');
        const logicAverage = avg('logicScore');
        const depthAverage = avg('depthScore');
        const overallScore = (technicalAverage + communicationAverage + confidenceAverage + logicAverage + depthAverage) / 5;

        // Upsert ScoreBreakdown
        await supabaseDb.scoreBreakdown.upsert({
            where: { sessionId },
            create: {
                sessionId,
                overallScore,
                technicalAverage,
                communicationAverage,
                confidenceAverage,
                logicAverage,
                depthAverage,
            },
            update: {
                overallScore,
                technicalAverage,
                communicationAverage,
                confidenceAverage,
                logicAverage,
                depthAverage,
            },
        });

        // Update session with completedAt and averageScore
        await supabaseDb.interviewSession.update({
            where: { id: sessionId },
            data: {
                completedAt: new Date(),
                averageScore: overallScore,
            },
        });

        // Bring the candidate's measured ability profile up to date now that the
        // session's responses are final. Awaited rather than fired and forgotten:
        // a candidate who lands on their ability map right after finishing should
        // see this session in it, and this only touches one user's rows.
        //
        // Never fatal — measurement is an enhancement of the results, so a
        // failure here must not cost the candidate their completed session.
        let measured = false;
        if (session.userId && responses.length > 0) {
            try {
                await recomputeUserAbilities(session.userId, { sessionId });
                measured = true;
            } catch (measurementError) {
                console.error(
                    '[sessions/complete] Ability recompute failed (session still completed):',
                    measurementError
                );
            }
        }

        return NextResponse.json({ success: true, overallScore, measured });
    } catch (error) {
        console.error('Session complete error:', error);
        return NextResponse.json({ success: true, skipped: true });
    }
}
