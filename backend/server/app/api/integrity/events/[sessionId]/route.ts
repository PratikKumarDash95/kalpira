// ============================================
// POST /api/integrity/events — record browser proctoring signals
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// The one route a candidate's browser writes to. It is deliberately narrow: it
// accepts a batch of observations, minimizes each payload, and stores them. It does
// not score, and it does not return anything about the session — a client that could
// read the running score could tune what it reports.
//
// WHAT A CLIENT IS ALLOWED TO SAY
//
// The event type and, for some types, a duration or a count. Nothing else survives
// the minimizer. A paste is recorded as having happened; the pasted text is dropped
// on the floor, because it is the candidate's answer and belongs in the answers
// table rather than in a signal log.
//
// The severity on each stored row comes from the signal registry, never from the
// request body — otherwise a client could label its own paste events 'info' and talk
// its way out of the only high-severity proctoring signal there is.
//
// WHY A LINK OR THE OWNER RATHER THAN JUST THE OWNER
//
// Most interviews are sat through a participant link by someone who is not signed in,
// so requiring a session cookie would mean the layer records nothing for exactly the
// sessions it exists for. The link is scoped to the session's own study and its
// issuing owner by `resolveSessionAccess`.
//
// BATCHED, AND TOLERANT OF A BAD BATCH
//
// Events arrive in batches because a client that posted one request per keystroke
// pattern would be a denial-of-service against itself. A malformed batch is refused
// whole rather than partly stored, so a client bug cannot leave half an answer's
// events in the record with no way to tell which half.
// ============================================

import { NextResponse } from 'next/server';
import { resolveSessionAccess } from '@/lib/sessionAccess';
import { recordEvents } from '@/lib/integrity/integrityService';
import type { RawIntegrityEvent } from '@/lib/integrity/proctoringMath';

export const dynamic = 'force-dynamic';

/** Most events one request may carry. A batch larger than this is a client fault. */
const MAX_BATCH = 500;

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
    try {
        const { sessionId } = await params;

        const access = await resolveSessionAccess(request, sessionId, { allowParticipantLink: true });
        if (access.state === 'denied') return access.response;

        const body = await request.json().catch(() => null);
        const events = Array.isArray(body?.events) ? (body.events as RawIntegrityEvent[]) : null;

        if (!events) {
            return NextResponse.json({ error: 'A batch of events is required' }, { status: 400 });
        }
        if (events.length === 0) {
            return NextResponse.json({ success: true, accepted: 0, rejected: 0 });
        }
        if (events.length > MAX_BATCH) {
            return NextResponse.json(
                { error: `A batch may carry at most ${MAX_BATCH} events` },
                { status: 413 }
            );
        }

        const result = await recordEvents({
            sessionId,
            userId: access.ownerId,
            events,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('[integrity/events] Could not record events:', error);
        return NextResponse.json({ error: 'Could not record events' }, { status: 500 });
    }
}
