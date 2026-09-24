// ============================================
// decisionLog.ts — the provenance log, append-only
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// Every AI-influenced scoring decision, recorded with the model that made it, the prompt
// version it was made under, a hash of the exact input, and the output — so that a person
// asking "why did I get this number" can be answered from evidence rather than from a
// reconstruction.
//
// THIS MODULE EXPORTS NO UPDATE AND NO DELETE FOR "DecisionLog"
//
// Not because a caller is trusted, but because a log with a write-back path is not a log.
// The integrity feature makes the same promise about its review log and for the same
// reason: the way to guarantee a history cannot be rewritten is to give nobody a function
// that rewrites it. `appendScoredDecision` and `appendLinkedDecision` are the only writers,
// both append, and neither can reach a row that already exists.
//
// THE TWO-PHASE PROBLEM, AND WHY THE LOG IS SHAPED THE WAY IT IS
//
// The model call and the score's persistence happen in two different HTTP requests, and
// neither knows what the other knows:
//
//   POST /api/interview                    makes the model call, is not told the session
//   POST /api/sessions/[id]/save-response  knows the session, makes no model call
//
// Before this feature that gap was not merely untidy. The scores a hiring decision would
// rest on arrived in the second request's body, supplied by the candidate's own browser,
// and nothing anywhere compared them with what the model had said. A bias audit over
// numbers a candidate can choose is not an audit.
//
// So the decision is recorded twice, and `decisionId` — minted at the model call, echoed
// back by the client — is what joins the two rows:
//
//   phase 'scored'   the model's decision. Carries the provenance and the scores the model
//                    returned. Has no session, because the route does not know one.
//   phase 'linked'   where it landed. Carries the session and response ids, and the
//                    outcome of comparing the client's claimed scores with the model's.
//
// The second row is an APPEND, not a write-back, which is what lets a two-phase record
// live in an append-only table. The database enforces the shape: a 'scored' row may not
// carry a session or a verification, and a 'linked' row must carry both.
//
// VERIFICATION RECORDS, IT DOES NOT ENFORCE
//
// When the client's claimed scores differ from the model's, this module records the
// divergence and returns the model's scores to be persisted. It does not reject the
// request. Refusing the write would break a live interview in order to make a point, and a
// candidate mid-answer is not the audience for that point — the audit reader is. The
// mismatch is a fact about the row, preserved in `mismatchJSON`, and it is visible to
// anyone who looks.

import { createHash, randomUUID } from 'crypto';
import supabaseDb from '../supabaseDb';
import { INTERVIEW_PROMPT_VERSION } from '../prompts/interview';

/** The five dimensions an answer is scored on. The set is closed. */
export const SCORE_DIMENSIONS = [
    'technicalScore',
    'communicationScore',
    'confidenceScore',
    'logicScore',
    'depthScore',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** All five, always. A partial set is not a measurement. */
export type ScoreSet = Record<ScoreDimension, number>;

/**
 * How far a claimed score may differ from the logged one and still be the same number.
 *
 * Essentially exact, and deliberately so: the tolerance exists for JSON round-tripping,
 * not for disagreement. It only affects the label on the row — a verified decision always
 * persists the model's scores — so there is nothing to gain by widening it.
 */
export const SCORE_MATCH_TOLERANCE = 0.01;

export type VerificationOutcome = 'match' | 'mismatch' | 'no_scores' | 'unverified';

// --------------------------------------------
// Reading a score set out of something untyped
// --------------------------------------------

/**
 * The outcome of reading a score set.
 *
 * A string discriminant, not a boolean, because `strict: false` in this backend means a
 * boolean-literal union does not narrow — the "not measured" branch would be invisible to
 * the compiler, which is precisely the branch that must not be skipped.
 */
export type ScoreSetRead =
    | { state: 'measured'; scores: ScoreSet }
    | { state: 'not_measured'; reason: string };

/**
 * Reads a score set, requiring all five dimensions to be finite numbers in 0–100.
 *
 * ALL FIVE OR NONE. A model response carrying four of the five is not a partial
 * measurement to be filled in — it is a response this feature cannot use, and the honest
 * handling is to record the answer as not measured. The project's rule is that no
 * measurement is ever fabricated, and the most common way to fabricate one is not to
 * invent a number but to accept an incomplete set and let a default fill the gap.
 */
export function readScoreSet(raw: unknown): ScoreSetRead {
    if (!raw || typeof raw !== 'object') {
        return { state: 'not_measured', reason: 'no scores were present' };
    }
    const source = raw as Record<string, unknown>;
    const scores = {} as ScoreSet;

    for (const dimension of SCORE_DIMENSIONS) {
        const value = source[dimension];
        if (value === null || value === undefined) {
            return { state: 'not_measured', reason: `${dimension} was missing` };
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return { state: 'not_measured', reason: `${dimension} was not a number` };
        }
        if (numeric < 0 || numeric > 100) {
            return { state: 'not_measured', reason: `${dimension} was outside 0–100` };
        }
        scores[dimension] = numeric;
    }

    return { state: 'measured', scores };
}

// --------------------------------------------
// What gets stored, and under which label
// --------------------------------------------

/**
 * A PII-free summary of a model response, for the log's `outputJSON`.
 *
 * The raw response CANNOT be stored here. It carries `message` — the interviewer's prose,
 * which quotes the candidate — and `profileUpdates`, whose values are the candidate's own
 * background extracted from their own words. Putting that into a second table would be
 * collecting the candidate's data twice, for an audit purpose they never agreed to, and it
 * would breach this feature's "zero new PII columns" promise while every column-level check
 * still passed.
 *
 * So the log keeps the STRUCTURE of the decision and none of its content: which question
 * was addressed, whether a phase moved, whether the interview was concluded, how many
 * profile fields the model touched, and how long the message was. Those are enough to check
 * that the extraction behaved and to recognise a decision again; the prose stays in the
 * transcript, where it already lives under the session's own access control.
 *
 * Counts rather than values is the same discipline `fairnessService` applies to its
 * exclusions, which are stored as counts by reason and never as session ids.
 */
export function redactOutput(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Record<string, any>;
    return {
        questionAddressed: typeof source.questionAddressed === 'number' ? source.questionAddressed : null,
        phaseTransition: typeof source.phaseTransition === 'string' ? source.phaseTransition : null,
        shouldConclude: source.shouldConclude === true,
        profileFieldsUpdated: Array.isArray(source.profileUpdates) ? source.profileUpdates.length : 0,
        messageLength: typeof source.message === 'string' ? source.message.length : 0,
        scoresReturned: Boolean(source.scores && typeof source.scores === 'object'),
    };
}

/**
 * The provenance label for a persisted measurement.
 *
 * `'not_measured'` whenever there is nothing to persist, which is the first clause of the
 * `Response_score_source_measured_check` constraint: a row labelled not-measured carries no
 * scores, and a row carrying scores is not labelled not-measured. Returning the label and
 * the scores from one function is what makes the pair impossible to get out of step — a
 * caller cannot label an empty row 'llm' or a filled row 'not_measured'.
 *
 * `'llm'` means the five numbers were read back from a recorded model decision. `'unverified'`
 * means they are a claim the audit could not trace to one; they are kept because a claim is
 * itself evidence, and excluded from every fairness figure because they are not measurements.
 */
export type ScoreSource = 'llm' | 'unverified' | 'not_measured';

export function scoreSourceFor(verification: VerificationOutcome, persist: ScoreSet | null): ScoreSource {
    if (persist === null) return 'not_measured';
    return verification === 'match' || verification === 'mismatch' ? 'llm' : 'unverified';
}

/**
 * Whether a stored `Response` row carries a number that may be used as a measurement.
 *
 * True only for `'llm'` — the five values were read back from a recorded model decision.
 * `'unverified'` is excluded because a claim nothing could be traced to is evidence of a
 * claim, not a measurement, and `'not_measured'` because there is nothing there at all.
 *
 * Rows written before this feature existed default to `'unverified'`, which is the honest
 * label for a score whose origin was never recorded. They are not silently promoted to
 * measurements anywhere — not in the audit, not in a session average, and not in the
 * ability engine, where the numbers become claims about what a person can do.
 *
 * Every consumer of the five score columns must go through this or through `readScoreSet`.
 * The failure it prevents is not an error but a substitution: `Number(row.x) || 0` reads a
 * not-measured answer as a confident zero, and an average or a competence built from those
 * is a fabricated measurement wearing the clothes of a real one.
 */
export function isMeasuredResponse(row: { scoreSource?: unknown } | null | undefined): boolean {
    return Boolean(row) && (row as Record<string, unknown>).scoreSource === 'llm';
}

// --------------------------------------------
// Verification (pure)
// --------------------------------------------

export interface ScoredLookup {
    /** Whether a 'scored' row was found for the client's decisionId. */
    found: boolean;
    /** The model's scores, or null when the model returned none. */
    loggedScores: ScoreSet | null;
}

export interface ScoreVerification {
    verification: VerificationOutcome;
    /**
     * The scores to persist. Null means the answer is recorded as NOT MEASURED.
     *
     * When a verified decision exists this is always the model's set, never the client's —
     * which is the whole point. The client's numbers are evidence of what the client
     * claimed, and are kept in `mismatch` when they differ, but they are never what gets
     * stored as the measurement.
     */
    persist: ScoreSet | null;
    mismatch: {
        claimed: ScoreSet;
        logged: ScoreSet;
        deltas: Record<string, number>;
    } | null;
    reason: string;
}

/**
 * Compares what a client asked to persist against what the model actually produced.
 *
 * `verification` answers one question: were the numbers the client asserted the numbers
 * the model produced? `'match'` covers the case where the client asserted none at all and
 * the model's were used, because the fact being recorded is about the persisted values
 * rather than about the comparison — and a client that asserts nothing is not asserting
 * something different.
 */
export function verifyScores(lookup: ScoredLookup, claimed: ScoreSet | null): ScoreVerification {
    if (!lookup.found) {
        // No decisionId, or one that matches no row: an older client, a resumed interview,
        // a provider failure, or a log that could not be written. The scores cannot be
        // attested to. They are persisted as the client supplied them and labelled
        // 'unverified', which is what they are, and the audit excludes them.
        return {
            verification: 'unverified',
            persist: claimed,
            mismatch: null,
            reason: 'no recorded model decision matched this answer, so its scores cannot be traced',
        };
    }

    if (lookup.loggedScores === null) {
        // The decision was traced and the model returned no scores for it. The answer is
        // recorded as not measured — never as five zeroes.
        return {
            verification: 'no_scores',
            persist: null,
            mismatch: null,
            reason: 'the model decision was traced but it returned no scores for this answer',
        };
    }

    if (claimed === null) {
        return {
            verification: 'match',
            persist: lookup.loggedScores,
            mismatch: null,
            reason: 'the client asserted no scores; the model\'s were used',
        };
    }

    const deltas: Record<string, number> = {};
    let diverged = false;
    for (const dimension of SCORE_DIMENSIONS) {
        const delta = claimed[dimension] - lookup.loggedScores[dimension];
        deltas[dimension] = Math.round(delta * 1000) / 1000;
        if (Math.abs(delta) > SCORE_MATCH_TOLERANCE) diverged = true;
    }

    if (!diverged) {
        return {
            verification: 'match',
            persist: lookup.loggedScores,
            mismatch: null,
            reason: 'the persisted scores are the model\'s',
        };
    }

    return {
        verification: 'mismatch',
        persist: lookup.loggedScores,
        mismatch: { claimed, logged: lookup.loggedScores, deltas },
        reason: 'the scores submitted for this answer were not the ones the model produced; the model\'s were stored and the difference is recorded',
    };
}

// --------------------------------------------
// Input hashing (pure)
// --------------------------------------------

/**
 * A canonical serialisation, so the same input always hashes the same way.
 *
 * Object keys are sorted and the messages are reduced to role and content. Without this,
 * two identical interviews would hash differently because a property was built in a
 * different order, and the hash would be useless for recognising a repeated input — which
 * is the only thing it is for.
 */
export function canonicaliseInput(parts: {
    studyId?: string | null;
    promptVersion?: string | null;
    systemPrompt?: string | null;
    messages: Array<{ role?: unknown; content?: unknown }>;
}): string {
    const messages = (parts.messages ?? []).map((message) => ({
        role: String(message?.role ?? ''),
        content: String(message?.content ?? ''),
    }));
    return JSON.stringify({
        studyId: parts.studyId ?? null,
        promptVersion: parts.promptVersion ?? INTERVIEW_PROMPT_VERSION,
        systemPrompt: parts.systemPrompt ?? null,
        messages,
    });
}

/** sha256 over the canonical form. Hex, so it is storable as text and greppable. */
export function hashInput(parts: Parameters<typeof canonicaliseInput>[0]): string {
    return createHash('sha256').update(canonicaliseInput(parts), 'utf8').digest('hex');
}

// --------------------------------------------
// Writing (append only)
// --------------------------------------------

export interface ScoredDecisionInput {
    decisionId?: string;
    studyId: string | null;
    userId: string | null;
    provider: string | null;
    modelId: string | null;
    promptVersion?: string | null;
    inputHash: string;
    /** The raw model output, stored so the extraction can be checked as well as the answer. */
    output: unknown;
    /** The scores the model returned, or null when it returned none. */
    scores: ScoreSet | null;
    /** When the model decided, if the caller knows; defaults to now. */
    decidedAt?: Date | null;
}

export interface AppendResult {
    /** Null when the row could not be written. */
    decisionId: string | null;
    /** Why not, when it could not be written. */
    reason: string | null;
}

/**
 * Records a model decision. Phase one.
 *
 * NEVER THROWS. A failure to write the log must not fail the interview — a candidate
 * mid-answer is not the right person to pay for a database problem. The failure is
 * returned instead, and the caller passes a null decisionId onward, which produces a
 * 'linked' row labelled 'unverified'. That is an honest record of what happened: the
 * scores could not be traced, and the audit knows it.
 */
export async function appendScoredDecision(input: ScoredDecisionInput): Promise<AppendResult> {
    const decisionId = input.decisionId ?? randomUUID();

    try {
        await supabaseDb.decisionLog.create({
            data: {
                id: decisionId,
                decisionId,
                phase: 'scored',
                sessionId: null,
                responseId: null,
                studyId: input.studyId,
                userId: input.userId,
                provider: input.provider,
                modelId: input.modelId,
                promptVersion: input.promptVersion ?? INTERVIEW_PROMPT_VERSION,
                inputHash: input.inputHash,
                outputJSON: input.output ?? null,
                scoresJSON: input.scores ?? null,
                verification: null,
                mismatchJSON: null,
                decidedAt: input.decidedAt ?? new Date(),
            },
        });
        return { decisionId, reason: null };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[fairness] could not write the decision log:', reason);
        return { decisionId: null, reason };
    }
}

export interface LinkedDecisionInput {
    decisionId: string | null;
    sessionId: string;
    responseId: string | null;
    studyId: string | null;
    userId: string | null;
    verification: VerificationOutcome;
    mismatch?: ScoreVerification['mismatch'];
    /** Why this verification outcome, for a reader of the log. */
    reason: string;
    provider?: string | null;
    modelId?: string | null;
}

/**
 * Records where a model decision landed. Phase two. Append only — the 'scored' row is
 * never touched.
 *
 * Never throws, for the same reason as above. A link row that cannot be written leaves the
 * 'scored' row orphaned and the answer's scores labelled 'unverified' by the caller, which
 * is again the honest outcome.
 */
export async function appendLinkedDecision(input: LinkedDecisionInput): Promise<AppendResult> {
    try {
        await supabaseDb.decisionLog.create({
            data: {
                id: randomUUID(),
                decisionId: input.decisionId ?? `unlinked-${randomUUID()}`,
                phase: 'linked',
                sessionId: input.sessionId,
                responseId: input.responseId,
                studyId: input.studyId,
                userId: input.userId,
                provider: input.provider ?? null,
                modelId: input.modelId ?? null,
                promptVersion: null,
                inputHash: null,
                outputJSON: input.reason ? { note: input.reason } : null,
                scoresJSON: null,
                verification: input.verification,
                mismatchJSON: input.mismatch ?? null,
                decidedAt: new Date(),
            },
        });
        return { decisionId: input.decisionId, reason: null };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error('[fairness] could not link the decision log:', reason);
        return { decisionId: null, reason };
    }
}

// --------------------------------------------
// Reading
// --------------------------------------------

/**
 * Finds the model decision a client is pointing at.
 *
 * Returns `found: false` for a decisionId that names no 'scored' row, and for a null
 * decisionId — the client did not send one. Both mean the same thing to a caller: nothing
 * can be attested to. The scores are deliberately NOT returned from an unrecognised
 * decisionId; there is nothing to return.
 */
export async function findScoredDecision(decisionId: string | null | undefined): Promise<ScoredLookup> {
    if (!decisionId || String(decisionId).trim().length === 0) {
        return { found: false, loggedScores: null };
    }

    const row = await supabaseDb.decisionLog.findFirst({
        where: { decisionId: String(decisionId), phase: 'scored' },
    });
    if (!row) return { found: false, loggedScores: null };

    const read = readScoreSet(row.scoresJSON);
    return { found: true, loggedScores: read.state === 'measured' ? read.scores : null };
}

/** A decision as it is shown to the candidate who asked how a score was produced. */
export interface DecisionRecord {
    decisionId: string;
    sessionId: string | null;
    responseId: string | null;
    modelId: string | null;
    provider: string | null;
    promptVersion: string | null;
    inputHash: string | null;
    scores: ScoreSet | null;
    verification: VerificationOutcome | null;
    decidedAt: string | null;
    note: string | null;
}

export interface StoredDecisionRow {
    id: string;
    decisionId: string;
    phase: string;
    sessionId: string | null;
    responseId: string | null;
    modelId: string | null;
    provider: string | null;
    promptVersion: string | null;
    inputHash: string | null;
    scoresJSON: unknown;
    verification: string | null;
    outputJSON: any;
    decidedAt: string | Date | null;
}

/**
 * Rebuilds a decision from its two rows for display.
 *
 * Written as a pure function of the rows so verify-fairness can exercise it without a
 * database, and so the pairing rule has exactly one implementation: a 'linked' row without
 * its 'scored' row is reported with no provenance rather than with a guess at one.
 */
export function fromStoredDecision(scored: StoredDecisionRow | null, linked: StoredDecisionRow | null): DecisionRecord {
    const read: ScoreSetRead = scored
        ? readScoreSet(scored.scoresJSON)
        : { state: 'not_measured', reason: 'no model decision was recorded for this answer' };
    const note =
        linked && linked.outputJSON && typeof linked.outputJSON === 'object' && 'note' in linked.outputJSON
            ? String((linked.outputJSON as { note?: unknown }).note ?? '')
            : null;

    return {
        decisionId: String(linked?.decisionId ?? scored?.decisionId ?? ''),
        sessionId: linked?.sessionId ? String(linked.sessionId) : null,
        responseId: linked?.responseId ? String(linked.responseId) : null,
        modelId: scored?.modelId ? String(scored.modelId) : null,
        provider: scored?.provider ? String(scored.provider) : null,
        promptVersion: scored?.promptVersion ? String(scored.promptVersion) : null,
        inputHash: scored?.inputHash ? String(scored.inputHash) : null,
        scores: read.state === 'measured' ? read.scores : null,
        verification: (linked?.verification as VerificationOutcome | null) ?? null,
        decidedAt: scored?.decidedAt ? new Date(scored.decidedAt as any).toISOString() : null,
        note,
    };
}

/**
 * Every decision recorded for a session, oldest first.
 *
 * Read-only by construction: there is no counterpart to this that writes. Used by the
 * candidate-facing explanation and by the audit's exclusion counts.
 */
export async function sessionDecisions(sessionId: string): Promise<DecisionRecord[]> {
    const rows = (await supabaseDb.decisionLog.findMany({
        where: { sessionId },
        orderBy: { decidedAt: 'asc' },
    })) as StoredDecisionRow[];

    const records: DecisionRecord[] = [];
    for (const linked of rows) {
        const scored = (await supabaseDb.decisionLog.findFirst({
            where: { decisionId: linked.decisionId, phase: 'scored' },
        })) as StoredDecisionRow | null;
        records.push(fromStoredDecision(scored, linked));
    }
    return records;
}

/**
 * The verification outcome for each response in a set, keyed by response id.
 *
 * One query for the whole study rather than one per response: the audit reads this for
 * every answer it considers, and a per-response query would make an audit of a large study
 * quadratic.
 */
export async function verificationsForStudy(studyId: string): Promise<Map<string, VerificationOutcome>> {
    const rows = (await supabaseDb.decisionLog.findMany({
        where: { studyId, phase: 'linked' },
    })) as StoredDecisionRow[];

    const byResponse = new Map<string, VerificationOutcome>();
    for (const row of rows) {
        if (!row.responseId) continue;
        byResponse.set(String(row.responseId), (row.verification as VerificationOutcome) ?? 'unverified');
    }
    return byResponse;
}

export interface ScoringSystems {
    /** One entry per distinct provider + model, sorted. Empty when nothing is recorded. */
    systems: string[];
    promptVersions: string[];
    decisionCount: number;
}

/**
 * Which scoring systems actually produced the decisions in a study.
 *
 * Read from the log rather than from the study's configuration. The configuration is what
 * the study is set to *now*; the log is what scored each answer. A compliance report that
 * named the configured model could name a model that never saw the data — and would
 * silently change its own claim the next time someone edited the study.
 *
 * Only 'scored' rows are read. A 'linked' row carries whatever the linking route supplied
 * and, for an untraceable answer, may name no model at all; counting those would let an
 * unrecorded system appear as if it had been identified.
 */
export async function scoringSystemsForStudy(studyId: string): Promise<ScoringSystems> {
    const rows = (await supabaseDb.decisionLog.findMany({
        where: { studyId, phase: 'scored' },
    })) as StoredDecisionRow[];

    const systems = new Set<string>();
    const promptVersions = new Set<string>();

    for (const row of rows) {
        const provider = row.provider ? String(row.provider) : null;
        const model = row.modelId ? String(row.modelId) : null;
        // Named when either half is known; the other half is simply absent rather than
        // filled in with a guess. A row with neither is recorded as unidentified, which is
        // a true statement about the log and not a placeholder for a model name.
        systems.add([provider, model].filter(Boolean).join(' ') || 'an unidentified model');
        if (row.promptVersion) promptVersions.add(String(row.promptVersion));
    }

    return {
        systems: [...systems].sort(),
        promptVersions: [...promptVersions].sort(),
        decisionCount: rows.length,
    };
}
