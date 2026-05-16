
import { NextRequest, NextResponse } from 'next/server';

const CRITICAL_TYPES = new Set([
    'mobile_phone_detected',
    'multiple_faces_detected',
    'prolonged_absence',
    'camera_stream_stopped',
    'camera_disabled',
    'prolonged_absence_browser',
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
        // e.g. await prisma.violation.create({ ... })
        console.log(`[Proctor API] Violation reported for session ${sessionId}: ${type} - ${details || ''}`);
        if (isCritical) {
            console.log(`[Proctor API] Session ${sessionId} marked ${tag || 'cheating'}: ${finalReason}`);
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

    // Return a default state for rehydration
    return NextResponse.json({
        status: 'ACTIVE',
        violationCount: 0,
        complianceScore: 100,
        violations: [],
        terminatedReason: null
    });
}
