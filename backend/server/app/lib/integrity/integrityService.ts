// ============================================
// integrityService.ts — persistence, orchestration and scoped reads
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// The DB half. Everything that decides *what* a signal means lives in contract.ts
// and the math modules; this file records events, runs the three layers, fuses them,
// and reads the result back under a scope.
//
// THE LLM JUDGE IS NOT HERE, ON PURPOSE
//
// The roadmap asks for a per-answer LLM verdict. It is deferred, and the reason is
// the same one `lib/delivery/fusion.ts` gives for keeping fusion arithmetic: a score
// that depends on a sampling temperature cannot be reproduced, and a candidate who
// asks "why did I get this number?" is entitled to an answer that does not begin
// "we asked a model". When it lands it will run through the platform AI config, use
// the `AnalysisJob` row this file already creates with `kind: 'integrity'`, and
// contribute a bounded, disclosed amount. Until then the score is exactly the
// arithmetic in fusion.ts and nothing else.
//
// THE REVIEW LOG HAS NO WRITE-BACK PATH
//
// `IntegrityReviewLog` is append-only. This module exports functions that append to
// it and reads that return it, and deliberately exports no update and no delete for
// it — not because a caller is trusted to behave, but because a reviewer's decision
// record that can be edited is not a record. The same rule Feature 4 applies to its
// decision log.

import supabaseDb from '../supabaseDb';
import {
    REGISTRY_VERSION,
    evaluateSignal,
    signalDefinition,
    type SignalEvaluation,
} from './contract';
import {
    CLIENT_REPORTED_CAVEAT,
    SIGNAL_FOR_EVENT_TYPE,
    foldProctoringEvents,
    evaluateProctoring,
    isKnownEventType,
    minimizePayload,
    type RawIntegrityEvent,
} from './proctoringMath';
import {
    MIN_WORDS_FOR_STYLOMETRY,
    PERPLEXITY_UNMEASURED_REASON,
    computeAuthenticity,
    countWords,
} from './stylometryMath';
import {
    clusterMemberCount,
    findSimilarAnswers,
    strongestSimilarity,
    type ComparableAnswer,
    type SimilarityResult,
} from './similarityMath';
import {
    fuseIntegrity,
    flagFromStored,
    type IntegrityFlag,
    type IntegrityResult,
    type LayerInput,
} from './fusion';

/** The `AnalysisJob.kind` this feature claims. One job table, two features. */
export const JOB_KIND = 'integrity';

/** Attempts after which an integrity job stays failed for a human to look at. */
export const MAX_ATTEMPTS = 3;

/**
 * Similarity below this is not reported at all.
 *
 * Matches the registry's firing threshold for `nearDuplicateAnswer`, and is applied
 * here rather than at the score so that a stored `AnswerSimilarity` row means the
 * same thing everywhere it is read.
 */
export const SIMILARITY_THRESHOLD = 0.75;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

// --------------------------------------------
// Recording events
// --------------------------------------------

export interface RecordEventsParams {
    sessionId: string;
    userId?: string | null;
    events: RawIntegrityEvent[];
}

export interface RecordEventsResult {
    accepted: number;
    /** Events dropped because their type is unknown to this build. */
    rejected: number;
}

/**
 * Stores browser proctoring events.
 *
 * Every payload passes through `minimizePayload` on the way in, so what is stored is
 * the observation and never its content. The severity column is filled from the
 * registry rather than from the client, because a browser does not get to grade its
 * own evidence — a client that could label its own paste events 'info' would be able
 * to talk its way out of the only high-severity signal in layer one.
 *
 * Unknown event types are rejected and counted rather than stored. Storing them would
 * mean a future client could widen what this table holds simply by sending a new
 * `type`, which is the same failure the payload allow-list exists to prevent.
 */
export async function recordEvents(params: RecordEventsParams): Promise<RecordEventsResult> {
    const rows: Array<Record<string, unknown>> = [];
    let rejected = 0;

    for (const event of params.events) {
        const type = String(event.type ?? '');
        const minimized = minimizePayload(type, event.payload);
        // A type this build has no signal for is a type it does not know, and storing
        // it would let a future client widen this table by inventing one.
        if (!isKnownEventType(type)) {
            rejected += 1;
            continue;
        }

        rows.push({
            sessionId: params.sessionId,
            responseId: (event as { responseId?: string | null }).responseId ?? null,
            userId: params.userId ?? null,
            type,
            severity: signalDefinition(SIGNAL_FOR_EVENT_TYPE[type])?.severity ?? 'info',
            payloadJSON: Object.keys(minimized).length > 0 ? minimized : null,
            occurredAt: toIso(event.occurredAt),
        });
    }

    if (rows.length === 0) return { accepted: 0, rejected };

    await supabaseDb.integrityEvent.createMany({ data: rows });
    return { accepted: rows.length, rejected };
}

function toIso(value: string | Date | null | undefined): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
}

// --------------------------------------------
// Analysis
// --------------------------------------------

export interface IntegrityAnalysisOutcome {
    sessionId: string;
    jobId: string | null;
    status: JobStatus;
    report: StoredIntegrityReport | null;
    skippedReason: string | null;
    error: string | null;
}

/**
 * The persisted report.
 *
 * Snapshotted, not recomputed. The events and text behind it are not retained
 * indefinitely, and a finding that can be silently re-derived from changed constants
 * is not an audit trail — a candidate could be shown a flag produced by thresholds
 * that did not exist when their interview happened. `registryVersion` is stored for
 * the same reason.
 */
export interface StoredIntegrityReport {
    version: number;
    assessed: boolean;
    score: number | null;
    status: IntegrityResult['status'];
    flags: IntegrityFlag[];
    checked: string[];
    layers: IntegrityResult['layers'];
    caveats: string[];
    totalDeduction: number;
    registryVersion: number;
    explanation: string;
    generatedAt: string;
}

/**
 * Runs all three layers for a session and stores the fused report.
 *
 * Idempotent: a session can be recomputed any number of times, and each run replaces
 * the previous report rather than accumulating them. That is safe here — unlike
 * delivery, nothing downstream has already consumed the number — and it is what makes
 * a threshold change re-runnable.
 */
export async function analyzeSessionIntegrity(
    sessionId: string,
    options: { jobId?: string | null } = {}
): Promise<IntegrityAnalysisOutcome> {
    const jobId = options.jobId ?? (await enqueueIntegrityJob(sessionId));

    if (jobId) {
        await supabaseDb.analysisJob.update({
            where: { id: jobId },
            data: {
                status: 'running',
                attempts: 1,
                claimedBy: `inline-${process.pid}`,
                claimedAt: new Date().toISOString(),
                startedAt: new Date().toISOString(),
                lastError: null,
            },
        });
    }

    try {
        const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
        if (!session) {
            throw new Error('The session this analysis belongs to no longer exists.');
        }

        const userId = session.userId ? String(session.userId) : null;
        const studyId = session.studyId ? String(session.studyId) : null;

        const [events, responses, similarity] = await Promise.all([
            supabaseDb.integrityEvent.findMany({ where: { sessionId }, orderBy: { occurredAt: 'asc' } }),
            supabaseDb.response.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
            studyId
                ? supabaseDb.answerSimilarity.findMany({ where: { studyId } })
                : Promise.resolve([] as Record<string, any>[]),
        ]);

        const layers: LayerInput[] = [];

        const proctoring = buildProctoringLayer(events as Record<string, any>[]);
        if (proctoring) layers.push(proctoring);

        const authenticity = await buildAuthenticityLayer(
            sessionId,
            userId,
            responses as Record<string, any>[]
        );
        if (authenticity) layers.push(authenticity);

        const similarityLayer = buildSimilarityLayer(
            responses as Record<string, any>[],
            similarity as Record<string, any>[],
            studyId
        );
        if (similarityLayer) layers.push(similarityLayer);

        const result = fuseIntegrity(layers);
        const stored = toStoredReport(result);

        await persistReport(sessionId, userId, stored);

        if (jobId) {
            await supabaseDb.analysisJob.update({
                where: { id: jobId },
                data: {
                    status: 'succeeded',
                    finishedAt: new Date().toISOString(),
                    result: { assessed: stored.assessed, score: stored.score, status: stored.status },
                    lastError: null,
                },
            });
        }

        return { sessionId, jobId, status: 'succeeded', report: stored, skippedReason: null, error: null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[integrity] Analysis of session ${sessionId} failed:`, error);

        if (jobId) {
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
                console.error(`[integrity] Could not record the failure of job ${jobId}:`, updateError);
            }
        }

        return { sessionId, jobId, status: 'failed', report: null, skippedReason: null, error: message };
    }
}

/**
 * Creates a job row for a session, unless one is already queued or running.
 *
 * The row exists for the same reason Feature 2's does: inline processing cannot
 * answer "was this session assessed, and if not, why", and a failure should be a
 * visible retryable row rather than a line in a log. Unlike delivery there is no
 * payload to clear — the events are already in their own table.
 */
export async function enqueueIntegrityJob(sessionId: string): Promise<string | null> {
    try {
        const existing = await supabaseDb.analysisJob.findMany({
            where: { sessionId, kind: JOB_KIND, status: { in: ['queued', 'running'] } },
        });
        if ((existing as Record<string, any>[]).length > 0) {
            return String((existing as Record<string, any>[])[0].id);
        }

        const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
        const job = await supabaseDb.analysisJob.create({
            data: {
                sessionId,
                responseId: null,
                userId: session?.userId ? String(session.userId) : null,
                kind: JOB_KIND,
                status: 'queued',
                attempts: 0,
                maxAttempts: MAX_ATTEMPTS,
                payload: {},
            },
        });
        return String(job.id);
    } catch (error) {
        console.error('[integrity] Could not enqueue an integrity job:', error);
        return null;
    }
}

// --------------------------------------------
// Layer 1 — proctoring
// --------------------------------------------

/**
 * Folds the session's events into a layer input.
 *
 * `hasEvidence` is `totalEvents > 0`, and that single boolean is what stops a session
 * whose browser sent nothing from being scored 100. A silent client produces eight
 * proctoring values of zero, and every one of them is an absence of data rather than
 * a measurement — treating them as measurements would mean the score rewards whoever
 * suppresses reporting.
 */
function buildProctoringLayer(events: Record<string, any>[]): LayerInput | null {
    const raw: RawIntegrityEvent[] = events.map((event) => ({
        type: String(event.type ?? ''),
        occurredAt: event.occurredAt ?? null,
        payload: (event.payloadJSON as Record<string, unknown> | null) ?? null,
    }));

    const evidence = foldProctoringEvents(raw);
    const evaluations = evaluateProctoring(evidence, (key, value) => {
        const definition = signalDefinition(key);
        return definition ? evaluateSignal(definition, value) : null;
    });

    return {
        layer: 'proctoring',
        evaluations,
        hasEvidence: evidence.totalEvents > 0,
        caveats: [CLIENT_REPORTED_CAVEAT, ...evidence.caveats.filter((note) => note !== CLIENT_REPORTED_CAVEAT)],
    };
}

// --------------------------------------------
// Layer 2 — authenticity
// --------------------------------------------

/**
 * Scores every answer's writing and folds the session into one layer input.
 *
 * Two aggregations happen here and both need their choice stated.
 *
 * First, each answer is measured against *its own session's* earlier answers. Drift
 * is a comparison with the same person, so the baseline is that candidate's prior
 * answers in this session — never another candidate's, and never a global corpus.
 *
 * Second, an answer-level signal becomes a session-level one by taking the WORST
 * answer. A session where one answer reads like a different author is worth a
 * reviewer's attention even when the other nine read normally, so averaging would
 * dilute exactly the finding this layer exists to surface. The per-answer rows are
 * stored regardless, because the reviewer needs to know which answer it was.
 */
async function buildAuthenticityLayer(
    sessionId: string,
    userId: string | null,
    responses: Record<string, any>[]
): Promise<LayerInput | null> {
    if (responses.length === 0) return null;

    const perResponse = new Map<string, SignalEvaluation[]>();
    const priorTexts: string[] = [];
    let measuredAnswers = 0;
    let shortest = Number.POSITIVE_INFINITY;

    for (const response of responses) {
        const responseId = String(response.id);
        const text = String(response.answerText ?? '');
        shortest = Math.min(shortest, countWords(text));

        const evidence = computeAuthenticity(text, priorTexts);
        // This answer joins the baseline for every answer after it — and never for
        // itself, which is the whole point of a baseline.
        if (countWords(text) >= MIN_WORDS_FOR_STYLOMETRY) priorTexts.push(text);

        const evaluations: SignalEvaluation[] = [];
        for (const [key, value] of Object.entries(evidence.values)) {
            const definition = signalDefinition(key);
            if (!definition || value === null) continue;
            evaluations.push(evaluateSignal(definition, value));
        }
        perResponse.set(responseId, evaluations);
        if (evidence.measured) measuredAnswers += 1;

        await persistAuthenticity(responseId, sessionId, userId, evidence);
    }

    const evaluations = worstPerSignal([...perResponse.values()]);

    const caveats = [PERPLEXITY_UNMEASURED_REASON];
    if (measuredAnswers === 0) {
        caveats.push(
            `None of the ${responses.length} answer${responses.length === 1 ? '' : 's'} in this session ${responses.length === 1 ? 'was' : 'were'} long enough for the writing-style measures, which need about ${MIN_WORDS_FOR_STYLOMETRY} words. Nothing was measured from the text.`
        );
    }
    if (Number.isFinite(shortest) && shortest < MIN_WORDS_FOR_STYLOMETRY && measuredAnswers > 0) {
        caveats.push(
            'Some answers were too short for the writing-style measures and were left out of this layer. The figures shown come from the answers that were long enough.'
        );
    }

    return {
        layer: 'authenticity',
        evaluations,
        hasEvidence: measuredAnswers > 0,
        caveats,
    };
}

/**
 * Keeps the most extreme evaluation of each signal across answers.
 *
 * "Most extreme" is judged by `position`, the signal's own 0–1 severity, rather than
 * by raw value — a paste count and a similarity ratio do not share a scale, and
 * comparing them directly would pick the wrong answer for at least one signal.
 */
function worstPerSignal(groups: ReadonlyArray<readonly SignalEvaluation[]>): SignalEvaluation[] {
    const worst = new Map<string, SignalEvaluation>();
    for (const group of groups) {
        for (const evaluation of group) {
            const current = worst.get(evaluation.key);
            if (!current || evaluation.position > current.position) worst.set(evaluation.key, evaluation);
        }
    }
    return [...worst.values()];
}

/**
 * Stores one answer's stylometry.
 *
 * Delete-then-insert, like Feature 2's metric rows: a recomputation must replace the
 * previous figures rather than accumulate a second set, and `responseId` is unique in
 * the table as the backstop if two runs interleave.
 */
async function persistAuthenticity(
    responseId: string,
    sessionId: string,
    userId: string | null,
    evidence: ReturnType<typeof computeAuthenticity>
): Promise<void> {
    const values = evidence.values;
    const row = {
        responseId,
        sessionId,
        userId,
        wordCount: evidence.wordCount,
        sentenceCount: evidence.sentenceCount,
        burstiness: numericOrNull(values.lowBurstiness),
        lexicalDiversity: numericOrNull(values.lowLexicalDiversity),
        repetitionIndex: numericOrNull(values.highRepetition),
        driftVsBaseline: numericOrNull(values.stylometricDrift),
        baselineAnswers: evidence.baselineAnswers,
        measured: evidence.measured,
        explanation: evidence.explanation,
    };

    await supabaseDb.authenticityScore.deleteMany({ where: { responseId } });
    await supabaseDb.authenticityScore.create({ data: row });
}

function numericOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// --------------------------------------------
// Layer 3 — similarity
// --------------------------------------------

/**
 * Turns this study's stored similarity pairs into a layer input for one session.
 *
 * The pair rows are read rather than recomputed because the batch is expensive and
 * belongs to the study, not to any one session — `runStudySimilarity` produces them
 * and this consumes them.
 *
 * `hasEvidence` is true only when the study has actually been compared. A session in
 * a study where no comparison has run gets a similarity layer with no values at all,
 * rather than two zeros that would read as "we looked and found nothing".
 */
function buildSimilarityLayer(
    responses: Record<string, any>[],
    pairs: Record<string, any>[],
    studyId: string | null
): LayerInput | null {
    if (!studyId || responses.length === 0) return null;

    const comparable = pairs
        .filter((pair) => Number(pair.similarity ?? 0) >= SIMILARITY_THRESHOLD)
        .map((pair) => ({
            responseAId: String(pair.responseAId),
            responseBId: String(pair.responseBId),
            similarity: Number(pair.similarity ?? 0),
            clusterId: pair.clusterId ? String(pair.clusterId) : null,
        }));

    if (comparable.length === 0) {
        // The study was compared and this session's answers resemble nothing. That is
        // a real measurement of zero, so it is reported as one — but only if a
        // comparison actually happened, which the caller signals by having stored at
        // least one row for the study. With no rows at all, nothing was measured.
        const compared = pairs.length > 0;
        if (!compared) return null;
        return {
            layer: 'similarity',
            evaluations: twoSimilarityEvaluations(0, 0),
            hasEvidence: true,
            caveats: [
                'These answers were compared with every other answer in the same study and resembled none of them above the reporting threshold.',
            ],
        };
    }

    let strongest = 0;
    let largestCluster = 0;
    for (const response of responses) {
        const responseId = String(response.id);
        strongest = Math.max(strongest, strongestSimilarity(responseId, comparable));
        largestCluster = Math.max(largestCluster, clusterMemberCount(responseId, comparable));
    }

    return {
        layer: 'similarity',
        evaluations: twoSimilarityEvaluations(strongest, largestCluster),
        hasEvidence: true,
        caveats: [
            'Similarity is computed within this study only, because candidates in different studies were asked different questions. A match here means two answers travelled together; it does not say in which direction.',
        ],
    };
}

function twoSimilarityEvaluations(strongest: number, clusterMembers: number): SignalEvaluation[] {
    const evaluations: SignalEvaluation[] = [];
    for (const [key, value] of [
        ['nearDuplicateAnswer', strongest],
        ['similarityClusterMember', clusterMembers],
    ] as const) {
        const definition = signalDefinition(key);
        if (definition) evaluations.push(evaluateSignal(definition, value));
    }
    return evaluations;
}

// --------------------------------------------
// Study similarity batch
// --------------------------------------------

export interface StudySimilarityOutcome extends SimilarityResult {
    studyId: string;
    /** Pairs written to `AnswerSimilarity`. */
    stored: number;
}

/**
 * Compares every answer in a study and replaces its stored pairs.
 *
 * Grouped by question before comparison, so an answer about databases is never
 * compared with one about teamwork. Within a question the whole candidate pool is
 * compared — that is the population that was asked the same thing, and the only one
 * against which similarity means anything.
 *
 * Answers shorter than the shingle floor are excluded by `findSimilarAnswers` and
 * reported in its caveats rather than silently dropped.
 */
export async function runStudySimilarity(studyId: string): Promise<StudySimilarityOutcome> {
    const sessions = await supabaseDb.interviewSession.findMany({ where: { studyId } });
    const sessionIds = (sessions as Record<string, any>[]).map((session) => String(session.id));

    if (sessionIds.length === 0) {
        return {
            studyId,
            pairs: [],
            considered: 0,
            skippedTooShort: 0,
            approximate: true,
            caveats: ['This study has no interview sessions yet, so there was nothing to compare.'],
            stored: 0,
        };
    }

    const responses = await supabaseDb.response.findMany({ where: { sessionId: { in: sessionIds } } });

    const byQuestion = new Map<string, ComparableAnswer[]>();
    for (const response of responses as Record<string, any>[]) {
        const questionId = response.questionId ? String(response.questionId) : '__unassigned__';
        const bucket = byQuestion.get(questionId) ?? [];
        bucket.push({
            responseId: String(response.id),
            text: String(response.answerText ?? ''),
            questionId,
        });
        byQuestion.set(questionId, bucket);
    }

    const pairs: SimilarityResult['pairs'] = [];
    const caveats: string[] = [];
    let considered = 0;
    let skippedTooShort = 0;

    for (const bucket of byQuestion.values()) {
        if (bucket.length < 2) continue;
        const result = findSimilarAnswers(bucket, SIMILARITY_THRESHOLD);
        pairs.push(...result.pairs);
        considered += result.considered;
        skippedTooShort += result.skippedTooShort;
        for (const caveat of result.caveats) if (!caveats.includes(caveat)) caveats.push(caveat);
    }

    // Replace rather than append: a recomputation of the same study must not leave
    // the previous run's pairs behind to be counted twice.
    await supabaseDb.answerSimilarity.deleteMany({ where: { studyId } });

    if (pairs.length > 0) {
        await supabaseDb.answerSimilarity.createMany({
            data: pairs.map((pair) => ({
                studyId,
                responseAId: pair.responseAId,
                responseBId: pair.responseBId,
                similarity: pair.similarity,
                clusterId: pair.clusterId,
                shingleSize: 5,
            })),
        });
    }

    // A sentinel row is not written for "compared and found nothing", because the
    // table's shape does not allow one and inventing a fake pair to record an absence
    // would be exactly the kind of fabrication this feature forbids elsewhere. The
    // batch's completion is recorded on the job instead.
    return {
        studyId,
        pairs,
        considered,
        skippedTooShort,
        approximate: true,
        caveats,
        stored: pairs.length,
    };
}

// --------------------------------------------
// Persistence
// --------------------------------------------

function toStoredReport(result: IntegrityResult): StoredIntegrityReport {
    return {
        version: 1,
        assessed: result.assessed,
        score: result.score,
        status: result.status,
        flags: result.flags,
        checked: result.checked,
        layers: result.layers,
        caveats: result.caveats,
        totalDeduction: result.totalDeduction,
        registryVersion: result.registryVersion,
        explanation: result.explanation,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Writes the report, replacing any previous one for the session.
 *
 * The database enforces the invariant this function must respect — `assessed` true
 * exactly when `score` is non-null — so a bug here fails loudly at insert time
 * rather than storing a report whose score contradicts its own status.
 */
async function persistReport(
    sessionId: string,
    userId: string | null,
    report: StoredIntegrityReport
): Promise<void> {
    const data = {
        sessionId,
        userId,
        score: report.score,
        assessed: report.assessed,
        status: report.status,
        flagsJSON: report.flags,
        caveatsJSON: report.caveats,
        layersJSON: { layers: report.layers, checked: report.checked },
        registryVersion: report.registryVersion,
        generatedAt: report.generatedAt,
    };

    const existing = await supabaseDb.integrityReport.findUnique({ where: { sessionId } });
    if (existing) {
        await supabaseDb.integrityReport.update({ where: { id: String(existing.id) }, data });
        return;
    }
    await supabaseDb.integrityReport.create({ data });
}

// --------------------------------------------
// Reads
// --------------------------------------------

export interface SessionIntegrityView {
    sessionId: string;
    report: StoredIntegrityReport | null;
    flags: IntegrityFlag[];
    /** Per-answer stylometry, so a reviewer can see which answer moved the layer. */
    authenticity: Array<Record<string, any>>;
    eventCounts: Record<string, number>;
    totalEvents: number;
    /** Report ids the candidate may appeal against. Empty when there is no report. */
    reportId: string | null;
}

/**
 * Everything recorded about one session's integrity.
 *
 * Returns the stored report rather than recomputing, so what a reviewer sees is what
 * the score was actually built from. A session with no report is a real state — it
 * means analysis has not run — and is distinguishable here from a report that says
 * `assessed: false`, which means analysis ran and could not judge.
 */
export async function sessionIntegrity(sessionId: string): Promise<SessionIntegrityView> {
    const [reportRow, authenticityRows, eventRows] = await Promise.all([
        supabaseDb.integrityReport.findUnique({ where: { sessionId } }),
        supabaseDb.authenticityScore.findMany({ where: { sessionId } }),
        supabaseDb.integrityEvent.findMany({ where: { sessionId } }),
    ]);

    const report = reportRow ? fromStoredReport(reportRow) : null;

    const eventCounts: Record<string, number> = {};
    for (const row of eventRows as Record<string, any>[]) {
        const type = String(row.type ?? 'unknown');
        eventCounts[type] = (eventCounts[type] ?? 0) + 1;
    }

    return {
        sessionId,
        report,
        flags: report?.flags ?? [],
        authenticity: authenticityRows as Record<string, any>[],
        eventCounts,
        totalEvents: (eventRows as Record<string, any>[]).length,
        reportId: reportRow ? String(reportRow.id) : null,
    };
}

/**
 * Rebuilds a stored report.
 *
 * A flag whose registry key no longer exists is still returned, with the copy that
 * was stored beside it. That is deliberate: thresholds and signal names will change,
 * and a past finding must stay readable exactly as it was recorded rather than
 * becoming blank or, worse, being re-read under rules that did not apply.
 */
export function fromStoredReport(row: Record<string, any>): StoredIntegrityReport {
    const rawFlags = Array.isArray(row.flagsJSON) ? (row.flagsJSON as unknown[]) : [];
    const layers = (row.layersJSON as { layers?: unknown; checked?: unknown } | null) ?? {};

    return {
        version: 1,
        assessed: Boolean(row.assessed),
        score: typeof row.score === 'number' ? row.score : null,
        status: (row.status ?? 'pending') as IntegrityResult['status'],
        flags: rawFlags.map(flagFromStored).filter((flag): flag is IntegrityFlag => flag !== null),
        checked: Array.isArray(layers.checked) ? (layers.checked as string[]) : [],
        layers: Array.isArray(layers.layers) ? (layers.layers as IntegrityResult['layers']) : [],
        caveats: Array.isArray(row.caveatsJSON) ? (row.caveatsJSON as string[]) : [],
        totalDeduction: typeof row.score === 'number' ? Math.round((100 - row.score) * 10) / 10 : 0,
        registryVersion: Number(row.registryVersion ?? REGISTRY_VERSION),
        explanation: String(row.explanation ?? ''),
        generatedAt: String(row.generatedAt ?? ''),
    };
}

/**
 * The report as the candidate sees it.
 *
 * The candidate gets every flag that concerns them, each with the explanation it
 * cannot rule out and the points it removed — the transparency rule says a person is
 * entitled to see how a score about them was reached. What is withheld is the other
 * candidates: similarity flags keep their own similarity figure, which is about this
 * person's answer, but nothing identifying the answer they matched is included,
 * because that would hand one candidate another's work.
 */
export function redactForCandidate(report: StoredIntegrityReport): StoredIntegrityReport {
    return {
        ...report,
        flags: report.flags.map((flag) =>
            flag.layer === 'similarity'
                ? {
                      ...flag,
                      explanation: `${flag.explanation} The other answer this matched is not shown, because it belongs to another candidate.`,
                  }
                : flag
        ),
    };
}

// --------------------------------------------
// Appeals
// --------------------------------------------

export interface SubmitAppealParams {
    sessionId: string;
    reportId: string;
    userId?: string | null;
    flagKey: string;
    statement: string;
}

/**
 * Records a candidate's contest of one finding.
 *
 * Validates that the flag actually fired in the report before accepting the appeal.
 * An appeal against a finding that does not exist cannot be resolved by any reviewer,
 * and accepting one would put a row in the queue that no one can act on — so it is
 * refused with a reason rather than stored hopefully.
 *
 * The statement is required and is not trimmed to a summary. The whole point of an
 * appeal is that the person gets to say something the platform did not think to ask.
 */
export async function submitAppeal(params: SubmitAppealParams): Promise<{ id: string }> {
    const statement = params.statement?.trim() ?? '';
    if (statement.length === 0) {
        throw new Error('An appeal must include a statement.');
    }

    const reportRow = await supabaseDb.integrityReport.findUnique({ where: { id: params.reportId } });
    if (!reportRow) throw new Error('That report does not exist.');
    if (String(reportRow.sessionId) !== params.sessionId) {
        throw new Error('That report belongs to a different session.');
    }

    const report = fromStoredReport(reportRow);
    if (!report.flags.some((flag) => flag.key === params.flagKey)) {
        throw new Error('That finding is not part of this report, so there is nothing to appeal.');
    }

    const appeal = await supabaseDb.integrityAppeal.create({
        data: {
            sessionId: params.sessionId,
            reportId: params.reportId,
            userId: params.userId ?? null,
            flagKey: params.flagKey,
            statement: statement.slice(0, 4000),
            status: 'submitted',
        },
    });

    return { id: String(appeal.id) };
}

export async function listAppeals(filter: {
    reportId?: string;
    sessionId?: string;
    userId?: string;
    status?: string;
}): Promise<Array<Record<string, any>>> {
    const where: Record<string, unknown> = {};
    if (filter.reportId) where.reportId = filter.reportId;
    if (filter.sessionId) where.sessionId = filter.sessionId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.status) where.status = filter.status;

    return supabaseDb.integrityAppeal.findMany({ where, orderBy: { submittedAt: 'asc' } });
}

export type AppealDecision = 'upheld' | 'dismissed';

export interface ReviewAppealParams {
    appealId: string;
    /**
     * Null for a legacy admin-password session, which carries no user id. Recorded as
     * null rather than invented: an incomplete audit record is honest, a fabricated
     * one is not.
     */
    reviewerId: string | null;
    decision: AppealDecision;
    note?: string;
}

/**
 * Records a reviewer's decision on one appeal.
 *
 * 'upheld' means the candidate's objection was accepted, which is a statement about
 * the FINDING, not about the candidate's honesty — `decisionNote` is where a reviewer
 * says which. Both the appeal row and the append-only log are written; the row holds
 * the current state, the log holds that a decision was made at all.
 */
export async function reviewAppeal(params: ReviewAppealParams): Promise<Record<string, any>> {
    const appeal = await supabaseDb.integrityAppeal.findUnique({ where: { id: params.appealId } });
    if (!appeal) throw new Error('That appeal does not exist.');

    const updated = await supabaseDb.integrityAppeal.update({
        where: { id: params.appealId },
        data: {
            status: params.decision,
            decidedBy: params.reviewerId,
            decidedAt: new Date().toISOString(),
            decisionNote: params.note?.slice(0, 4000) ?? null,
        },
    });

    await appendReviewLog({
        reportId: String(appeal.reportId),
        appealId: params.appealId,
        reviewerId: params.reviewerId,
        action: `appeal_${params.decision}`,
        note: params.note ?? null,
    });

    return updated;
}
export interface ReviewReportParams {
    reportId: string;
    reviewerId: string | null;
    note?: string;
}

/** Records that a human has read a report. The decision itself lives elsewhere. */
export async function reviewReport(params: ReviewReportParams): Promise<void> {
    await supabaseDb.integrityReport.update({
        where: { id: params.reportId },
        data: {
            reviewedBy: params.reviewerId,
            reviewedAt: new Date().toISOString(),
            reviewerNote: params.note?.slice(0, 4000) ?? null,
        },
    });

    await appendReviewLog({
        reportId: params.reportId,
        appealId: null,
        reviewerId: params.reviewerId,
        action: 'report_reviewed',
        note: params.note ?? null,
    });
}

/**
 * Appends to the review log.
 *
 * Not exported, and no update or delete for this table is exported anywhere in this
 * module. A reviewer history that can be rewritten is not a history, and the way to
 * guarantee nobody rewrites it is to give nobody a function that can.
 */
async function appendReviewLog(entry: {
    reportId: string;
    appealId: string | null;
    reviewerId: string;
    action: string;
    note: string | null;
}): Promise<void> {
    await supabaseDb.integrityReviewLog.create({ data: entry });
}

/** The reviewer history for a report, oldest first. Read-only by construction. */
export async function reviewHistory(reportId: string): Promise<Array<Record<string, any>>> {
    return supabaseDb.integrityReviewLog.findMany({
        where: { reportId },
        orderBy: { at: 'asc' },
    });
}

// --------------------------------------------
// Session ownership, for route guards
// --------------------------------------------

/**
 * The owner of a session, or null when the session does not exist.
 *
 * Kept here rather than in each route so the ownership rule has one implementation.
 * Returning null for a missing session and null for one with no owner are the same
 * answer to a guard — refuse — which is the safe direction for the ambiguity.
 */
export async function sessionOwner(sessionId: string): Promise<string | null> {
    const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
    return session?.userId ? String(session.userId) : null;
}

/**
 * The study a session belongs to, and its owner.
 *
 * Used by the routes that need to answer "is this person entitled to see this
 * session's integrity report" without a second query for the study.
 */
export async function sessionStudyOwner(
    sessionId: string
): Promise<{ studyId: string | null; ownerId: string | null }> {
    const session = await supabaseDb.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) return { studyId: null, ownerId: null };

    const studyId = session.studyId ? String(session.studyId) : null;
    if (!studyId) return { studyId: null, ownerId: session.userId ? String(session.userId) : null };

    const study = await supabaseDb.study.findUnique({ where: { id: studyId } });
    return { studyId, ownerId: study?.userId ? String(study.userId) : null };
}
