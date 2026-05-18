
import { NextRequest, NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';

const CRITICAL_TYPES = new Set([
    'mobile_phone_detected',
    'multiple_faces_detected',
    'prolonged_absence',
    'camera_stream_stopped',
    'camera_disabled',
    'prolonged_absence_browser',
    'fullscreen_exit',
    'devtools_open',
]);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, type, details, status, terminatedReason, tag } = body;
        const isCritical = status === 'TERMINATED' || CRITICAL_TYPES.has(type);
        const finalReason = terminatedReason
            || (type === 'mobile_phone_detected'
                ? 'Interview terminated: mobile phone detected. Candidate marked with cheating tag.'
                : isCritical
                    ? `Interview terminated due to ${String(type).replace(/_/g, ' ')}.`
                    : null);

        // In a real implementation, you would store this in your database
        // e.g. await supabaseDb.violation.create({ ... })
        console.log(`[Proctor API] Violation reported for session ${sessionId}: ${type} - ${details || ''}`);
        if (isCritical) {
            console.log(`[Proctor API] Session ${sessionId} marked ${tag || 'cheating'}: ${finalReason}`);
            if (sessionId && !String(sessionId).startsWith('guest-') && !String(sessionId).startsWith('fallback-')) {
                try {
                    await supabaseDb.interviewSession.update({
                        where: { id: sessionId },
                        data: {
                            mode: 'terminated',
                            completedAt: new Date(),
                            averageScore: 0,
                        },
                    });
                } catch (dbError) {
                    console.warn('[Proctor API] Failed to persist termination:', dbError);
                }
            }
        }

        // Return a mock state. In production, calculate this from DB.
        // For now, we just acknowledge the report.
        return NextResponse.json({
            status: isCritical ? 'TERMINATED' : 'ACTIVE',
            violationCount: 1, // Mock count, client will maintain its own cumulative count if server returns this
            complianceScore: isCritical ? 0 : 100, // Mock score
            violations: [{ sessionId, type, details, tag: isCritical ? (tag || 'cheating') : undefined }],
            tag: isCritical ? (tag || 'cheating') : undefined,
            terminatedReason: finalReason
        });
    } catch (error) {
        console.error('[Proctor API] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
        return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    try {
        const session = await supabaseDb.interviewSession.findUnique({
            where: { id: sessionId },
            select: { mode: true, completedAt: true },
        });

        if (session?.mode === 'terminated') {
            return NextResponse.json({
                status: 'TERMINATED',
                violationCount: 1,
                complianceScore: 0,
                violations: [{ sessionId, type: 'terminated', tag: 'cheating' }],
                terminatedReason: 'Interview was terminated due to a proctoring violation',
            });
        }
    } catch (error) {
        console.warn('[Proctor API] Failed to rehydrate persisted status:', error);
    }

    // Return a default state for rehydration
    return NextResponse.json({
        status: 'ACTIVE',
        violationCount: 0,
        complianceScore: 100,
        violations: [],
        terminatedReason: null
    });
}
