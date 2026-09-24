// ============================================
// fairnessService.ts — running an audit and reading it back
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// The orchestration half. Everything that decides what a number MEANS is in
// `contract.ts` and `statistics.ts`; this file loads the data, chooses the reference
// cohort, evaluates the registry against what it measured, and persists the result as a
// snapshot.
//
// A RUN IS A SNAPSHOT, NOT A VIEW
//
// Every figure a run reports is computed once and stored. Nothing here recomputes a past
// run's numbers from current data, and that is deliberate: thresholds are judgements, a
// study's cutoff will move, and a report generated in March must not be silently re-read
// in June as though it had been produced under June's rule. `AuditRun` carries the
// declaration, the cutoff and the registry version it was computed with, and the report
// prints them.
//
// WHAT IS COUNTED, AND WHAT IS LEFT OUT
//
// The credibility of an audit is mostly a function of what it excluded, so exclusions are
// first-class here rather than a footnote. Two kinds matter:
//
//   · Responses whose scores are not attested — `scoreSource` of 'unverified' (a client
//     supplied them and no model decision could be traced) or 'not_measured' (nothing
//     scored them). An audit over numbers a candidate's own browser chose is not an audit,
//     so they are excluded rather than assumed good. This means a study that ran entirely
//     before this feature has nothing to analyse on day one, and the run says exactly that
//     instead of producing figures from unverifiable data.
//
//   · Sessions with no cohort assignment for a key. A candidate nobody tagged is in no
//     cohort, and leaving them out silently would make each cohort look like a larger share
//     of the sample than it is.
//
// Both are counted by reason and printed on the report.
//
// NO PROTECTED ATTRIBUTE IS READ, INFERRED OR STORED. `cohort.ts` refuses a declaration
// that names one; this file only ever reads the tags that survived that check.

import { randomUUID } from 'crypto';
import supabaseDb from '../supabaseDb';
import {
    BASE_CAVEATS,
    FAIRNESS_REGISTRY_VERSION,
    FOUR_FIFTHS_THRESHOLD,
    INCOMPLETE_TAGGING_CAVEAT,
    MIN_COHORT_N,
    SMALL_SAMPLE_CAVEAT,
    UNVERIFIED_SCORES_CAVEAT,
    biasFlagDefinition,
} from './contract';
import {
    computeCohortMetric,
    cohensD,
    evaluateFlag,
    itemDifferential,
    mean,
    sampleStdDev,
    summariseCohort,
    type CohortMetricResult,
    type CohortSummary,
} from './statistics';
import {
    EMPTY_DECLARATION,
    parseCohortDeclaration,
    validateAssignment,
    type CohortDeclaration,
} from './cohort';
import { SCORE_DIMENSIONS, scoringSystemsForStudy, type ScoreDimension } from './decisionLog';
import { buildComplianceReport, type ComplianceReport } from './complianceReport';

/** The dimension-level gaps are reported per key; this bounds the work one run does. */
export const MAX_COMPARISONS = 400;

// --------------------------------------------
// Shapes
// --------------------------------------------

/** A response this audit is willing to count: verified scores, all five present. */
interface ScoredResponse {
    id: string;
    sessionId: string;
    questionId: string;
    dimensions: Record<ScoreDimension, number>;
}

export interface ExclusionGroup {
    reason: string;
    count: number;
}

export interface AuditSummary {
    cohortKeys: string[];
    referenceByKey: Record<string, { value: string; reason: string }>;
    comparisonCount: number;
    sessionsConsidered: number;
    sessionsIncluded: number;
    responsesConsidered: number;
    responsesVerified: number;
    responsesUnverified: number;
    responsesNotMeasured: number;
    untaggedByKey: Record<string, number>;
}

export interface AuditRunResult {
    ok: boolean;
    runId: string | null;
    status: 'succeeded' | 'not_computable' | 'failed';
    /** Why the run did not succeed, when it did not. */
    reason: string | null;
    caveats: string[];
    summary: AuditSummary | null;
}

// --------------------------------------------
// Reading a study's declaration
// --------------------------------------------

/** The cohort declaration a study has configured, plus anything wrong with it. */
export async function studyCohortDeclaration(studyId: string) {
    const study = await supabaseDb.study.findUnique({ where: { id: studyId } });
    if (!study) {
        return { declaration: EMPTY_DECLARATION, issues: ['This study does not exist.'], undeclared: true };
    }
    return parseCohortDeclaration(study.configJSON as string | null);
}

// --------------------------------------------
// Cohort tagging
// --------------------------------------------

export interface AssignCohortParams {
    sessionId: string;
    cohortKey: unknown;
    cohortValue: unknown;
    assignedBy: string | null;
}

export type AssignCohortResult =
    | { state: 'accepted'; key: string; value: string }
    | { state: 'refused'; reason: string };

/**
 * Tags a candidate into a cohort.
 *
 * The tag is validated against the study's OWN declaration before anything is written, so
 * an undeclared key — including one naming a protected attribute — is refused at the
 * boundary rather than stored and filtered out later. A tag that exists in the table is a
 * tag some future query will find.
 *
 * Tagging again replaces the previous value for the same key rather than adding a second
 * row: a candidate is in one band, not two, and a table that could hold both would make
 * every count downstream ambiguous.
 */
export async function assignCohort(params: AssignCohortParams): Promise<AssignCohortResult> {
    const session = await supabaseDb.interviewSession.findUnique({ where: { id: params.sessionId } });
    if (!session) return { state: 'refused', reason: 'That interview session does not exist.' };

    const studyId = session.studyId ? String(session.studyId) : null;
    if (!studyId) {
        // A self-practice session belongs to no study, so there is no declaration to
        // validate against and nothing for an audit to group. Refused rather than stored.
        return { state: 'refused', reason: 'This interview session does not belong to a study, so it cannot be tagged into a cohort.' };
    }

    const { declaration } = await studyCohortDeclaration(studyId);
    const validation = validateAssignment(declaration, params.cohortKey, params.cohortValue);
    if (validation.state === 'refused') return { state: 'refused', reason: validation.reason };

    const existing = await supabaseDb.cohortAssignment.findFirst({
        where: { sessionId: params.sessionId, cohortKey: validation.key },
    });

    if (existing) {
        await supabaseDb.cohortAssignment.update({
            where: { id: String(existing.id) },
            data: {
                cohortValue: validation.value,
                assignedBy: params.assignedBy,
                assignedAt: new Date(),
            },
        });
    } else {
        await supabaseDb.cohortAssignment.create({
            data: {
                id: randomUUID(),
                sessionId: params.sessionId,
                studyId,
                cohortKey: validation.key,
                cohortValue: validation.value,
                assignedBy: params.assignedBy,
                assignedAt: new Date(),
            },
        });
    }

    return { state: 'accepted', key: validation.key, value: validation.value };
}

/** Every cohort tag in a study, for the tagging UI and for the audit. */
export async function cohortAssignmentsForStudy(studyId: string): Promise<Array<Record<string, any>>> {
    return supabaseDb.cohortAssignment.findMany({ where: { studyId } });
}

/**
 * Removes one tag.
 *
 * A mis-click has to be undoable, and the alternative — a tagging control whose "not tagged"
 * option silently does nothing — is worse than the mis-click: it teaches an interviewer that
 * the control lies. Nothing else is touched. Past audit runs keep the counts they were
 * computed with, because those are stored on the run and not re-derived from this table.
 *
 * Returns whether a row was actually removed, so the caller can tell "untagged" from
 * "there was nothing to untag".
 */
export async function removeCohortAssignment(sessionId: string, cohortKey: string): Promise<number> {
    const result = await supabaseDb.cohortAssignment.deleteMany({
        where: { sessionId, cohortKey },
    });
    return Number(result?.count ?? 0);
}

/** One session's tags, for the interviewer's per-candidate panel. */
export async function cohortAssignmentsForSession(sessionId: string): Promise<Array<Record<string, any>>> {
    return supabaseDb.cohortAssignment.findMany({ where: { sessionId } });
}

// --------------------------------------------
// The audit
// --------------------------------------------

export interface RunAuditParams {
    studyId: string;
    /** Who asked for the run. Recorded, never used to widen what is read. */
    actorId: string | null;
}

interface FlagInsert {
    id: string;
    auditRunId: string;
    targetType: string;
    targetId: string | null;
    cohortKey: string | null;
    cohortValue: string | null;
    label: string | null;
    severity: string;
    statistic: number | null;
    threshold: number | null;
    pValue: number | null;
    computable: boolean;
    notComputableReason: string | null;
    finding: string;
    whatItCannotSay: string;
    recommendation: string | null;
}

/**
 * The optional half of a flag row. Everything the registry supplies — severity, targetType,
 * whatItCannotSay — is deliberately excluded, so a call site cannot override the sentence
 * that says what the flag cannot tell you.
 */
type FlagFields = Partial<
    Omit<FlagInsert, 'id' | 'auditRunId' | 'severity' | 'targetType' | 'whatItCannotSay'>
>;

function flagRow(runId: string, key: string, fields: FlagFields): FlagInsert {
    const definition = biasFlagDefinition(key);
    if (!definition) {
        // A registry lookup that cannot fail in practice, but the type requires the branch.
        // A flag with no definition would have no `whatItCannotSay`, and a flag without one
        // is exactly what this feature refuses to emit — so it throws rather than defaults.
        throw new Error(`unknown fairness flag key: ${key}`);
    }
    return {
        id: randomUUID(),
        auditRunId: runId,
        targetType: definition.targetType,
        targetId: fields.targetId ?? null,
        cohortKey: fields.cohortKey ?? null,
        cohortValue: fields.cohortValue ?? null,
        label: fields.label ?? null,
        severity: definition.severity,
        statistic: fields.statistic ?? null,
        threshold: definition.threshold,
        pValue: fields.pValue ?? null,
        computable: fields.computable ?? true,
        notComputableReason: fields.notComputableReason ?? null,
        finding: fields.finding ?? definition.label,
        whatItCannotSay: definition.whatItCannotSay,
        recommendation: definition.recommendation,
    };
}

/**
 * Runs one audit for one study and stores it.
 *
 * NEVER THROWS. A run that fails is a row with `status: 'failed'` and the error on it, not
 * an exception a route has to translate — because a failed audit and an audit that found
 * nothing are completely different facts, and the one thing this feature must never do is
 * let the first be read as the second.
 */
export async function runAudit(params: RunAuditParams): Promise<AuditRunResult> {
    const runId = randomUUID();
    let created = false;

    try {
        const study = await supabaseDb.study.findUnique({ where: { id: params.studyId } });
        if (!study) {
            return { ok: false, runId: null, status: 'failed', reason: 'That study does not exist.', caveats: [], summary: null };
        }

        const { declaration, issues, undeclared } = parseCohortDeclaration(study.configJSON as string | null);
        const caveats: string[] = [...BASE_CAVEATS, ...issues];

        await supabaseDb.auditRun.create({
            data: {
                id: runId,
                studyId: params.studyId,
                scope: 'study',
                status: 'running',
                cohortDeclarationJSON: declaration,
                selectionThreshold: declaration.selectionThreshold,
                referenceCohortKey: declaration.referenceCohort?.key ?? null,
                referenceCohortValue: declaration.referenceCohort?.value ?? null,
                referenceReason: null,
                sampleSize: 0,
                includedSessions: 0,
                excludedJSON: null,
                caveatsJSON: caveats,
                summaryJSON: null,
                registryVersion: FAIRNESS_REGISTRY_VERSION,
                startedAt: new Date(),
                finishedAt: null,
                error: null,
                createdBy: params.actorId,
            },
        });
        created = true;

        // ── Data ─────────────────────────────────────────────────────────────
        const sessions = (await supabaseDb.interviewSession.findMany({
            where: { studyId: params.studyId },
        })) as Array<Record<string, any>>;
        const sessionIds = sessions.map((session) => String(session.id));

        const responses = sessionIds.length
            ? ((await supabaseDb.response.findMany({
                  where: { sessionId: { in: sessionIds } },
              })) as Array<Record<string, any>>)
            : [];

        const assignments = (await supabaseDb.cohortAssignment.findMany({
            where: { studyId: params.studyId },
        })) as Array<Record<string, any>>;

        // ── Which responses can be counted ───────────────────────────────────
        //
        // Only scores that are attested: written from a recorded model decision. An
        // 'unverified' row's numbers may or may not be the model's and nothing can say
        // which, and a 'not_measured' row has no numbers at all. Neither belongs in a
        // distribution that will be read as a measurement.
        const scoredResponses: ScoredResponse[] = [];
        let unverified = 0;
        let notMeasured = 0;

        for (const response of responses) {
            const source = String(response.scoreSource ?? 'unverified');
            const dimensions = {} as Record<ScoreDimension, number>;
            let complete = true;
            for (const dimension of SCORE_DIMENSIONS) {
                const value = Number(response[dimension]);
                if (!Number.isFinite(value)) {
                    complete = false;
                    break;
                }
                dimensions[dimension] = value;
            }

            if (source !== 'llm' || !complete) {
                if (source === 'not_measured' || !complete) notMeasured += 1;
                else unverified += 1;
                continue;
            }

            scoredResponses.push({
                id: String(response.id),
                sessionId: String(response.sessionId),
                questionId: response.questionId ? String(response.questionId) : '',
                dimensions,
            });
        }

        // ── One score per candidate ──────────────────────────────────────────
        //
        // The session's score is the mean over its verified answers of the mean over the
        // five dimensions. Computed here rather than read from `InterviewSession.averageScore`
        // so that this audit's notion of "the score" is exactly the set of answers it is
        // willing to count — a stored average would silently include the excluded ones.
        const responsesBySession = new Map<string, ScoredResponse[]>();
        for (const response of scoredResponses) {
            const list = responsesBySession.get(response.sessionId) ?? [];
            list.push(response);
            responsesBySession.set(response.sessionId, list);
        }

        const sessionScore = new Map<string, number>();
        for (const [sessionId, list] of responsesBySession) {
            const perResponse = list.map((response) => mean(SCORE_DIMENSIONS.map((d) => response.dimensions[d])) as number);
            const overall = mean(perResponse);
            if (overall !== null) sessionScore.set(sessionId, overall);
        }

        const exclusions: ExclusionGroup[] = [];
        const noScore = sessions.filter((session) => !sessionScore.has(String(session.id))).length;
        if (noScore > 0) {
            exclusions.push({
                reason:
                    'Sessions with no verified AI score. Their answers were scored by a client and could not be traced to a recorded model decision, or were never scored at all.',
                count: noScore,
            });
        }

        const threshold = declaration.selectionThreshold;
        const untaggedByKey: Record<string, number> = {};
        for (const key of declaration.cohortKeys) {
            const tagged = new Set(
                assignments.filter((a) => String(a.cohortKey) === key.key).map((a) => String(a.sessionId))
            );
            const missing = sessions.filter((session) => !tagged.has(String(session.id))).length;
            untaggedByKey[key.key] = missing;
            if (missing > 0) {
                exclusions.push({
                    reason: `Sessions with no "${key.label}" cohort tag.`,
                    count: missing,
                });
            }
        }

        // ── Nothing to group by ──────────────────────────────────────────────
        if (undeclared || declaration.cohortKeys.length === 0) {
            const reason =
                'This study declares no cohorts, so there is nothing to compare. Declare cohort keys in the study configuration before running an audit.';
            await finishRun(runId, 'not_computable', reason, [...caveats, SMALL_SAMPLE_CAVEAT], null, exclusions);
            return { ok: false, runId, status: 'not_computable', reason, caveats, summary: null };
        }

        // ── Measure ──────────────────────────────────────────────────────────
        const metricRows: Array<Record<string, unknown>> = [];
        const flagRows: FlagInsert[] = [];
        const referenceByKey: Record<string, { value: string; reason: string }> = {};
        let comparisonCount = 0;

        for (const key of declaration.cohortKeys) {
            const byValue = new Map<string, string[]>();
            for (const assignment of assignments) {
                if (String(assignment.cohortKey) !== key.key) continue;
                const value = String(assignment.cohortValue);
                if (!key.values.includes(value)) continue;
                const list = byValue.get(value) ?? [];
                list.push(String(assignment.sessionId));
                byValue.set(value, list);
            }

            // Only cohorts the study declared, whether or not anyone is in them. An empty
            // declared cohort appears on the report as "0 candidates", which is a fact
            // about the study rather than an absence.
            const samples = key.values.map((value) => {
                const sessionList = byValue.get(value) ?? [];
                const scores = sessionList
                    .map((sessionId) => sessionScore.get(sessionId))
                    .filter((score): score is number => typeof score === 'number');
                return { value, n: sessionList.length, scores };
            });

            const reference = chooseReference(key, samples, declaration);
            referenceByKey[key.key] = { value: reference.value, reason: reference.reason };

            const referenceSummary: CohortSummary = summariseCohort(
                samples.find((sample) => sample.value === reference.value)?.scores ?? [],
                threshold
            );

            for (const sample of samples) {
                const metric = computeCohortMetric(
                    { cohortKey: key.key, cohortValue: sample.value, n: sample.n, scores: sample.scores },
                    referenceSummary,
                    threshold
                );
                metricRows.push({ id: randomUUID(), auditRunId: runId, ...metric, computedAt: new Date() });

                // The reference cohort is measured against itself so the report shows the
                // baseline it compares everything else with. No flags can fire from it.
                if (sample.value === reference.value) continue;

                flagRows.push(...cohortFlags(runId, key, metric, reference.value, reference.reason));
                comparisonCount += 1;
            }

            // ── Dimension-level and item-level decomposition ─────────────────
            for (const sample of samples) {
                if (sample.value === reference.value) continue;
                const cohortSessions = new Set(byValue.get(sample.value) ?? []);
                const referenceSessions = new Set(byValue.get(reference.value) ?? []);

                for (const dimension of SCORE_DIMENSIONS) {
                    const a = collectDimension(scoredResponses, cohortSessions, dimension);
                    const b = collectDimension(scoredResponses, referenceSessions, dimension);
                    if (comparisonCount > MAX_COMPARISONS) break;
                    comparisonCount += 1;

                    const effect = cohensD(mean(a), sampleStdDev(a), a.length, mean(b), sampleStdDev(b), b.length);
                    const definition = biasFlagDefinition('dimensionCohortGap');
                    if (!definition) continue;
                    const evaluation = evaluateFlag(
                        definition,
                        effect.state === 'computed' ? effect.value : null,
                        null,
                        effect.state === 'computed' ? null : effect.reason
                    );
                    if (!evaluation.raised) continue;

                    flagRows.push(
                        flagRow(runId, 'dimensionCohortGap', {
                            targetId: dimension,
                            cohortKey: key.key,
                            cohortValue: sample.value,
                            label: DIMENSION_LABELS[dimension],
                            statistic: evaluation.statistic,
                            finding: `Cohort "${sample.value}" scored ${Math.abs(evaluation.statistic as number).toFixed(2)} standard deviations ${(evaluation.statistic as number) < 0 ? 'below' : 'above'} the reference cohort on ${DIMENSION_LABELS[dimension]}.`,
                        })
                    );
                }
            }
        }

        // ── Item-level analysis, for the primary key only ────────────────────
        //
        // Questions are examined against one cohort key rather than all of them: the
        // comparisons multiply fast, and every extra one is another chance of a spurious
        // finding. The primary key is the first declared, and the report says so.
        const primaryKey = declaration.cohortKeys[0];
        flagRows.push(
            ...(await itemFlags(
                runId,
                primaryKey,
                declaration,
                assignments,
                scoredResponses,
                comparisonCount,
                sessionIds
            ))
        );

        // ── Persist ──────────────────────────────────────────────────────────
        if (metricRows.length > 0) await supabaseDb.cohortMetric.createMany({ data: metricRows });
        if (flagRows.length > 0) {
            await supabaseDb.biasFlag.createMany({
                data: flagRows.map((row) => ({ ...row, flaggedAt: new Date() })),
            });
        }

        const summary: AuditSummary = {
            cohortKeys: declaration.cohortKeys.map((entry) => entry.key),
            referenceByKey,
            comparisonCount,
            sessionsConsidered: sessions.length,
            sessionsIncluded: sessionScore.size,
            responsesConsidered: responses.length,
            responsesVerified: scoredResponses.length,
            responsesUnverified: unverified,
            responsesNotMeasured: notMeasured,
            untaggedByKey,
        };

        if (unverified + notMeasured > 0) caveats.push(UNVERIFIED_SCORES_CAVEAT);
        if (Object.values(untaggedByKey).some((count) => count > 0)) caveats.push(INCOMPLETE_TAGGING_CAVEAT);
        if (sessionScore.size < declaration.minCohortSize * 2) caveats.push(SMALL_SAMPLE_CAVEAT);

        await finishRun(runId, 'succeeded', null, caveats, summary, exclusions);
        return { ok: true, runId, status: 'succeeded', reason: null, caveats, summary };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[fairness] audit failed:', reason);
        if (created) {
            try {
                await finishRun(runId, 'failed', reason, BASE_CAVEATS, null, []);
            } catch {
                // If even the failure cannot be recorded there is nothing further to do —
                // and swallowing it here keeps the original error as the one reported.
            }
        }
        return { ok: false, runId: created ? runId : null, status: 'failed', reason, caveats: [], summary: null };
    }
}

const DIMENSION_LABELS: Record<ScoreDimension, string> = {
    technicalScore: 'Technical accuracy',
    communicationScore: 'Communication clarity',
    confidenceScore: 'Confidence',
    logicScore: 'Logical structure',
    depthScore: 'Depth',
};

/** The verified scores for one dimension, restricted to a set of sessions. */
function collectDimension(
    responses: ScoredResponse[],
    sessions: Set<string>,
    dimension: ScoreDimension
): number[] {
    const values: number[] = [];
    for (const response of responses) {
        if (!sessions.has(response.sessionId)) continue;
        const value = response.dimensions[dimension];
        if (Number.isFinite(value)) values.push(value);
    }
    return values;
}

/**
 * Picks the cohort every other cohort is compared against.
 *
 * A study that named one gets it — that is a research decision and not this feature's to
 * make. Otherwise the largest cohort is used, because a rate computed from the largest
 * group is the most stable thing available to compare against, and a ratio whose
 * denominator is three people is not worth reporting. Either way the reason is stored on
 * the run and printed on the report: a reader has to know what "the reference" means
 * before a ratio means anything to them.
 */
function chooseReference(
    key: { key: string; label: string },
    samples: Array<{ value: string; n: number; scores: number[] }>,
    declaration: CohortDeclaration
): { value: string; reason: string } {
    const ranked = [...samples].sort((a, b) => b.scores.length - a.scores.length || b.n - a.n);
    const largest = ranked[0];

    if (declaration.referenceCohort && declaration.referenceCohort.key === key.key) {
        const named = declaration.referenceCohort.value;
        const declared = samples.find((sample) => sample.value === named);
        if (declared) {
            // A DECLARED REFERENCE IS A CHOICE THE STUDY MAKES, NOT A FLOOR IT WAIVES.
            //
            // The declaration decides WHICH cohort every ratio is relative to; it does not
            // decide whether there are enough people in it to form one. Honouring a
            // declaration of a two-person cohort would put a ratio on every other cohort in
            // the key with that cohort as the denominator, and a thin denominator with a
            // high rate manufactures adverse-impact flags against everyone else. So the
            // floor applies to the declared cohort exactly as it does to the automatic one,
            // and the substitution is stated in the reason rather than done quietly —
            // a reader comparing the report against the study's own declaration would
            // otherwise find the reference silently changed.
            if (declared.scores.length >= MIN_COHORT_N) {
                return { value: named, reason: `Declared by the study as the reference for "${key.label}".` };
            }
            return {
                value: largest.value,
                reason: `The study declared "${named}" as the reference for "${key.label}", but only ${declared.scores.length} ${declared.scores.length === 1 ? 'candidate' : 'candidates'} there ${declared.scores.length === 1 ? 'has' : 'have'} a usable score — below the ${MIN_COHORT_N} a comparison needs — so the cohort with the most scored candidates ("${largest.value}", ${largest.scores.length}) was used instead. Every ratio below is relative to that cohort, not to the declared one.`,
            };
        }
    }

    return {
        value: largest.value,
        reason: `The study named no reference for "${key.label}", so the cohort with the most scored candidates ("${largest.value}", ${largest.scores.length}) was used. Every ratio below is relative to this cohort.`,
    };
}

/** The three cohort-level flags, plus the stage flag that says where the gap appears. */
function cohortFlags(
    runId: string,
    key: { key: string; label: string },
    metric: CohortMetricResult,
    referenceValue: string,
    referenceReason: string
): FlagInsert[] {
    const rows: FlagInsert[] = [];
    const where = `Cohort "${metric.cohortValue}" (${key.label}) against the reference cohort "${referenceValue}"`;

    const ratioDefinition = biasFlagDefinition('adverseImpactRatio');
    const ratioEvaluation = evaluateFlag(
        ratioDefinition!,
        metric.adverseImpactRatio,
        metric.pValue,
        metric.ratioNotComputableReason ?? metric.notComputableReason
    );
    if (ratioEvaluation.raised) {
        rows.push(
            flagRow(runId, 'adverseImpactRatio', {
                cohortKey: key.key,
                cohortValue: metric.cohortValue,
                label: key.label,
                statistic: ratioEvaluation.statistic,
                pValue: ratioEvaluation.pValue,
                finding: `${where} was selected at ${((metric.adverseImpactRatio as number) * 100).toFixed(0)}% of the reference rate (${fmtPercent(metric.selectionRate)} against ${fmtPercent(metric.referenceRate)}), below the four-fifths line. ${referenceReason}`,
            })
        );
    } else if (ratioEvaluation.notComputableReason) {
        rows.push(
            flagRow(runId, 'adverseImpactRatio', {
                cohortKey: key.key,
                cohortValue: metric.cohortValue,
                label: key.label,
                computable: false,
                notComputableReason: ratioEvaluation.notComputableReason,
                finding: `No selection-rate ratio was computed for cohort "${metric.cohortValue}". ${ratioEvaluation.notComputableReason}`,
            })
        );
    }

    const pDefinition = biasFlagDefinition('selectionRateSignificantGap');
    const pEvaluation = evaluateFlag(pDefinition!, metric.zStatistic, metric.pValue, null);
    if (pEvaluation.raised) {
        rows.push(
            flagRow(runId, 'selectionRateSignificantGap', {
                cohortKey: key.key,
                cohortValue: metric.cohortValue,
                label: key.label,
                statistic: pEvaluation.statistic,
                pValue: pEvaluation.pValue,
                finding: `${where} differs by more than chance alone would explain (z = ${fmt(metric.zStatistic)}, p = ${fmtP(metric.pValue)}, two-tailed).`,
            })
        );
    }

    const effectDefinition = biasFlagDefinition('scoreDistributionGap');
    const effectEvaluation = evaluateFlag(effectDefinition!, metric.effectSize, null, null);
    if (effectEvaluation.raised) {
        rows.push(
            flagRow(runId, 'scoreDistributionGap', {
                cohortKey: key.key,
                cohortValue: metric.cohortValue,
                label: key.label,
                statistic: effectEvaluation.statistic,
                finding: `${where} scored ${Math.abs(metric.effectSize as number).toFixed(2)} standard deviations ${(metric.effectSize as number) < 0 ? 'below' : 'above'} the reference cohort across all dimensions.`,
            })
        );
    }

    // ── Where in the pipeline the gap appears ────────────────────────────────
    //
    // A selection-rate gap can come from two very different places, and telling them apart
    // is the roadmap's "decomposition of where a gap appears". If the scores barely differ
    // but the selection rates differ sharply, the cutoff is amplifying a small scoring
    // difference — and the fix is the cutoff, not the questions. If the scores differ
    // substantially as well, the gap is upstream of the cutoff. This flag marks the first
    // case; its absence means the second, and `scoreDistributionGap` above says when.
    if (
        metric.adverseImpactRatio !== null &&
        metric.adverseImpactRatio < FOUR_FIFTHS_THRESHOLD &&
        metric.effectSize !== null &&
        Math.abs(metric.effectSize) < 0.2
    ) {
        rows.push(
            flagRow(runId, 'cutoffAmplification', {
                cohortKey: key.key,
                cohortValue: metric.cohortValue,
                label: key.label,
                statistic: metric.adverseImpactRatio,
                finding: `${where} crosses the four-fifths line (${fmtRatio(metric.adverseImpactRatio)}) while the two cohorts' scores differ by only ${Math.abs(metric.effectSize).toFixed(2)} standard deviations. The cutoff is turning a small scoring difference into a large selection difference.`,
            })
        );
    }

    return rows;
}

/**
 * Question-level gaps, examined for the primary cohort key.
 *
 * A question nobody answered in both cohorts produces nothing — `itemDifferential` refuses
 * and the refusal is not stored as a flag, because "we could not compare this question" is
 * true of most questions in a small study and would drown the findings that matter. The
 * count of comparisons is recorded on the run instead, so the reader can see how many
 * tests the p-values are competing with.
 */
async function itemFlags(
    runId: string,
    key: { key: string; label: string; values: string[] },
    declaration: CohortDeclaration,
    assignments: Array<Record<string, any>>,
    responses: ScoredResponse[],
    startingComparisons: number,
    sessionIds: string[]
): Promise<FlagInsert[]> {
    const rows: FlagInsert[] = [];
    if (!key) return rows;

    const byValue = new Map<string, Set<string>>();
    for (const assignment of assignments) {
        if (String(assignment.cohortKey) !== key.key) continue;
        const value = String(assignment.cohortValue);
        if (!key.values.includes(value)) continue;
        const set = byValue.get(value) ?? new Set<string>();
        set.add(String(assignment.sessionId));
        byValue.set(value, set);
    }

    const counts = [...byValue.entries()].map(([value, sessions]) => ({ value, size: sessions.size }));
    if (counts.length < 2) return rows;

    const ranked = [...counts].sort((a, b) => b.size - a.size);
    const referenceValue =
        declaration.referenceCohort?.key === key.key && byValue.has(declaration.referenceCohort.value)
            ? declaration.referenceCohort.value
            : ranked[0].value;
    const referenceSessions = byValue.get(referenceValue) ?? new Set<string>();

    // Scoped to this study's sessions. NOT `where: {}` — an empty where-clause in the
    // supabaseDb shim means the WHOLE TABLE, which here would be every question ever asked
    // on the platform (see the note in SECURITY-SWEEP-HANDOFF.md §5).
    const questions = sessionIds.length
        ? ((await supabaseDb.question.findMany({
              where: { sessionId: { in: sessionIds } },
          })) as Array<Record<string, any>>)
        : [];
    const questionText = new Map(questions.map((question) => [String(question.id), String(question.text ?? '')]));

    let comparisons = startingComparisons;

    for (const [value, sessions] of byValue) {
        if (value === referenceValue) continue;

        const byQuestion = new Map<string, number[]>();
        for (const response of responses) {
            if (!sessions.has(response.sessionId)) continue;
            const score = mean(SCORE_DIMENSIONS.map((dimension) => response.dimensions[dimension]));
            if (score === null) continue;
            const list = byQuestion.get(response.questionId) ?? [];
            list.push(score);
            byQuestion.set(response.questionId, list);
        }

        for (const [questionId, scores] of byQuestion) {
            if (comparisons >= MAX_COMPARISONS) break;
            const referenceScores = responses
                .filter((response) => referenceSessions.has(response.sessionId) && response.questionId === questionId)
                .map((response) => mean(SCORE_DIMENSIONS.map((dimension) => response.dimensions[dimension])))
                .filter((score): score is number => score !== null);

            comparisons += 1;
            const effect = itemDifferential(scores, referenceScores);
            if (effect.state === 'refused') continue;

            const definition = biasFlagDefinition('itemCohortGap');
            const evaluation = evaluateFlag(definition!, effect.value, null, null);
            if (!evaluation.raised) continue;

            const text = questionText.get(questionId) ?? '';
            rows.push(
                flagRow(runId, 'itemCohortGap', {
                    targetId: questionId,
                    cohortKey: key.key,
                    cohortValue: value,
                    label: text.length > 90 ? `${text.slice(0, 90)}…` : text || null,
                    statistic: evaluation.statistic,
                    finding: `Cohort "${value}" scored ${Math.abs(effect.value).toFixed(2)} standard deviations ${effect.value < 0 ? 'below' : 'above'} the reference cohort (${referenceValue}) on one question${text ? `: "${text.length > 140 ? `${text.slice(0, 140)}…` : text}"` : ''}.`,
                })
            );
        }
    }

    return rows;
}

// --------------------------------------------
// Finishing a run
// --------------------------------------------

async function finishRun(
    runId: string,
    status: 'succeeded' | 'not_computable' | 'failed',
    reason: string | null,
    caveats: readonly string[],
    summary: AuditSummary | null,
    exclusions: ExclusionGroup[]
): Promise<void> {
    await supabaseDb.auditRun.update({
        where: { id: runId },
        data: {
            status,
            error: reason,
            caveatsJSON: [...caveats],
            summaryJSON: summary,
            excludedJSON: exclusions,
            sampleSize: summary ? summary.sessionsConsidered : 0,
            includedSessions: summary ? summary.sessionsIncluded : 0,
            finishedAt: new Date(),
        },
    });
}

// --------------------------------------------
// Reading runs back
// --------------------------------------------

/** A study's runs, newest first. */
export async function listAuditRuns(studyId: string, limit = 25): Promise<Array<Record<string, any>>> {
    const rows = (await supabaseDb.auditRun.findMany({ where: { studyId } })) as Array<Record<string, any>>;
    return rows
        .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())
        .slice(0, Math.max(1, Math.min(limit, 100)));
}

export interface AuditRunDetail {
    run: Record<string, any>;
    metrics: Array<Record<string, any>>;
    flags: Array<Record<string, any>>;
}

/** One run with its metrics and flags. Returns null when the run does not exist. */
export async function readAuditRun(runId: string): Promise<AuditRunDetail | null> {
    const run = await supabaseDb.auditRun.findUnique({ where: { id: runId } });
    if (!run) return null;

    const [metrics, flags] = await Promise.all([
        supabaseDb.cohortMetric.findMany({ where: { auditRunId: runId } }),
        supabaseDb.biasFlag.findMany({ where: { auditRunId: runId } }),
    ]);

    const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
    (flags as Array<Record<string, any>>).sort(
        (a, b) => (severityRank[String(a.severity)] ?? 9) - (severityRank[String(b.severity)] ?? 9)
    );

    return { run, metrics, flags };
}

/** The most recent successful run for a study, or null. */
export async function latestRunForStudy(studyId: string): Promise<Record<string, any> | null> {
    const rows = await listAuditRuns(studyId, 100);
    return rows.find((row) => String(row.status) === 'succeeded') ?? rows[0] ?? null;
}

/** Reads a JSON column that may be an object already, text, null, or garbage. */
function parseJsonColumn(value: unknown): any {
    if (value === null || value === undefined) return null;
    // Already parsed: the shim reads a jsonb column as an object, so this is the common path.
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        // Truncated or malformed history is read as absent rather than allowed to throw. A
        // past run whose summary cannot be parsed is still a real run that happened, and a
        // console that 500s on it loses the run for good.
        return null;
    }
}

/**
 * A stored run, in the shape a reader consumes.
 *
 * Four of an "AuditRun" row's columns are JSON — the summary, the caveats, the exclusions
 * and the declaration snapshot. Normalised here once, because every consumer would
 * otherwise parse them itself and each would get the malformed case slightly differently.
 */
export function presentRun(run: Record<string, any>): Record<string, any> {
    return {
        id: String(run.id),
        studyId: run.studyId ? String(run.studyId) : null,
        scope: run.scope ?? null,
        status: String(run.status ?? 'unknown'),
        selectionThreshold: run.selectionThreshold ?? null,
        referenceCohortKey: run.referenceCohortKey ?? null,
        referenceCohortValue: run.referenceCohortValue ?? null,
        sampleSize: Number(run.sampleSize ?? 0),
        includedSessions: Number(run.includedSessions ?? 0),
        registryVersion: Number(run.registryVersion ?? 0),
        startedAt: run.startedAt ?? null,
        finishedAt: run.finishedAt ?? null,
        error: run.error ?? null,
        summary: parseJsonColumn(run.summaryJSON),
        caveats: parseJsonColumn(run.caveatsJSON) ?? [],
        exclusions: parseJsonColumn(run.excludedJSON) ?? [],
        // The snapshot of what the study had declared when this run was made. Sent so a past
        // finding is never re-read under rules that did not exist when it was recorded.
        declaration: parseJsonColumn(run.cohortDeclarationJSON),
    };
}

// --------------------------------------------
// The compliance report
// --------------------------------------------

/**
 * The study's name from its configuration, or null.
 *
 * `configJSON` is a text column that anything may have written, so a malformed value is
 * treated as "no name" rather than allowed to throw. The report falls back to the study id,
 * which is ugly and true; a report that fails to render because someone's configuration was
 * truncated is a report nobody can produce when they most need it.
 */
function studyNameFrom(configJSON: unknown): string | null {
    if (typeof configJSON !== 'string' || !configJSON) return null;
    try {
        const parsed = JSON.parse(configJSON);
        const name = parsed?.name;
        return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
        return null;
    }
}

/**
 * A sentence naming the system that scored this study, or null when the log records none.
 *
 * "None recorded" and "no scores were logged" are different facts and are not collapsed:
 * a study whose decisions exist but carry no model id says so, because a reader is entitled
 * to know that the audit could not identify what it audited.
 */
export async function systemDescriptionForStudy(studyId: string): Promise<string | null> {
    const { systems, promptVersions, decisionCount } = await scoringSystemsForStudy(studyId);
    if (decisionCount === 0) return null;

    const named = systems.join(', ');
    const prompt = promptVersions.length ? `, prompt version ${promptVersions.join(', ')}` : '';
    const count = `${decisionCount} recorded model decision${decisionCount === 1 ? '' : 's'}`;
    return `${named}${prompt}, from ${count}`;
}

/**
 * The compliance report for one stored run, or null when the run does not exist.
 *
 * One implementation, used by the JSON read, the PDF and the CSV, so the three renderings
 * of a run can never disagree about what it found. The study name and the system
 * description are read here rather than passed in by a route, for the same reason.
 */
export async function reportForRun(runId: string): Promise<ComplianceReport | null> {
    const detail = await readAuditRun(runId);
    if (!detail) return null;

    const studyId = detail.run.studyId ? String(detail.run.studyId) : null;
    let studyName: string | null = null;
    let systemDescription: string | null = null;

    if (studyId) {
        const study = await supabaseDb.study.findUnique({ where: { id: studyId } });
        studyName = studyNameFrom(study?.configJSON);
        systemDescription = await systemDescriptionForStudy(studyId);
    }

    return buildComplianceReport({
        run: detail.run,
        metrics: detail.metrics,
        flags: detail.flags,
        studyName,
        systemDescription,
        generatedAt: new Date(),
    });
}

/**
 * Everything the interviewer's per-study fairness panel shows.
 *
 * Deliberately thin: the panel is a summary that tells an interviewer whether anything was
 * found and lets them reach the full report. The analysis itself is admin-facing, because
 * a per-cohort breakdown of a study's candidates is not something to put in front of
 * everyone who can see that study.
 */
export async function studyFairnessSummary(studyId: string) {
    const { declaration, issues, undeclared } = await studyCohortDeclaration(studyId);
    const run = await latestRunForStudy(studyId);

    let flagCounts = { high: 0, medium: 0, low: 0, info: 0 };
    if (run && String(run.status) === 'succeeded') {
        const flags = (await supabaseDb.biasFlag.findMany({ where: { auditRunId: String(run.id) } })) as Array<
            Record<string, any>
        >;
        flagCounts = { high: 0, medium: 0, low: 0, info: 0 };
        for (const flag of flags) {
            const severity = String(flag.severity) as keyof typeof flagCounts;
            if (severity in flagCounts) flagCounts[severity] += 1;
        }
    }

    const assignments = await cohortAssignmentsForStudy(studyId);

    return {
        studyId,
        declaration,
        declarationIssues: issues,
        undeclared,
        cohortKeys: declaration.cohortKeys,
        selectionThreshold: declaration.selectionThreshold,
        taggedSessions: new Set(assignments.map((row) => String(row.sessionId))).size,
        assignmentCount: assignments.length,
        run: run
            ? {
                  id: String(run.id),
                  status: String(run.status),
                  startedAt: run.startedAt ?? null,
                  finishedAt: run.finishedAt ?? null,
                  error: run.error ?? null,
                  sampleSize: Number(run.sampleSize ?? 0),
                  includedSessions: Number(run.includedSessions ?? 0),
                  registryVersion: Number(run.registryVersion ?? 0),
                  caveats: Array.isArray(run.caveatsJSON) ? run.caveatsJSON : [],
                  exclusions: Array.isArray(run.excludedJSON) ? run.excludedJSON : [],
              }
            : null,
        flagCounts,
    };
}

// --------------------------------------------
// Formatting, shared with the report
// --------------------------------------------

function fmt(value: number | null): string {
    return value === null || !Number.isFinite(value) ? 'not computed' : value.toFixed(2);
}

function fmtP(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'not computed';
    return value < 0.0001 ? '<0.0001' : value.toFixed(4);
}

function fmtPercent(value: number | null): string {
    return value === null || !Number.isFinite(value) ? 'not computed' : `${(value * 100).toFixed(1)}%`;
}

function fmtRatio(value: number | null): string {
    return value === null || !Number.isFinite(value) ? 'not computed' : value.toFixed(2);
}

export const formatters = { fmt, fmtP, fmtPercent, fmtRatio };
