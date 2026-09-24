'use client';

// ============================================
// ScoreProvenance.tsx — "how your score was decided" (Feature 4)
// ============================================
//
// The candidate's own view of the record behind their scores.
//
// WHAT THIS PAGE IS FOR
//
// A score about a person should not be a number that arrives from nowhere. For each answer
// this shows which model evaluated it, under which version of the prompt, when, and whether
// the score stored against the answer could be traced back to that evaluation. Every one of
// those is read from the append-only decision log, which nothing in the product can update
// or delete.
//
// This is the design rationale the roadmap cites GDPR Article 22 for, and the citation is
// made carefully: Kalpira SCORES but does not DECIDE. No hiring decision is made here, a
// human makes it, and this page says so rather than leaving a candidate to assume an
// algorithm decided their application.
//
// THE TWO STATES THAT MUST STAY APART
//
// An answer the model scored, and an answer nothing scored, are different facts, and the
// difference is the whole reason the score columns became nullable. So:
//
//   · "Scored by <model>" — the model's evaluation was recorded and the stored score matches it.
//   · "Recorded, but could not be traced" — a score exists on the answer, and no model
//     decision could be matched to it. It is kept and labelled, not silently dropped.
//   · "Not scored" — the model returned no evaluation for this answer. Nothing was measured.
//     This is NOT a zero.
//
// AND THE THING IT MUST NOT DO
//
// It must not reassure. It says a human can be asked to look, and it does not promise an
// outcome, a timeline, or that asking will change anything. The one guarantee it makes —
// that asking changes nothing about the score — is a statement about what the system does,
// which the server asserts.

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiClient';
import { motion } from 'framer-motion';
import {
    AlertTriangle, Check, Clock, FileSearch, HelpCircle, Loader2, Send, ShieldCheck, X,
} from 'lucide-react';

interface DecisionRecord {
    decisionId: string;
    sessionId: string | null;
    responseId: string | null;
    modelId: string | null;
    provider: string | null;
    promptVersion: string | null;
    inputHash: string | null;
    scores: Record<string, number> | null;
    verification: 'match' | 'mismatch' | 'no_scores' | 'unverified' | null;
    decidedAt: string | null;
    note: string | null;
}

interface ReviewRequest {
    id: string;
    status: string;
    reason: string | null;
    requestedAt: string | null;
    assignedTo: string | null;
    resolvedAt: string | null;
    resolutionNote: string | null;
}

const DIMENSIONS = ['technical', 'communication', 'confidence', 'logic', 'depth'] as const;
const DIMENSION_LABEL: Record<string, string> = {
    technical: 'Technical',
    communication: 'Communication',
    confidence: 'Confidence',
    logic: 'Logic',
    depth: 'Depth',
};

const REVIEW_STATUS: Record<string, string> = {
    open: 'Waiting for a reviewer',
    in_review: 'With a reviewer',
    resolved: 'Answered',
    declined: 'Answered — no change made',
};

/** One answer's provenance, joined to the question it was about. */
interface Row {
    key: string;
    question: string | null;
    decision: DecisionRecord | null;
}

export default function ScoreProvenance({
    sessionId, qaItems,
}: {
    sessionId: string;
    qaItems: { responseId?: string | null; question: string }[];
}) {
    const [decisions, setDecisions] = useState<DecisionRecord[] | null>(null);
    const [review, setReview] = useState<ReviewRequest | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [scoresUnchanged, setScoresUnchanged] = useState(false);

    const load = async () => {
        try {
            const res = await apiFetch(`/api/decisions/${encodeURIComponent(sessionId)}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error || 'This record could not be read.');
                return;
            }
            const data = await res.json();
            setDecisions(data.decisions ?? []);
            setReview(data.reviewRequest ?? null);
            // The guarantee is taken from the server's own assertion rather than written into
            // the page. A promise about what the system did is worth exactly as much as the
            // thing that did it saying so.
            setScoresUnchanged(Boolean(data.scoresUnchangedByRequest));
            setError(null);
        } catch {
            setError('Network error. Please try again.');
        }
    };

    useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId]);

    const submit = async () => {
        setSending(true);
        setSendError(null);
        try {
            const res = await apiFetch(`/api/decisions/${encodeURIComponent(sessionId)}/review`, {
                method: 'POST',
                body: JSON.stringify({ reason: reason.trim() || null }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setSendError(data.error || 'Your request could not be sent.');
                return;
            }
            setScoresUnchanged(Boolean(data.scoresUnchanged));
            setReason('');
            // Re-read rather than assuming the shape of what was written: the server is the
            // only thing that knows whether this created a request or matched one already
            // there.
            await load();
        } catch {
            setSendError('Network error. Your request was not sent.');
        } finally {
            setSending(false);
        }
    };

    // Join each question to the decision that scored the answer it produced. A decision whose
    // answer is not in this session's questions is still listed, with no question text —
    // dropping it would hide a decision that exists from the person it was made about.
    const rows: Row[] = [];
    const claimed = new Set<string>();
    qaItems.forEach((item, index) => {
        const match = (decisions ?? []).find((decision) => decision.responseId && decision.responseId === item.responseId) ?? null;
        if (match) claimed.add(match.decisionId);
        // Indexed, because two questions can be asked with identical text and an answer with
        // no id yet — a duplicate React key would then collapse two answers into one card.
        rows.push({ key: `q${index}`, question: item.question, decision: match });
    });
    for (const decision of decisions ?? []) {
        if (!claimed.has(decision.decisionId)) {
            rows.push({ key: decision.decisionId, question: null, decision });
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-6"
        >
            {/* ── What this page is ───────────────────────────────────────── */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
                    <FileSearch size={16} className="text-brand-700" /> How your score was decided
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                    Every answer that was scored was evaluated by an AI model at a particular moment,
                    and that evaluation is recorded before anything else happens. Below is that record:
                    which model, which version of the interviewer&rsquo;s instructions it ran under, and
                    when. Nothing here can be edited or deleted afterwards — not by you, and not by us.
                </p>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                    <span className="text-slate-300 font-medium">Kalpira scores. It does not decide.</span>{' '}
                    No hiring decision is made on this page or anywhere in this product. A person makes
                    that decision, and you can ask a person to review how your score was reached — see
                    the bottom of this page.
                </p>
            </div>

            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3">
                    <AlertTriangle size={18} className="text-red-400" />
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            {decisions === null && !error && (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 size={16} className="animate-spin" /> Reading the record…
                </p>
            )}

            {/* ── Nothing recorded ────────────────────────────────────────── */}
            {decisions !== null && decisions.length === 0 && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                    <p className="text-sm text-slate-300">
                        No scoring decision was recorded for this interview.
                    </p>
                    <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                        That means none of your answers were evaluated, so no score exists for any of
                        them. It does not mean you scored zero — an interview nobody scored and an
                        interview scored at zero are different things, and this is the first one.
                    </p>
                </div>
            )}

            {/* ── The record ──────────────────────────────────────────────── */}
            {rows.map((row) => (
                <DecisionCard key={row.key} row={row} />
            ))}

            {/* ── Asking a person to look ─────────────────────────────────── */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-brand-700" /> Ask a person to review this
                </h3>

                {review ? (
                    <ReviewState review={review} scoresUnchanged={scoresUnchanged} />
                ) : (
                    <>
                        <p className="text-sm text-slate-400 leading-relaxed">
                            If you think a score is wrong, you can ask for a human to look at it. Your
                            request is recorded and appears in a reviewer&rsquo;s queue. You can say why,
                            or ask without giving a reason — the reason is optional.
                        </p>
                        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                            <span className="text-slate-300 font-medium">
                                Asking changes nothing about your score.
                            </span>{' '}
                            Your scores stay exactly as they are while the request is open. Nothing is
                            automatically changed, in either direction, by asking or by not asking.
                        </p>

                        <label className="mt-4 block">
                            <span className="mb-1.5 block text-xs text-slate-400">
                                Anything you want the reviewer to know (optional)
                            </span>
                            <textarea
                                value={reason}
                                onChange={(event) => setReason(event.target.value.slice(0, 2000))}
                                rows={3}
                                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
                                placeholder="For example: the second question scored me low, but I think my answer covered it."
                            />
                            <span className="mt-1 block text-[11px] text-slate-600">
                                {reason.length}/2000 characters
                            </span>
                        </label>

                        {sendError && (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                                <X size={13} /> {sendError}
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={submit}
                            disabled={sending}
                            className="mt-3 flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
                        >
                            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            {sending ? 'Sending…' : 'Request a human review'}
                        </button>
                    </>
                )}
            </div>
        </motion.div>
    );
}

// ─── One answer's record ────────────────────────────────────────────────────

function DecisionCard({ row }: { row: Row }) {
    const decision = row.decision;

    // Three outcomes, and the wording for each is different on purpose. Collapsing any two
    // of them would tell the candidate something untrue about their own interview.
    const state: 'verified' | 'untraceable' | 'not_scored' | 'absent' = !decision
        ? 'absent'
        : decision.verification === 'match'
            ? 'verified'
            // `== null`, not `=== null`: a row missing the column entirely has to land in the
            // same place as an explicit null. Reading it as "untraceable" would print scores
            // for a decision that returned none.
            : decision.scores == null
                ? 'not_scored'
                : 'untraceable';

    return (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            {row.question && (
                <p className="text-sm font-medium text-slate-200 mb-3">{row.question}</p>
            )}

            {state === 'absent' && (
                <>
                    <p className="flex items-center gap-2 text-sm text-slate-400">
                        <HelpCircle size={14} className="text-slate-500" /> No record of a scoring
                        decision for this answer.
                    </p>
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                        Either the answer was never sent for evaluation, or the record of the evaluation
                        could not be read. Either way no score was recorded against it, which is not the
                        same as a score of zero.
                    </p>
                </>
            )}

            {state === 'not_scored' && (
                <>
                    <p className="flex items-center gap-2 text-sm text-slate-400">
                        <HelpCircle size={14} className="text-slate-500" /> The model returned no score
                        for this answer.
                    </p>
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                        This is recorded as <span className="text-slate-400">not measured</span>. It is not
                        a zero: the model was asked and produced no evaluation, so there is nothing to
                        report.
                    </p>
                    {decision && <Provenance decision={decision} />}
                </>
            )}

            {state === 'untraceable' && (
                <>
                    <p className="flex items-center gap-2 text-sm text-amber-300">
                        <AlertTriangle size={14} /> A score is stored for this answer, but it could not be
                        traced to a recorded evaluation.
                    </p>
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                        The score is kept and shown to you, labelled as unverified, rather than hidden.
                        It is excluded from the fairness analysis, because a score nobody can trace to a
                        model decision cannot be treated as a measurement.
                    </p>
                    {decision?.scores && <ScoreGrid scores={decision.scores} />}
                    {decision && <Provenance decision={decision} />}
                </>
            )}

            {state === 'verified' && (
                <>
                    <p className="flex items-center gap-2 text-sm text-emerald-400">
                        <Check size={14} /> Scored, and traced back to the evaluation that produced it.
                    </p>
                    {decision?.scores && <ScoreGrid scores={decision.scores} />}
                    {decision && <Provenance decision={decision} />}
                </>
            )}
        </div>
    );
}

function ScoreGrid({ scores }: { scores: Record<string, number> }) {
    return (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DIMENSIONS.map((dimension) => (
                <div key={dimension} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-[11px] text-slate-500">{DIMENSION_LABEL[dimension]}</p>
                    <p className="text-lg font-semibold text-slate-200 tabular-nums">
                        {typeof scores[dimension] === 'number' ? Math.round(scores[dimension]) : '—'}
                    </p>
                </div>
            ))}
        </div>
    );
}

/** The provenance lines: model, prompt version, when, and the input fingerprint. */
function Provenance({ decision }: { decision: DecisionRecord }) {
    const model = [decision.provider, decision.modelId].filter(Boolean).join(' ');

    return (
        <dl className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs">
            <Line label="Evaluated by" value={model || 'a model that was not recorded'} />
            <Line
                label="Interviewer version"
                // Named rather than hidden: when the instructions change, past scores must not
                // be silently re-read as though the new ones had produced them.
                value={decision.promptVersion || 'not recorded'}
            />
            <Line
                label="Evaluated at"
                value={decision.decidedAt ? new Date(decision.decidedAt).toLocaleString() : 'not recorded'}
                icon={<Clock size={11} />}
            />
            <Line
                label="Answer fingerprint"
                // The hash of the exact messages sent, so the evaluation can be tied to a
                // specific set of inputs without this page reproducing your transcript.
                value={decision.inputHash ? `${decision.inputHash.slice(0, 16)}…` : 'not recorded'}
                mono
            />
        </dl>
    );
}

function Line({
    label, value, icon, mono,
}: {
    label: string; value: string; icon?: React.ReactNode; mono?: boolean;
}) {
    return (
        <div className="flex items-start gap-2">
            <dt className="w-40 shrink-0 text-slate-500">{label}</dt>
            <dd className={`min-w-0 break-all text-slate-400 ${mono ? 'font-mono' : ''}`}>
                {icon && <span className="mr-1 inline-flex align-middle">{icon}</span>}
                {value}
            </dd>
        </div>
    );
}

function ReviewState({ review, scoresUnchanged }: { review: ReviewRequest; scoresUnchanged: boolean }) {
    return (
        <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-slate-300">
                <Check size={14} className="text-emerald-400" />
                You asked for a human review on{' '}
                {review.requestedAt ? new Date(review.requestedAt).toLocaleDateString() : 'an earlier date'}.
            </p>
            <p className="text-sm text-slate-400">
                {REVIEW_STATUS[review.status] ?? review.status}
                {review.assignedTo ? ' — someone has picked it up.' : ''}
            </p>
            {review.reason && (
                <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                    <span className="text-slate-500">What you told us: </span>
                    {review.reason}
                </p>
            )}
            {review.resolutionNote && (
                <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
                    <span className="text-slate-500">The reviewer said: </span>
                    {review.resolutionNote}
                </p>
            )}
            {/* Printed only when the server asserted it, rather than as a fixed reassurance.
                If the guarantee ever stops holding, this line disappears instead of lying. */}
            {scoresUnchanged && (
                <p className="text-xs text-slate-500">
                    Your scores were not changed by this request.
                </p>
            )}
        </div>
    );
}
