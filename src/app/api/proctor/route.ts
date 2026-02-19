
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, type, details } = body;

        // In a real implementation, you would store this in your database
        // e.g. await prisma.violation.create({ ... })
        console.log(`[Proctor API] Violation reported for session ${sessionId}: ${type} - ${details}`);

        // Return a mock state. In production, calculate this from DB.
        // For now, we just acknowledge the report.
        return NextResponse.json({
            status: 'ACTIVE',
            violationCount: 1, // Mock count, client will maintain its own cumulative count if server returns this
            complianceScore: 100, // Mock score
            violations: [], // Mock list
            terminatedReason: null
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
