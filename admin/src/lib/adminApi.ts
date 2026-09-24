import { apiFetch, apiUrl } from '@/lib/apiClient';

// ─── Shared types ──────────────────────────────────────────────────────────
export type Role = 'candidate' | 'interviewer' | 'admin';

export interface Stats {
    totalUsers: number;
    totalCandidates: number;
    totalInterviewers: number;
    totalAdmins: number;
    totalStudies: number;
    activeStudies: number;
    totalSessions: number;
    activeInterviews: number;
    recentUsers: { id: string; name: string | null; email: string | null; role: Role; createdAt: string }[];
}

export interface AdminUser {
    id: string;
    name: string | null;
    email: string | null;
    role: Role;
    oauthProvider: string | null;
    onboardingComplete: boolean;
    createdAt: string;
    _count: { interviewSessions: number; studies: number };
}

export interface Interviewer {
    id: string;
    name: string | null;
    email: string | null;
    oauthProvider: string | null;
    createdAt: string;
    studiesCreated: number;
    activeStudies: number;
    totalInterviews: number;
    activeInterviews: number;
}

export interface AdminStudy {
    id: string;
    name: string;
    roleTitle: string;
    interviewCount: number;
    totalSessions: number;
    activeSessions: number;
    isLocked: boolean;
    createdAt: string;
    owner: { id: string; name: string | null; email: string | null; role: Role } | null;
}

export interface AdminSession {
    id: string;
    startedAt: string;
    completedAt: string | null;
    averageScore: number;
    role: string;
    difficulty?: string;
    mode?: string;
    candidateName: string | null;
    candidateEmail: string | null;
    user: { name: string | null; email: string | null } | null;
}

export interface FeedbackItem {
    id: string;
    sessionId: string | null;
    studyId: string | null;
    rating: number;
    comment: string | null;
    createdAt: string;
    candidateName: string | null;
    candidateEmail: string | null;
    interviewer: { id: string; name: string | null; email: string | null } | null;
}

export interface UserDetail {
    user: AdminUser & { emailVerifiedAt: string | null; avatarUrl: string | null };
    sessions: { id: string; role: string; startedAt: string; completedAt: string | null; averageScore: number; mode: string }[];
    studies: { id: string; name: string; interviewCount: number; isLocked: boolean; createdAt: string }[];
    badges: { id: string; badgeName: string; awardedAt: string }[];
    readinessScore: number | null;
}

// ─── Competency measurement (Feature 1) ────────────────────────────────────
// The calibrated item bank. `concerns` is the important field: an item with an
// empty list is one the engine can measure with, and anything else says why not.
export interface ItemParameterRow {
    itemKey: string;
    label: string;
    sampleText: string;
    competencyId: string | null;
    category: string | null;
    a: number | null;
    b: number | null;
    c: number | null;
    sampleSize: number;
    proportionCorrect: number | null;
    isRetired: boolean;
    retiredReason: string | null;
    calibratedAt: string | null;
    concerns: string[];
    usable: boolean;
}

export interface ItemBankTotals {
    items: number;
    live: number;
    retired: number;
    /** Live items whose sample is still small enough that a re-fit could move them. */
    thinSamples: number;
    withConcerns: number;
}

export interface ItemBankThresholds {
    minSampleSize: number;
    thinSample: number;
    minDiscrimination: number;
    retirementDiscrimination: number;
    maxGuessing: number;
}

export interface ItemBank {
    items: ItemParameterRow[];
    totals: ItemBankTotals;
    thresholds: ItemBankThresholds;
    returned: number;
    truncated: boolean;
}

export interface CalibrationSummary {
    itemsConsidered: number;
    itemsCalibrated: number;
    itemsSkipped: number;
    itemsNewlyRetired: number;
    itemsUnretired: number;
    unattributableResponses: number;
    threshold: number;
    minSampleSize: number;
}

export interface CalibrationResult {
    success: boolean;
    summary: CalibrationSummary;
    minimumSampleSize: number;
    note?: string;
}

// ─── Delivery analysis (Feature 2) ─────────────────────────────────────────
// The operational half of multimodal delivery analysis.
//
// The distinction these types exist to preserve: a FAILED job is an operational
// fault — the analysis could not run at all — while a muted microphone is a
// SUCCESSFUL analysis that measured nothing, and appears in neither of these lists.
// An operator who conflates them will go looking for a bug that is not there, and
// miss a recording condition that is working exactly as designed.
export interface DeliveryJobFailure {
    id: string;
    responseId: string | null;
    sessionId: string | null;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    createdAt: string | null;
    /** Whether a retry could still help: attempts remain and the payload is intact. */
    retryable: boolean;
}

export interface DeliveryJobHealth {
    /** Jobs per status — queued, running, succeeded, failed. */
    counts: Record<string, number>;
    failed: DeliveryJobFailure[];
    returned: number;
    maxAttempts: number;
}

export interface DeliveryRetryOutcome {
    jobId: string;
    status: string;
    error: string | null;
    skippedReason: string | null;
}

export interface DeliveryRetryResult {
    success: boolean;
    attempted: number;
    succeeded: number;
    failed: number;
    outcomes: DeliveryRetryOutcome[];
}

// ─── Fairness, bias & compliance audit (Feature 4) ──────────────────────────
// Mirror the backend's stored shapes. `selectionRate` and its siblings are nullable
// because a cohort below the floor produces NO rate rather than a caveated one — see the
// section header comment in FairnessView for why that is the whole point of the feature.

export interface FairnessCohortMetric {
    id: string;
    cohortKey: string;
    cohortValue: string;
    n: number;
    scoredN: number;
    selectedCount: number;
    selectionRate: number | null;
    referenceRate: number | null;
    meanScore: number | null;
    stdDev: number | null;
    adverseImpactRatio: number | null;
    zStatistic: number | null;
    pValue: number | null;
    chiSquare: number | null;
    effectSize: number | null;
    /** When false, every figure above is null and `notComputableReason` explains why. */
    computable: boolean;
    notComputableReason: string | null;
}

export interface FairnessFlag {
    id: string;
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
    /** Required non-empty by the database. A flag that cannot state its own innocent
     * explanation is never emitted, because it would be an accusation without one. */
    whatItCannotSay: string;
    recommendation: string | null;
}

export interface FairnessRun {
    id: string;
    studyId: string | null;
    scope: string | null;
    status: string;
    selectionThreshold: number | null;
    referenceCohortKey: string | null;
    referenceCohortValue: string | null;
    sampleSize: number;
    includedSessions: number;
    registryVersion: number;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    /** Parsed from the run's `summaryJSON`. Null when the column was unreadable. */
    summary: FairnessAuditSummary | null;
    caveats: string[];
    exclusions: FairnessExclusionGroup[];
    /** Snapshot of what the study had declared when the run was made. */
    declaration: { cohortKeys?: { key: string; label: string; values: string[] }[] } | null;
}

export interface FairnessExclusionGroup {
    reason: string;
    count: number;
}

/** The stored summary of what a run considered, as `AuditRun.summaryJSON`. */
export interface FairnessAuditSummary {
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

export interface FairnessAuditResult {
    ok: boolean;
    runId: string | null;
    /** `not_computable` is not `failed`: the run completed and there was nothing to
     * compute. The two are rendered differently on purpose. */
    status: 'succeeded' | 'not_computable' | 'failed';
    reason: string | null;
    caveats: string[];
    summary: FairnessAuditSummary | null;
    detail: { run: FairnessRun; metrics: FairnessCohortMetric[]; flags: FairnessFlag[] } | null;
}

/** One section of the compliance report: a cohort key and its rows. */
export interface ReportCohortRow {
    cohortValue: string;
    label: string;
    n: number;
    scoredN: number;
    selectedCount: number;
    selectionRate: string;
    referenceRate: string;
    adverseImpactRatio: string;
    zStatistic: string;
    pValue: string;
    chiSquare: string;
    effectSize: string;
    notComputableReason: string | null;
    isReference: boolean;
}

export interface ReportCohortSection {
    cohortKey: string;
    cohortLabel: string;
    referenceReason: string;
    referenceValue: string | null;
    rows: ReportCohortRow[];
}

export interface ComplianceReport {
    title: string;
    subtitle: string;
    generatedAt: string;
    studyName: string;
    systemDescription: string | null;
    registryVersion: number;
    status: string;
    error: string | null;
    selectionThreshold: number | null;
    sampleSize: number;
    includedSessions: number;
    sections: ReportCohortSection[];
    flags: {
        severity: string;
        targetType: string;
        label: string | null;
        cohortValue: string | null;
        finding: string;
        whatItCannotSay: string;
        recommendation: string | null;
        statistic: string;
        threshold: string;
        pValue: string;
        computable: boolean;
        notComputableReason: string | null;
    }[];
    exclusions: FairnessExclusionGroup[];
    caveats: string[];
    /** Each carries its own `doesNotClaim`, so the report can never cite a statute
     * without also stating what it is not claiming under it. */
    citations: { id: string; instrument: string; clause: string; usedFor: string; doesNotClaim: string }[];
    disclaimers: string[];
    fourFifthsExplanation: string;
    methodology: string[];
}

export interface FairnessSummary {
    studyId: string;
    declaration: {
        cohortKeys: { key: string; label: string; values: string[] }[];
        selectionThreshold: number | null;
        referenceCohort: { key: string; value: string } | null;
    };
    declarationIssues: string[];
    undeclared: boolean;
    cohortKeys: { key: string; label: string; values: string[] }[];
    selectionThreshold: number | null;
    taggedSessions: number;
    assignmentCount: number;
    run: {
        id: string;
        status: string;
        startedAt: string | null;
        finishedAt: string | null;
        error: string | null;
        sampleSize: number;
        includedSessions: number;
        registryVersion: number;
        caveats: string[];
        exclusions: FairnessExclusionGroup[];
    } | null;
    flagCounts: { high: number; medium: number; low: number; info: number };
    /** False for a study owner: the run route is admin-gated. */
    canRunAudit: boolean;
}

// ─── API helpers ────────────────────────────────────────────────────────────
// Every call throws with a readable message on failure so the UI can surface it
// instead of silently rendering zeros.
async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
}

export const AdminApi = {
    stats: () => apiFetch('/api/admin/stats').then(json<Stats>),

    users: (role?: Role) =>
        apiFetch(`/api/admin/users${role ? `?role=${role}` : ''}`).then(json<{ users: AdminUser[] }>),

    userDetail: (id: string) => apiFetch(`/api/admin/users/${id}`).then(json<UserDetail>),

    createUser: (body: { name: string; email: string; password: string; role: Role }) =>
        apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }).then(json<{ user: AdminUser }>),

    updateUser: (body: { userId: string; name?: string; email?: string; role?: Role }) =>
        apiFetch('/api/admin/users', { method: 'PATCH', body: JSON.stringify(body) }).then(json<{ user: AdminUser }>),

    deleteUser: (userId: string) =>
        apiFetch('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ userId }) }).then(json<{ success: boolean }>),

    interviewers: () => apiFetch('/api/admin/interviewers').then(json<{ interviewers: Interviewer[] }>),

    studies: () => apiFetch('/api/admin/studies').then(json<{ studies: AdminStudy[] }>),

    deleteStudy: (studyId: string) =>
        apiFetch('/api/admin/studies', { method: 'DELETE', body: JSON.stringify({ studyId }) }).then(json<{ success: boolean }>),

    sessions: () => apiFetch('/api/admin/sessions').then(json<{ sessions: AdminSession[] }>),

    deleteSession: (sessionId: string) =>
        apiFetch('/api/admin/sessions', { method: 'DELETE', body: JSON.stringify({ sessionId }) }).then(json<{ success: boolean }>),

    feedback: () => apiFetch('/api/admin/feedback').then(json<{ feedback: FeedbackItem[]; count: number; averageRating: number }>),

    // ─── Competency measurement (Feature 1) ─────────────────────────────────
    itemBank: () => apiFetch('/api/measurement/items').then(json<ItemBank>),

    /** Re-fits item parameters from response history. Admin-only, and slow. */
    calibrate: (body: { minSampleSize?: number } = {}) =>
        apiFetch('/api/measurement/calibrate', { method: 'POST', body: JSON.stringify(body) }).then(
            json<CalibrationResult>
        ),

    // ─── Delivery analysis (Feature 2) ──────────────────────────────────────
    deliveryJobs: (limit = 50) =>
        apiFetch(`/api/delivery/jobs?limit=${limit}`).then(json<DeliveryJobHealth>),

    /** Re-runs the failed analyses that still have attempts and a payload left. */
    retryDeliveryJobs: (body: { limit?: number } = {}) =>
        apiFetch('/api/delivery/jobs', { method: 'POST', body: JSON.stringify(body) }).then(
            json<DeliveryRetryResult>
        ),

    // ─── Fairness audit (Feature 4) ─────────────────────────────────────────
    /** A study's audit history, newest first. */
    fairnessRuns: (studyId: string) =>
        apiFetch(`/api/fairness/audit?studyId=${encodeURIComponent(studyId)}`).then(
            json<{ studyId: string; runs: FairnessRun[] }>
        ),

    /** Runs one audit and returns the stored result. Slow: it reads every session in the
     * study and every scored answer in it. */
    runFairnessAudit: (studyId: string) =>
        apiFetch('/api/fairness/audit', { method: 'POST', body: JSON.stringify({ studyId }) }).then(
            json<FairnessAuditResult>
        ),

    /** One run, with its metrics, its flags and its assembled compliance report. */
    fairnessAudit: (runId: string) =>
        apiFetch(`/api/fairness/audit/${encodeURIComponent(runId)}`).then(
            json<{
                run: FairnessRun;
                metrics: FairnessCohortMetric[];
                flags: FairnessFlag[];
                report: ComplianceReport | null;
            }>
        ),

    /**
     * The URL of a run's PDF report.
     *
     * Returned as a link rather than fetched, because the response is a document the browser
     * should download or display with its own PDF viewer. Fetching it into JS would mean
     * holding a compliance document in memory to hand it straight back to the browser.
     */
    fairnessReportUrl: (runId: string) => apiUrl(`/api/fairness/audit/${encodeURIComponent(runId)}/report`),

    /** The URL of a run's metrics CSV, for the same reason. */
    fairnessCsvUrl: (runId: string) => apiUrl(`/api/fairness/audit/${encodeURIComponent(runId)}/metrics.csv`),

    /** A study's cohort declaration, its tags, and its latest run. */
    fairnessSummary: (studyId: string) =>
        apiFetch(`/api/fairness/summary?studyId=${encodeURIComponent(studyId)}`).then(
            json<FairnessSummary>
        ),

    // ─── Human review (Feature 4) ───────────────────────────────────────────
    /** The provenance behind one session's scores, plus any live review request. */
    sessionDecisions: (sessionId: string) =>
        apiFetch(`/api/decisions/${encodeURIComponent(sessionId)}`).then(
            json<{ sessionId: string; decisions: unknown[]; reviewRequest: unknown | null }>
        ),

    /** Files a human-review request. Changes nothing about the candidate's scores. */
    requestReview: (sessionId: string, body: { reason?: string | null; responseId?: string | null } = {}) =>
        apiFetch(`/api/decisions/${encodeURIComponent(sessionId)}/review`, {
            method: 'POST',
            body: JSON.stringify(body),
        }).then(json<{ success: boolean; alreadyRequested: boolean; scoresUnchanged: boolean }>),
};
