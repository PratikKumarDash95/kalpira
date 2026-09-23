// ============================================
// deliveryService.ts — job lifecycle and persistence for delivery analysis
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// The DB half of the feature. Everything that decides *what* a measurement means
// lives in capture.ts and the math modules; this file only stores the result,
// records that it happened, and reads it back.
//
// THE JOB MODEL, HONESTLY DESCRIBED
//
// Analysis is a job with a lifecycle: queued → running → succeeded / failed, with
// an attempt count, a lease, and a retained error. The endpoint that saves an
// answer drains its job inline, so in the normal case the whole thing finishes
// inside that one request — the derivation is pure arithmetic over a few thousand
// numbers, and deferring it would only add latency to a live interview.
//
// The row is kept anyway because inline processing alone cannot answer two
// questions that matter: *did this answer get analysed, and if not, why* — and
// *may I run it again*. A failure here is a visible, retryable row rather than a
// line in a log nobody reads, and a separate worker can claim 'queued' rows later
// without a schema change.
//
// A NOTE ON CONCURRENCY
//
// Claiming a job is a read-then-write, not an atomic compare-and-swap: the query
// wrapper cannot express `update ... where status = 'queued'`. Two workers could
// therefore claim the same job. That is survivable rather than papered over — the
// metric write is a delete-then-insert against a unique (responseId, metricKey)
// key, so a double run converges on one set of rows instead of duplicating them,
// and the score write is idempotent because it recomputes from the same stored
// base (see `baseScoresFor`). What it must never do is apply the adjustment twice,
// which is precisely what the stored base prevents.

import supabaseDb from '../supabaseDb';
import {
    analyzeDelivery,
    parseCapture,
    aggregateDeliveryMetrics,
    type DeliveryAnalysis,
    type DeliveryCapturePayload,
    type DeliveryMetricResult,
    type DeliveryTimeline,
    type MetricAggregate,
    type ParsedCapture,
} from './capture';
import type { FusionResult } from './fusion';
import { metricDefinition } from './contract';

/** The only job kind today; named so the column has a meaning from the start. */
export const JOB_KIND = 'delivery';

// Re-exported so a caller that only touches this service does not have to reach
// into the pure layer for the shape of the payload it is handing over.
export type { DeliveryCapturePayload };

/** Attempts after which a job stops being retried and stays failed for a human. */
export const MAX_ATTEMPTS = 3;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * The persisted fusion record.
 *
 * Snapshotted rather than recomputed. The text-derived scores it started from are
 * not kept, and a scoring decision that can be silently re-derived from changed
 * constants is not an audit trail — it is a number that quietly moves.
 */
export interface StoredFusionRecord {
    version: number;
    applied: boolean;
    reason: string | null;
    communication: FusionResult['communication'];
    confidence: FusionResult['confidence'];
    caveats: string[];
    /** What was missing from the capture itself, which is not the same as what was unmeasured. */
    captureIssues: string[];
    /** Metric keys that carry no measurement for this answer. */
    unmeasured: string[];
    /**
     * The answer's delivery contour at display resolution, for the report screen.
     * Absent for answers analysed before this existed, and for those with no audio.
     */
    timeline?: DeliveryTimeline | null;
    analyzedAt: string;
}

// --------------------------------------------
// Enqueue
// --------------------------------------------

/**
 * Records that an answer has a capture waiting to be analysed.
 *
 * Returns null rather than throwing when the job cannot be created. This runs
 * inside the request that saves a candidate's answer: losing the analysis is a
 * degraded session, but losing the answer is a lost interview, so the failure is
 * logged and swallowed.
 */
export async function enqueueDeliveryAnalysis(params: {
    responseId: string;
    sessionId: string;
    userId?: string | null;
    payload: DeliveryCapturePayload;
}): Promise<string | null> {
    try {
        const job = await supabaseDb.analysisJob.create({
            data: {
                responseId: params.responseId,
                sessionId: params.sessionId,
                userId: params.userId ?? null,
                kind: JOB_KIND,
                status: 'queued',
                attempts: 0,
                maxAttempts: MAX_ATTEMPTS,
                payload: params.payload ?? {},
            },
        });
        return job.id as string;
    } catch (error) {
        console.error('[delivery] Could not enqueue an analysis job:', error);
        return null;
    }
}

// --------------------------------------------
// Run
// --------------------------------------------

export interface DeliveryJobOutcome {
    jobId: string;
    status: JobStatus;
    /** Why the job did not run, when it did not. Safe to log and to show an admin. */
    skippedReason: string | null;
    analysis: DeliveryAnalysis | null;
    error: string | null;
}

const WORKER_ID = `inline-${process.pid}`;

/**
 * Claims a job and runs it: derives the metrics, stores them, and applies the
 * score adjustment to the response.
 *
 * Idempotent in both directions. A job that already succeeded is left alone, and a
 * response that was already analysed is re-analysed from its *stored* pre-fusion
 * base rather than from its current adjusted scores — so running this twice cannot
 * apply the same adjustment twice.
 */
export async function runDeliveryJob(jobId: string): Promise<DeliveryJobOutcome> {
    const skipped = (status: JobStatus, reason: string): DeliveryJobOutcome => ({
        jobId,
        status,
        skippedReason: reason,
        analysis: null,
        error: null,
    });

    const job = await supabaseDb.analysisJob.findUnique({ where: { id: jobId } });
    if (!job) {
        return {
            jobId,
            status: 'failed',
            skippedReason: null,
            analysis: null,
            error: 'The analysis job no longer exists.',
        };
    }

    if (job.status === 'succeeded') return skipped('succeeded', 'This answer was already analysed.');

    const attempts = Number(job.attempts ?? 0);
    const maxAttempts = Number(job.maxAttempts ?? MAX_ATTEMPTS);
    if (attempts >= maxAttempts) {
        return skipped('failed', `This analysis has already failed ${attempts} times and will not be retried automatically.`);
    }

    // Claim.
    await supabaseDb.analysisJob.update({
        where: { id: jobId },
        data: {
            status: 'running',
            attempts: attempts + 1,
            claimedBy: WORKER_ID,
            claimedAt: new Date().toISOString(),
            startedAt: job.startedAt ?? new Date().toISOString(),
            lastError: null,
        },
    });

    try {
        const response = await supabaseDb.response.findUnique({ where: { id: job.responseId } });
        if (!response) {
            throw new Error('The response this analysis belongs to no longer exists.');
        }

        const capture = parseCapture(job.payload as DeliveryCapturePayload | null);
        const base = baseScoresFor(response);

        const analysis = analyzeDelivery({
            capture,
            transcript: String(response.answerText ?? ''),
            communicationScore: base.communication,
            confidenceScore: base.confidence,
        });

        // Response has no userId of its own, so the owner comes from the job or,
        // failing that, from the session. Getting this wrong would not fail
        // loudly — it would write metric rows that never appear in the
        // candidate's own profile, which is the kind of bug that hides for months.
        const userId = await resolveUserId(response, job);

        await persistAnalysis({
            responseId: String(response.id),
            sessionId: String(response.sessionId ?? job.sessionId ?? ''),
            userId,
            analysis,
            capture,
        });

        const record: StoredFusionRecord = {
            version: 1,
            applied: analysis.fusion.applied,
            reason: analysis.fusion.reason,
            communication: analysis.fusion.communication,
            confidence: analysis.fusion.confidence,
            caveats: analysis.fusion.caveats,
            captureIssues: capture.issues,
            unmeasured: analysis.fusion.unmeasured,
            // The contour is stored beside the metrics so the report can draw the
            // answer and the numbers from one reading of the same analysis. It is
            // derived, decimated, and holds no speech — see TIMELINE_INTERVAL_MS.
            timeline: analysis.timeline,
            analyzedAt: new Date().toISOString(),
        };

        // The raw payload is cleared here, on success, and kept on failure so the
        // job can be retried. See the retention note in the migration.
        await supabaseDb.analysisJob.update({
            where: { id: jobId },
            data: {
                status: 'succeeded',
                finishedAt: new Date().toISOString(),
                payload: null,
                result: record,
                lastError: null,
            },
        });

        return { jobId, status: 'succeeded', skippedReason: null, analysis, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[delivery] Analysis job ${jobId} failed:`, error);

        try {
            await supabaseDb.analysisJob.update({
                where: { id: jobId },
                data: {
                    status: 'failed',
                    finishedAt: new Date().toISOString(),
                    lastError: message.slice(0, 1000),
                },
            });
        } catch (updateError) {
            // Nothing further to do: the job is already unclaimable and the
            // original error is the one worth reporting.
            console.error(`[delivery] Could not record the failure of job ${jobId}:`, updateError);
        }

        return { jobId, status: 'failed', skippedReason: null, analysis: null, error: message };
    }
}

/**
 * Enqueues a capture and runs it in one call — the path the save-answer endpoint
 * takes.
 */
export async function analyzeResponseDelivery(params: {
    responseId: string;
    sessionId: string;
    userId?: string | null;
    payload: DeliveryCapturePayload;
}): Promise<DeliveryJobOutcome | null> {
    const jobId = await enqueueDeliveryAnalysis(params);
    if (!jobId) return null;
    return runDeliveryJob(jobId);
}

/**
 * Re-runs jobs that failed and still have attempts left.
 *
 * The retry surface the job table exists for. Bounded by `limit` so a sweep cannot
 * turn into an unbounded burst of work in one request.
 */
export async function retryPendingDeliveryJobs(limit = 10): Promise<DeliveryJobOutcome[]> {
    const failed = await supabaseDb.analysisJob.findMany({
        where: { status: 'failed', kind: JOB_KIND },
        orderBy: { createdAt: 'asc' },
        take: limit,
    });

    const outcomes: DeliveryJobOutcome[] = [];
    for (const job of failed) {
        const attempts = Number(job.attempts ?? 0);
        const maxAttempts = Number(job.maxAttempts ?? MAX_ATTEMPTS);
        // A cleared payload means the job already succeeded once; a missing one
        // means there is nothing left to analyse. Both are skipped rather than
        // counted as another failure.
        if (attempts >= maxAttempts || !job.payload) continue;
        outcomes.push(await runDeliveryJob(String(job.id)));
    }
    return outcomes;
}

// --------------------------------------------
// Persistence
// --------------------------------------------

/**
 * The scores the adjustment should be applied to.
 *
 * On a first analysis that is what the response currently holds. On a re-analysis
 * the stored score has already been adjusted once, so the pre-fusion value is read
 * back out of the previous record instead. Without this, retrying a job would apply
 * the same penalty twice — the failure mode that makes naive recompute-in-place
 * dangerous.
 */
function baseScoresFor(response: Record<string, any>): { communication: number; confidence: number } {
    const previous = response.deliveryJSON as StoredFusionRecord | null | undefined;
    const previousCommunication = previous?.communication?.before;
    const previousConfidence = previous?.confidence?.before;

    return {
        communication:
            typeof previousCommunication === 'number' && Number.isFinite(previousCommunication)
                ? previousCommunication
                : Number(response.communicationScore ?? 0),
        confidence:
            typeof previousConfidence === 'number' && Number.isFinite(previousConfidence)
                ? previousConfidence
                : Number(response.confidenceScore ?? 0),
    };
}

/**
 * The candidate a set of delivery metrics belongs to.
 *
 * Response carries no owner column, so this walks outward: the enqueuing job
 * usually knows, and the session always does. Returning null is allowed — a guest
 * session has no user — but a *wrong* null would silently detach the metrics from
 * the person they describe, so the session is consulted rather than assumed.
 */
async function resolveUserId(
    response: Record<string, any>,
    job: Record<string, any>
): Promise<string | null> {
    if (job.userId) return String(job.userId);

    const sessionId = response.sessionId ?? job.sessionId;
    if (!sessionId) return null;

    try {
        const session = await supabaseDb.interviewSession.findUnique({ where: { id: String(sessionId) } });
        return session?.userId ? String(session.userId) : null;
    } catch (error) {
        console.error('[delivery] Could not resolve the session owner for an analysis:', error);
        return null;
    }
}

async function persistAnalysis(params: {    responseId: string;
    sessionId: string;
    userId: string | null;
    analysis: DeliveryAnalysis;
    capture: ParsedCapture;
}): Promise<void> {
    const { responseId, sessionId, userId, analysis } = params;

    // Delete-then-insert keeps a re-analysis from accumulating duplicate rows, and
    // the unique (responseId, metricKey) key is the backstop if two runs interleave.
    await supabaseDb.deliveryMetric.deleteMany({ where: { responseId } });

    await supabaseDb.deliveryMetric.createMany({
        data: analysis.metrics.map((metric: DeliveryMetricResult) => ({
            responseId,
            sessionId,
            userId,
            metricKey: metric.key,
            value: metric.value,
            unit: metric.unit,
            position: metric.position,
            impact: metric.impact,
            inBand: metric.inBand,
            measured: metric.measured,
            source: metric.source,
            explanation: metric.explanation,
        })),
    });

    const record: StoredFusionRecord = {
        version: 1,
        applied: analysis.fusion.applied,
        reason: analysis.fusion.reason,
        communication: analysis.fusion.communication,
        confidence: analysis.fusion.confidence,
        caveats: analysis.fusion.caveats,
        captureIssues: analysis.issues,
        unmeasured: analysis.fusion.unmeasured,
        analyzedAt: new Date().toISOString(),
    };

    await supabaseDb.response.update({
        where: { id: responseId },
        data: {
            // The adjusted scores are what the rest of the platform reads, so the
            // delivery evidence genuinely reaches the transcript-derived score
            // rather than sitting in a side table nobody consults.
            communicationScore: analysis.fusion.communication.after,
            confidenceScore: analysis.fusion.confidence.after,
            deliveryCommunicationDelta: analysis.fusion.communication.delta,
            deliveryConfidenceDelta: analysis.fusion.confidence.delta,
            deliveryJSON: record,
            deliveryAnalyzedAt: record.analyzedAt,
        },
    });
}

// --------------------------------------------
// Reads
// --------------------------------------------

export interface ResponseDeliveryView {
    responseId: string;
    questionText: string | null;
    answerPreview: string;
    metrics: DeliveryMetricResult[];
    fusion: StoredFusionRecord | null;
    /** Job state for this answer, so a reader can tell "not measured" from "not analysed". */
    jobStatus: JobStatus | 'none';
    jobError: string | null;
}

export interface SessionDeliveryView {
    sessionId: string;
    responses: ResponseDeliveryView[];
    aggregate: MetricAggregate[];
    /** Answers that were analysed, out of answers in the session. */
    analyzedCount: number;
    responseCount: number;
    /** Union of every caveat raised across the session's answers. */
    caveats: string[];
    /** Union of every capture problem, so a systematic failure is visible. */
    captureIssues: string[];
}

function toMetricResult(row: Record<string, any>): DeliveryMetricResult {
    const key = String(row.metricKey);
    return {
        key,
        // Labels are presentation, so they come from the registry rather than being
        // copied into every row: renaming a metric should rename it everywhere, not
        // leave thousands of rows carrying the old name.
        label: metricDefinition(key)?.label ?? key,
        unit: (row.unit ?? 'index') as DeliveryMetricResult['unit'],
        value: typeof row.value === 'number' ? row.value : null,
        position: Number(row.position ?? 0),
        impact: Number(row.impact ?? 0),
        inBand: Boolean(row.inBand),
        measured: Boolean(row.measured),
        source: (row.source ?? 'audio') as DeliveryMetricResult['source'],
        explanation: String(row.explanation ?? ''),
    };
}

/**
 * Everything measured about one session's answers, per answer and rolled up.
 *
 * Reads the persisted rows rather than re-deriving: what the candidate is shown
 * has to be what the score was actually built from, including the case where a
 * metric could not be measured.
 */
export async function sessionDelivery(sessionId: string): Promise<SessionDeliveryView> {
    const [responses, questions, metrics, jobs] = await Promise.all([
        supabaseDb.response.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
        supabaseDb.question.findMany({ where: { sessionId } }),
        supabaseDb.deliveryMetric.findMany({ where: { sessionId } }),
        supabaseDb.analysisJob.findMany({ where: { sessionId, kind: JOB_KIND } }),
    ]);

    const questionById = new Map<string, string>(
        (questions as Record<string, any>[]).map((question) => [String(question.id), String(question.text ?? '')])
    );
    const jobByResponse = new Map<string, Record<string, any>>(
        (jobs as Record<string, any>[])
            .filter((job) => job.responseId)
            .map((job) => [String(job.responseId), job])
    );

    const metricsByResponse = new Map<string, DeliveryMetricResult[]>();
    for (const row of metrics as Record<string, any>[]) {
        const key = String(row.responseId);
        const list = metricsByResponse.get(key) ?? [];
        list.push(toMetricResult(row));
        metricsByResponse.set(key, list);
    }

    const caveats = new Set<string>();
    const captureIssues = new Set<string>();
    const perResponseMetrics: DeliveryMetricResult[][] = [];
    let analyzedCount = 0;

    const views: ResponseDeliveryView[] = (responses as Record<string, any>[]).map((response) => {
        const responseId = String(response.id);
        const fusion = (response.deliveryJSON as StoredFusionRecord | null) ?? null;
        const job = jobByResponse.get(responseId);
        const rows = metricsByResponse.get(responseId) ?? [];

        if (rows.length > 0) perResponseMetrics.push(rows);
        if (response.deliveryAnalyzedAt) analyzedCount += 1;

        for (const caveat of fusion?.caveats ?? []) caveats.add(caveat);
        for (const issue of fusion?.captureIssues ?? []) captureIssues.add(issue);

        return {
            responseId,
            questionText: questionById.get(String(response.questionId)) ?? null,
            answerPreview: String(response.answerText ?? '').slice(0, 240),
            metrics: rows,
            fusion,
            jobStatus: (job?.status as JobStatus) ?? 'none',
            jobError: (job?.lastError as string) ?? null,
        };
    });

    return {
        sessionId,
        responses: views,
        aggregate: aggregateDeliveryMetrics(perResponseMetrics),
        analyzedCount,
        responseCount: views.length,
        caveats: [...caveats],
        captureIssues: [...captureIssues],
    };
}

export interface DeliveryProfile {
    userId: string;
    aggregate: MetricAggregate[];
    /** One point per analysed session, oldest first, for a trend line. */
    trend: Array<{ sessionId: string; at: string; metrics: MetricAggregate[] }>;
    analyzedCount: number;
}

/**
 * The session ids a study owner may see this candidate's delivery for.
 *
 * Returns null for "no restriction" (the candidate themselves, an admin). Returns an
 * empty array — which is a different thing — when the owner has no studies holding
 * this candidate, and the caller turns that into a refusal rather than an empty
 * profile, so a probe cannot tell a real candidate from an invented one.
 *
 * The restriction exists because a delivery profile spans every answer a person has
 * ever given here. An interviewer is entitled to the evidence behind a decision they
 * are making, and is not entitled to what that person said in someone else's study.
 * Rolling up across all of them would hand it over quietly, which is exactly the kind
 * of leak that looks like a feature.
 */
export async function sessionsVisibleToStudyOwner(
    candidateId: string,
    ownerId: string
): Promise<string[] | null> {
    const studies = await supabaseDb.study.findMany({ where: { userId: ownerId } });
    const studyIds = (studies as Record<string, any>[])
        .map((study) => String(study.id))
        .filter(Boolean);
    if (studyIds.length === 0) return [];

    const sessions = await supabaseDb.interviewSession.findMany({
        where: { studyId: { in: studyIds }, userId: candidateId },
    });
    return (sessions as Record<string, any>[]).map((session) => String(session.id)).filter(Boolean);
}

/**
 * A candidate's delivery profile across their analysed answers.
 *
 * Deliberately a roll-up of measurements and nothing else: no composite delivery
 * grade, because there is no honest way to collapse "spoke a little fast and
 * paused twice" into a single number about a person.
 *
 * `sessionIds` narrows the profile to a specific set of sessions. It is how a study
 * owner is shown a candidate's delivery without also being shown their answers from
 * another interviewer's study — see `sessionsVisibleToStudyOwner`.
 */
export async function userDeliveryProfile(
    userId: string,
    options: { sessionLimit?: number; sessionIds?: string[] } = {}
): Promise<DeliveryProfile> {
    const sessionLimit = options.sessionLimit ?? 10;

    // A caller scoped to no sessions at all gets an empty profile rather than the
    // unfiltered one. This returns before the query so that "may see nothing" cannot
    // accidentally be implemented as "applied no filter" — the failure mode of a
    // permission check that leaks is always the same shape, and it is worth making
    // unreachable rather than merely unlikely. `in: []` is also exactly the filter a
    // query builder is entitled to treat as "no filter", so it is never built.
    const allowed = options.sessionIds ? new Set(options.sessionIds) : null;
    if (allowed && allowed.size === 0) {
        return { userId, aggregate: aggregateDeliveryMetrics([]), trend: [], analyzedCount: 0 };
    }

    const metrics = await supabaseDb.deliveryMetric.findMany({
        where: { userId, measured: true },
        orderBy: { createdAt: 'asc' },
    });

    const bySession = new Map<string, DeliveryMetricResult[]>();
    for (const row of metrics as Record<string, any>[]) {
        const key = String(row.sessionId);
        // Filtered here rather than in the query because the wrapper cannot express
        // "not in", and because the scoping rule is easier to read as one membership
        // test than as a set of nested conditions.
        if (allowed && !allowed.has(key)) continue;
        const list = bySession.get(key) ?? [];
        list.push(toMetricResult(row));
        bySession.set(key, list);
    }

    const sessions = [...bySession.keys()].slice(-sessionLimit);

    return {
        userId,
        aggregate: aggregateDeliveryMetrics([...bySession.values()]),
        trend: sessions.map((sessionId) => ({
            sessionId,
            at: String(
                (metrics as Record<string, any>[]).find((row) => String(row.sessionId) === sessionId)
                    ?.createdAt ?? ''
            ),
            metrics: aggregateDeliveryMetrics([bySession.get(sessionId) ?? []]),
        })),
        analyzedCount: bySession.size,
    };
}
