'use client';
import { apiFetch } from '@/lib/apiClient';

import React, { useState } from 'react';
import { Star, Loader2, CheckCircle, MessageSquarePlus } from 'lucide-react';

interface Props {
  sessionId: string;
  interviewerName?: string;
}

// Inline candidate → interviewer feedback for a completed interview.
// Posts to /api/candidate/sessions/[id]/feedback.
const InterviewFeedbackWidget: React.FC<Props> = ({ sessionId, interviewerName }) => {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating < 1) {
      setError('Please pick a rating.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/candidate/sessions/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not submit feedback.');
        return;
      }
      setDone(true);
    } catch {
      setError('Network error while submitting feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-300">
        <CheckCircle size={14} /> Thanks for your feedback!
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-medium transition-colors"
      >
        <MessageSquarePlus size={14} /> Rate interviewer
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 space-y-2">
      <p className="text-xs text-slate-400">
        Rate your experience{interviewerName ? ` with ${interviewerName}` : ''}
      </p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className="p-0.5"
          >
            <Star
              size={20}
              className={(hover || rating) >= n ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment…"
        rows={2}
        maxLength={2000}
        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
          Submit
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default InterviewFeedbackWidget;
