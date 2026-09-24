// ============================================
// indexService.ts — the sweeps, and the job row that remembers them
// ============================================
// The layer that ties the others together. `embeddingService` writes vectors, `themeService`
// clusters, `trendService` counts and `benchmarkService` publishes — all of them idempotent, and
// none of them aware of the others. This file is what runs them over the corpus in a defined
// order, and what records that a run happened.
//
// WHY A JOB ROW AT ALL
//
// There is no scheduler in this codebase, so "computed on a schedule" means "computed when
// somebody asks" — an admin pressing a button, or a deployment calling the sweeps from a cron
// entry it owns. The job row is what makes that resumable rather than restart-from-zero: a
// backfill that runs out of budget in one pass leaves a cursor, and the next pass continues from
// it instead of re-walking the corpus. It is also what makes a failed sweep visible: `failed`
// with an `error` is a different row state from `succeeded` with `failed: 0`, and an operator
// needs to be able to tell them apart without reading logs.
//
// The shape mirrors `AnalysisJob` rather than inventing a second job idiom — queued → running →
// succeeded/failed, with attempts and an error. `IndexJob` adds the counts and the cursor.
//
// THERE IS NO LEASE, AND THAT IS STATED RATHER THAN IMPLIED
//
// A run that is killed — a deploy, a crash, an operator's Ctrl-C — leaves its row `running`
// forever, because nothing holds a lease on it and nothing will time it out. `resetJob` exists
// for exactly that: it returns a stuck row to `queued` and keeps its `error`, so the next run
// can claim it. Pretending the status is self-healing would be worse than a manual step an
// operator can see.
//
// THE COUNTS ARE PERSISTED AND THE DETAIL IS NOT
//
// `IndexJob` has no result column, so the per-kind outcome — which sources failed, which labels
// stayed unclustered, which competencies were suppressed — is returned to the caller and not
// stored. That is a real limit worth naming: a later reader of the job row sees `processed` and
// `failed` and cannot see the reasons. The reasons are not lost, though — they are in the tables
// the sweep wrote, which is where a reader looking into a specific source or competency would
// go anyway. If a future surface needs the narrative, it needs a column, not a bigger `error`.
//
// ORDER MATTERS, AND ONLY ONE ORDER IS CORRECT
//
// Backfill before themes: a theme label is embedded by `themeService` on its own, but the
// transcripts a theme was drawn from are the backfill's work, and clustering reads labels whose
// occurrences exist. Themes before trends: a trend counts occurrences grouped by cluster, so
// running it first counts an arrangement that is about to change. Trends before benchmarks is
// not a dependency — a benchmark reads ability history, not the theme corpus — but all four are
// exposed as separate kinds so an operator can run the one they need rather than the whole
// chain, and the notes on each say what it assumes has already run.

import supabaseDb from '../supabaseDb';
import { computed, refused } from '../measured';
import type { Measured } from '../measured';
import type { EmbeddingProvider } from '../providers/embeddings';
import { embedSource } from './embeddingService';
import { chunkText, chunkTranscript, isBlank } from './chunking';
import { clusterScope, indexThemes, synthesisText } from './themeService';
import { computeTrends, defaultTrendWindow, DEFAULT_TREND_MONTHS } from './trendService';
import { publishCompetencyBenchmarks } from './benchmarkService';
import { MIN_BENCHMARK_COHORT } from './contract';

export type IndexJobKind = 'backfill' | 'themes' | 'trends' | 'benchmarks';
export type IndexJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** How many sources one backfill run will walk. Bounds a single pass; the cursor resumes. */
export const MAX_BACKFILL_SOURCES_PER_RUN = 200;
/** How many jobs one `runPendingJobs` call will claim. */
export const MAX_JOBS_PER_CALL = 5;

export const INDEX_JOB_KINDS: IndexJobKind[] = ['backfill', 'themes', 'trends', 'benchmarks'];

// --------------------------------------------
// Shapes
// --------------------------------------------

export interface IndexJobView {
    id: string;
    kind: IndexJobKind;
    /** The study this job is bound to, or null for the whole corpus. */
    scopeKey: string | null;
    status: IndexJobStatus;
    attempts: number;
    error: string | null;
    cursor: string | null;
    total: number | null;
    processed: number;
    skipped: number;
    failed: number;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string | null;
    /** Seconds between start and finish, or null while it has not finished. */
    durationSeconds: number | null;
}

export interface JobRun {
    job: IndexJobView;
    kind: IndexJobKind;
    scopeKey: string | null;
    /** The handler's own outcome, in the handler's own shape. Not persisted — see the header. */
    detail: unknown;
    /** The rungs this run did not reach, or the assumptions it made. */
    notes: string[];
}

export interface RunParams {
    /**
     * Handed in rather than resolved here.
     *
     * `getEmbeddingProvider()` reads the environment and may return a provider that refuses
     * every call — a deployment on Claude with no embedding endpoint. A sweep is the one place
     * that has to survive that: it must record the refusal against the job rather than throw
     * during a request, and a caller that injects the provider can decide when that is.
     */
    provider: EmbeddingProvider;
    /** Ceiling on this run's work. Defaults per kind. */
    limit?: number;
    /** For a `trends` job: how far back the window reaches. */
    windowMonths?: number;
    /** For a `benchmarks` job: which roles. Omitted, every role the corpus contains. */
    roleKeys?: string[] | null;
}

// --------------------------------------------
// The job row
// --------------------------------------------

/**
 * Queue a sweep.
 *
 * A refused kind is refused here rather than accepted and failed later: an `IndexJob` row whose
 * kind the database's CHECK rejects would throw at insert, and one that got past it would sit
 * queued forever with no handler. Both are worse than a caller being told the kind is wrong.
 */
export async function enqueueJob(params: {
    kind: string;
    scopeKey?: string | null;
}): Promise<Measured<IndexJobView>> {
    const kind = String(params.kind ?? '').trim().toLowerCase();
    if (!INDEX_JOB_KINDS.includes(kind as IndexJobKind)) {
        return refused(`"${params.kind}" is not a sweep this system runs; the kinds are ${INDEX_JOB_KINDS.join(', ')}`);
    }

    const scopeKey = params.scopeKey ? String(params.scopeKey) : null;

    const row = await supabaseDb.indexJob.create({
        data: {
            kind,
            scopeKey,
            status: 'queued',
            attempts: 0,
            cursor: null,
            total: null,
            processed: 0,
            skipped: 0,
            failed: 0,
            createdAt: new Date().toISOString(),
        },
    });

    return computed(presentJob(row));
}

/**
 * Claim a job, or say why it cannot be claimed.
 *
 * The claim is a read followed by an update, which is not atomic. Two callers racing the same
 * `queued` row can both pass the read and both run the sweep. That is tolerable here and only
 * here: every sweep in this file is idempotent — a doubled backfill re-embeds nothing, a doubled
 * clustering assigns nothing that is already assigned — so the cost of the race is duplicated
 * work rather than a corrupted result. A job whose correctness depended on running once would
 * need a conditional update, and there is no such job in this feature.
 */
async function claimJob(jobId: string): Promise<Measured<Record<string, any>>> {
    const row = await supabaseDb.indexJob.findUnique({ where: { id: jobId } });
    if (!row) return refused(`no sweep job with id ${jobId} exists`);

    const status = String(row.status ?? '');
    if (status === 'running') {
        return refused(
            `sweep job ${jobId} is already running. A run that was killed leaves this status behind — nothing holds a lease on it — so reset it before claiming it again.`,
        );
    }
    if (status === 'succeeded') {
        return refused(`sweep job ${jobId} already succeeded, and re-running a finished sweep is a new job rather than a retry of this one`);
    }

    const updated = await supabaseDb.indexJob.update({
        where: { id: jobId },
        data: {
            status: 'running',
            attempts: Number(row.attempts ?? 0) + 1,
            error: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
        },
    });

    return computed(updated);
}

/** Return a stuck job to the queue, keeping its error so the reason is not lost. */
export async function resetJob(jobId: string): Promise<Measured<IndexJobView>> {
    const row = await supabaseDb.indexJob.findUnique({ where: { id: jobId } });
    if (!row) return refused(`no sweep job with id ${jobId} exists`);

    const updated = await supabaseDb.indexJob.update({
        where: { id: jobId },
        data: { status: 'queued', startedAt: null, finishedAt: null },
    });

    return computed(presentJob(updated));
}

/** The most recent jobs, newest first. */
export async function listJobs(limit = 20): Promise<IndexJobView[]> {
    const rows = (await supabaseDb.indexJob.findMany({})) as Array<Record<string, any>>;
    return rows
        .map(presentJob)
        .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
        .slice(0, Math.max(1, Math.min(limit, 100)));
}

/** The most recent job of one kind, or null if none has ever run. */
export async function latestJob(kind: IndexJobKind): Promise<IndexJobView | null> {
    const rows = (await supabaseDb.indexJob.findMany({ where: { kind } })) as Array<Record<string, any>>;
    if (rows.length === 0) return null;
    return rows.map(presentJob).sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))[0];
}

// --------------------------------------------
// Running
// --------------------------------------------

/**
 * Run one queued job to completion.
 *
 * The status transitions are written around the handler rather than inside it: a handler that
 * throws still leaves a `failed` row with the message, which is the only record that the sweep
 * was attempted. A handler that returns a refusal is treated the same way — a sweep that could
 * not run because the deployment has no embedding endpoint has failed, and its `error` says so.
 */
export async function runJob(jobId: string, params: RunParams): Promise<Measured<JobRun>> {
    const claimed = await claimJob(jobId);
    if (claimed.state !== 'computed') return claimed;

    const row = claimed.value;
    const kind = String(row.kind) as IndexJobKind;
    const scopeKey = row.scopeKey ? String(row.scopeKey) : null;

    const notes: string[] = [];
    let detail: unknown = null;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | null = row.cursor ? String(row.cursor) : null;
    let total: number | null = typeof row.total === 'number' ? row.total : null;

    try {
        const handled = await runHandler(kind, scopeKey, cursor, params, notes);
        if (handled.state !== 'computed') {
            await failJob(jobId, handled.reason, { processed, skipped, failed, cursor, total });
            return refused(handled.reason);
        }

        detail = handled.value.detail;
        processed = handled.value.processed;
        skipped = handled.value.skipped;
        failed = handled.value.failed;
        cursor = handled.value.cursor ?? cursor;
        total = handled.value.total ?? total;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failJob(jobId, message, { processed, skipped, failed, cursor, total });
        return refused(`the sweep failed: ${message}`);
    }

    const finished = new Date().toISOString();
    const updated = await supabaseDb.indexJob.update({
        where: { id: jobId },
        data: {
            status: 'succeeded',
            finishedAt: finished,
            cursor,
            total,
            processed,
            skipped,
            failed,
            error: null,
        },
    });

    if (kind === 'benchmarks' && params.roleKeys && params.roleKeys.length > 0) {
        notes.push(`Benchmarks were published for the ${params.roleKeys.length} roles the caller named.`);
    }

    return computed({ job: presentJob(updated), kind, scopeKey, detail, notes });
}

/** Claim and run the queued jobs, oldest first, up to a ceiling. */
export async function runPendingJobs(
    params: RunParams & { max?: number },
): Promise<Measured<{ runs: JobRun[]; skippedReasons: string[] }>> {
    const max = Math.max(1, Math.min(params.max ?? 1, MAX_JOBS_PER_CALL));

    const rows = (await supabaseDb.indexJob.findMany({ where: { status: 'queued' } })) as Array<Record<string, any>>;
    const queued = rows
        .map(presentJob)
        .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''))
        .slice(0, max);

    const runs: JobRun[] = [];
    const skippedReasons: string[] = [];

    for (const job of queued) {
        const run = await runJob(job.id, params);
        if (run.state === 'computed') runs.push(run.value);
        else skippedReasons.push(`${job.kind}: ${run.reason}`);
    }

    return computed({ runs, skippedReasons });
}

async function failJob(
    jobId: string,
    reason: string,
    counts: { processed: number; skipped: number; failed: number; cursor: string | null; total: number | null },
): Promise<void> {
    try {
        await supabaseDb.indexJob.update({
            where: { id: jobId },
            data: {
                status: 'failed',
                finishedAt: new Date().toISOString(),
                error: reason,
                // The counts reached before the failure are kept. A failed sweep that indexed 40
                // of 200 sources is a different situation from one that indexed none, and the
                // row is where an operator finds out which.
                cursor: counts.cursor,
                total: counts.total,
                processed: counts.processed,
                skipped: counts.skipped,
                failed: counts.failed,
            },
        });
    } catch (error) {
        // The job could not even be marked failed. Nothing better is available here: throwing
        // would replace the original failure with this one, and the original is the one the
        // caller needs to read.
        console.error('[research/indexService] could not record a failed sweep', error);
    }
}

// --------------------------------------------
// Handlers
// --------------------------------------------

interface HandlerOutcome {
    detail: unknown;
    processed: number;
    skipped: number;
    failed: number;
    cursor?: string | null;
    total?: number | null;
}

const BENCHMARK_ROLE_NOTE =
    'Roles were discovered from the interview sessions in the corpus. A role is a free-text column, so two spellings of the same job are two pools and each is published separately.';

/**
 * Dispatch one kind to its handler.
 *
 * Each handler is responsible for its own bounds and for reporting what it did not reach. A
 * handler returning a refusal fails the job, which is the correct outcome for every refusal in
 * this feature: they all mean the sweep could not do its work, and none of them mean "nothing to
 * do", which is a successful run with zeros in its counts.
 */
async function runHandler(
    kind: IndexJobKind,
    scopeKey: string | null,
    cursor: string | null,
    params: RunParams,
    notes: string[],
): Promise<Measured<HandlerOutcome>> {
    if (kind === 'backfill') return runBackfill(scopeKey, cursor, params, notes);
    if (kind === 'themes') return runThemes(scopeKey, params, notes);
    if (kind === 'trends') return runTrends(scopeKey, params, notes);
    return runBenchmarks(params, notes);
}

/**
 * Embed the corpus: transcripts and syntheses, and resumes when the sweep is not study-bound.
 *
 * A resume belongs to a candidate rather than to a study, so it is only swept by a global job —
 * filtering resumes by a study id would mean inventing an association the schema does not have,
 * and a study-scoped sweep that silently included every candidate's resume would put one study's
 * corpus in another's search results.
 *
 * `processed` counts sources that were fully embedded; `skipped` counts sources whose every
 * chunk was already up to date, which is the whole corpus on a second run. `failed` counts
 * sources where at least one chunk was refused — the sweep continues past them, because a
 * corpus of ten thousand with one unreadable transcript should index 9,999 and say so.
 */
async function runBackfill(
    scopeKey: string | null,
    cursor: string | null,
    params: RunParams,
    notes: string[],
): Promise<Measured<HandlerOutcome>> {
    const limit = Math.max(1, Math.min(params.limit ?? MAX_BACKFILL_SOURCES_PER_RUN, MAX_BACKFILL_SOURCES_PER_RUN));

    const sources = (await supabaseDb.storedInterview.findMany({
        where: scopeKey ? { studyId: scopeKey } : {},
    })) as Array<Record<string, any>>;

    const ordered = sources
        .map((row) => ({
            row,
            id: String(row.id),
            at: timeOf(row.completedAt) ?? timeOf(row.createdAt) ?? 0,
        }))
        .sort((left, right) => {
            if (left.at !== right.at) return left.at - right.at;
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });

    let start = 0;
    if (cursor) {
        const index = ordered.findIndex((entry) => entry.id === cursor);
        if (index === -1) {
            // The source the cursor named is gone. Starting over is the only safe move — the
            // alternative is skipping past sources that were never reached — and it costs a
            // re-walk that the content hashes make free.
            notes.push(
                `The sweep's stored cursor named source ${cursor}, which no longer exists, so this run started from the beginning of the corpus. Re-indexing unchanged sources costs no provider calls.`,
            );
        } else {
            start = index + 1;
        }
    }

    const batch = ordered.slice(start, start + limit);
    const remaining = Math.max(0, ordered.length - (start + batch.length));

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let lastId = cursor;
    const failures: Array<{ sourceId: string; reason: string }> = [];

    for (const entry of batch) {
        lastId = entry.id;
        let stored = 0;
        let unchanged = 0;
        let sourceFailed = false;

        const transcript = transcriptChunks(entry.row.transcriptJSON);
        if (transcript.state === 'refused') {
            // The column is `not null`, so an unreadable one is a stored value the reader does
            // not understand — a real failure to index that source, not an absent transcript.
            sourceFailed = true;
            recordFailure(failures, entry.id, transcript.reason);
        } else if (transcript.value.length > 0) {
            const result = await embedSource({
                ownerType: 'transcript',
                ownerId: entry.id,
                userId: entry.row.userId ? String(entry.row.userId) : null,
                studyId: entry.row.studyId ? String(entry.row.studyId) : null,
                text: '',
                chunks: transcript.value,
                provider: params.provider,
            });
            if (result.state === 'refused') {
                sourceFailed = true;
                recordFailure(failures, entry.id, result.reason);
            } else {
                stored += result.value.stored;
                unchanged += result.value.skipped;
                if (result.value.failed > 0) {
                    sourceFailed = true;
                    recordFailure(
                        failures,
                        entry.id,
                        `${result.value.failed} of its ${transcript.value.length} transcript passages were refused: ${result.value.failures[0]?.reason ?? 'no reason recorded'}`,
                    );
                }
            }
        }

        const rendered = synthesisText(entry.row.synthesisJSON);
        if (!isBlank(rendered)) {
            const result = await embedSource({
                ownerType: 'synthesis',
                ownerId: entry.id,
                userId: entry.row.userId ? String(entry.row.userId) : null,
                studyId: entry.row.studyId ? String(entry.row.studyId) : null,
                text: rendered,
                provider: params.provider,
            });
            if (result.state === 'refused') {
                sourceFailed = true;
                recordFailure(failures, entry.id, result.reason);
            } else {
                stored += result.value.stored;
                unchanged += result.value.skipped;
            }
        }

        if (sourceFailed) failed += 1;
        else if (stored === 0) skipped += 1;
        else processed += 1;
    }

    if (remaining > 0) {
        notes.push(
            `${remaining} ${remaining === 1 ? 'source was' : 'sources were'} not reached in this run, which is bounded to ${limit}. The cursor is stored, so the next run continues from it rather than starting over.`,
        );
    }

    if (scopeKey === null) {
        await sweepResumes(params, notes);
    } else {
        notes.push(
            'Resumes are owned by a candidate rather than a study, so a study-scoped sweep does not index them. Run a global backfill for the resume corpus.',
        );
    }

    notes.push(
        'Transcripts are chunked one passage per message, so a search returns the answer rather than the interview containing it. Syntheses are embedded as their rendered prose, not as the stored JSON.',
    );

    return computed({
        detail: { sources: ordered.length, reached: batch.length, remaining, failures },
        processed,
        skipped,
        failed,
        cursor: lastId,
        total: ordered.length,
    });
}

/** Embed every resume, which is a global sweep's work only. */
async function sweepResumes(params: RunParams, notes: string[]): Promise<void> {
    const resumes = (await supabaseDb.resume.findMany({})) as Array<Record<string, any>>;
    let stored = 0;
    let refused = 0;

    for (const row of resumes) {
        const text = typeof row.rawText === 'string' ? row.rawText : '';
        if (isBlank(text)) continue;

        const result = await embedSource({
            ownerType: 'resume',
            ownerId: String(row.id),
            userId: row.userId ? String(row.userId) : null,
            studyId: null,
            text,
            provider: params.provider,
        });
        if (result.state === 'refused') refused += 1;
        else stored += result.value.stored;
    }

    notes.push(
        refused > 0
            ? `${resumes.length} resumes were swept, ${resumes.length - refused} of them readable and ${stored} passages written.`
            : `${resumes.length} resumes were swept and ${stored} passages written.`,
    );
}

/**
 * Extract, then cluster.
 *
 * Both halves run in one job because a clustering over occurrences that this run just created is
 * the only arrangement that reflects the corpus as it is. They stay separate functions because
 * they are separately useful — the admin view reports extraction counts and cluster counts as
 * different facts — and because clustering is the expensive half and a deployment may want to
 * extract without re-clustering.
 *
 * This run does NOT bootstrap a scope that already has clusters, which is the invariant the whole
 * trend feature rests on. See `themeService`'s header.
 */
async function runThemes(
    scopeKey: string | null,
    params: RunParams,
    notes: string[],
): Promise<Measured<HandlerOutcome>> {
    const scope = scopeKey ? ('study' as const) : ('global' as const);
    const limit = Math.max(1, Math.min(params.limit ?? 2000, 2000));

    const extracted = await indexThemes({
        scope,
        scopeKey: scopeKey ?? 'global',
        studyId: scopeKey,
        limit,
    });
    if (extracted.state !== 'computed') return extracted;

    const clustered = await clusterScope({
        scope,
        scopeKey: scopeKey ?? 'global',
        provider: params.provider,
    });
    if (clustered.state !== 'computed') return clustered;

    const extraction = extracted.value;
    const clustering = clustered.value;

    if (extraction.existingScopeMismatch > 0) {
        notes.push(
            `${extraction.existingScopeMismatch} theme ${extraction.existingScopeMismatch === 1 ? 'occurrence' : 'occurrences'} this scope wanted are already stored under a different scope and were left where they are. An occurrence belongs to one clustering, and moving it would renumber the trends that point at it.`,
        );
    }
    if (clustering.clustersCreated > 0 && clustering.bootstrapped) {
        notes.push(
            `This scope had never been clustered, so ${clustering.clustersCreated} clusters were seeded with k-means. Every sweep after this one joins and creates incrementally, and never re-seeds.`,
        );
    }
    if (clustering.unembeddable > 0) {
        notes.push(
            `${clustering.unembeddable} ${clustering.unembeddable === 1 ? 'occurrence' : 'occurrences'} could not be clustered because ${clustering.unembeddable === 1 ? 'its label has' : 'their labels have'} no usable vector. They are counted in no cluster's frequency, and therefore in no trend.`,
        );
    }
    if (clustering.labelsWithoutVectors > 0) {
        notes.push(
            `${clustering.labelsWithoutVectors} distinct ${clustering.labelsWithoutVectors === 1 ? 'label' : 'labels'} in this scope have no stored vector at all.`,
        );
    }

    return computed({
        detail: { extraction, clustering },
        processed: extraction.sourcesScanned,
        skipped: extraction.occurrencesExisting,
        // Only genuinely unreadable sources are failures. A source with no themes is a source
        // with nothing to contribute, which is not a failure and is counted separately.
        failed: extraction.sourcesUnreadable,
    });
}

/**
 * Recompute the trend series over a window.
 *
 * The window defaults to `defaultTrendWindow()` — the last twelve months — and every period in it
 * is written, including the ones with no occurrences. Those are stored as 0 with their coverage,
 * not skipped: a period that a chart draws as a gap and a period that was counted as zero are
 * different facts, and only the writer can record which one it was.
 */
async function runTrends(
    scopeKey: string | null,
    params: RunParams,
    notes: string[],
): Promise<Measured<HandlerOutcome>> {
    const scope = scopeKey ? ('study' as const) : ('global' as const);
    const window = defaultTrendWindow(params.windowMonths ?? DEFAULT_TREND_MONTHS);

    const result = await computeTrends({
        scope,
        scopeKey: scopeKey ?? 'global',
        from: window.from.toISOString(),
        to: window.to.toISOString(),
    });
    if (result.state !== 'computed') return result;

    const outcome = result.value;

    if (outcome.uncoveredPeriods.length > 0) {
        notes.push(
            `${outcome.uncoveredPeriods.length} of the ${outcome.periods} periods in this window were never indexed and are stored with no value and a reason. They are not zeros — a zero would be a measurement that the scope recorded nothing.`,
        );
    }
    if (outcome.clustersSkipped > 0) {
        notes.push(
            `${outcome.clustersSkipped} ${outcome.clustersSkipped === 1 ? 'cluster has' : 'clusters have'} no occurrence in this window, so no series was written for ${outcome.clustersSkipped === 1 ? 'it' : 'them'}. A trend that starts at the edge of the window describes the window, not the theme.`,
        );
    }
    if (outcome.pointsUnchanged > 0) {
        notes.push(outcome.pointsUnchangedNote ?? `${outcome.pointsUnchanged} stored periods were already correct and left untouched.`);
    }

    return computed({
        detail: outcome,
        processed: outcome.pointsWritten,
        skipped: outcome.pointsUnchanged,
        failed: 0,
    });
}

/**
 * Publish each role's competency benchmarks.
 *
 * The roles come from the caller when it names them and from the corpus when it does not. Reading
 * the distinct values out of `InterviewSession."role"` is what makes an unnamed run useful: a
 * deployment does not have to know its own role vocabulary to publish the benchmarks for it.
 *
 * A suppressed pool is a successfully written row, not a failure. The whole point of storing the
 * suppression reason is that "too few candidates" is a normal outcome that a reader can find,
 * rather than an error someone has to interpret.
 */
async function runBenchmarks(params: RunParams, notes: string[]): Promise<Measured<HandlerOutcome>> {
    let roleKeys = params.roleKeys?.filter((key) => typeof key === 'string' && key.trim()) ?? null;

    if (!roleKeys || roleKeys.length === 0) {
        const sessions = (await supabaseDb.interviewSession.findMany({})) as Array<Record<string, any>>;
        const seen = new Set<string>();
        for (const session of sessions) {
            const role = typeof session.role === 'string' ? session.role.trim() : '';
            if (role) seen.add(role);
        }
        roleKeys = [...seen].sort();
        notes.push(BENCHMARK_ROLE_NOTE);
    }

    if (roleKeys.length === 0) {
        return refused('no interview carries a role, so there is no pool to publish a benchmark from');
    }

    const publications: Array<{ roleKey: string; publication: unknown }> = [];
    const refusedRoles: Array<{ roleKey: string; reason: string }> = [];

    let processed = 0;
    let skipped = 0;
    let suppressed = 0;

    for (const roleKey of roleKeys) {
        const result = await publishCompetencyBenchmarks({ roleKey });
        if (result.state !== 'computed') {
            // One role with no completed interviews is not a failed sweep — a deployment with a
            // stale role string in an old session should still publish every other role.
            refusedRoles.push({ roleKey, reason: result.reason });
            continue;
        }

        publications.push({ roleKey, publication: result.value });
        processed += result.value.published;
        skipped += result.value.unchanged;
        suppressed += result.value.suppressed;
    }

    notes.push(
        `A suppressed benchmark is a stored row with a null percentile and the count that caused it. The publication floor is ${MIN_BENCHMARK_COHORT} scored candidates, and a pool below it describes individuals rather than a group.`,
    );
    if (suppressed > 0) {
        notes.push(
            `${suppressed} published ${suppressed === 1 ? 'competency is' : 'competencies are'} suppressed across these roles.`,
        );
    }
    if (refusedRoles.length > 0) {
        notes.push(
            `${refusedRoles.length} ${refusedRoles.length === 1 ? 'role was' : 'roles were'} skipped: ${refusedRoles.map((entry) => `"${entry.roleKey}" (${entry.reason})`).join('; ')}`,
        );
    }

    return computed({
        detail: { publications, refusedRoles },
        processed,
        skipped,
        failed: 0,
    });
}

// --------------------------------------------
// Small readers
// --------------------------------------------

/**
 * The message list of a stored transcript, as embeddable passages.
 *
 * Refused rather than reported as empty when the column is not a message list. The column is
 * `not null`, so an unparseable value is a stored transcript this reader does not understand —
 * a source that failed to index, which the job must count, rather than a source with nothing in
 * it. An empty list is the second thing and is returned as a computed empty.
 */
function transcriptChunks(value: unknown): Measured<string[]> {
    if (value === null || value === undefined) return refused('the stored transcript is empty');

    let parsed: unknown = value;
    if (typeof value === 'string') {
        if (isBlank(value)) return refused('the stored transcript is empty');
        try {
            parsed = JSON.parse(value);
        } catch {
            return refused('the stored transcript could not be read as JSON, so its passages could not be identified');
        }
    }

    if (!Array.isArray(parsed)) {
        return refused('the stored transcript is not a list of messages, so its passages could not be identified');
    }

    return computed(chunkTranscript(parsed as Array<{ role?: unknown; content?: unknown }>).map((chunk) => chunk.text));
}

/** Keep the first few failures per run — enough to diagnose, not enough to fill a row. */
const MAX_RECORDED_FAILURES = 20;

function recordFailure(failures: Array<{ sourceId: string; reason: string }>, sourceId: string, reason: string): void {
    if (failures.length >= MAX_RECORDED_FAILURES) return;
    failures.push({ sourceId, reason });
}

function presentJob(row: Record<string, any>): IndexJobView {
    const startedAt = isoOrNull(row.startedAt);
    const finishedAt = isoOrNull(row.finishedAt);

    return {
        id: String(row.id),
        kind: String(row.kind) as IndexJobKind,
        scopeKey: row.scopeKey ? String(row.scopeKey) : null,
        status: String(row.status ?? 'queued') as IndexJobStatus,
        attempts: Number(row.attempts ?? 0),
        error: row.error ? String(row.error) : null,
        cursor: row.cursor ? String(row.cursor) : null,
        total: typeof row.total === 'number' ? row.total : null,
        processed: Number(row.processed ?? 0),
        skipped: Number(row.skipped ?? 0),
        failed: Number(row.failed ?? 0),
        startedAt,
        finishedAt,
        createdAt: isoOrNull(row.createdAt),
        durationSeconds:
            startedAt && finishedAt
                ? Math.max(0, (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
                : null,
    };
}

function timeOf(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
}

function isoOrNull(value: unknown): string | null {
    const time = timeOf(value);
    return time === null ? null : new Date(time).toISOString();
}
