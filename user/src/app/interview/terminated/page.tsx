import { AlertTriangle, ArrowLeft, ShieldAlert } from 'lucide-react';

interface TerminatedPageProps {
  searchParams?: {
    reason?: string;
  };
}

export default function InterviewTerminatedPage({ searchParams }: TerminatedPageProps) {
  const reason = searchParams?.reason?.trim() || 'Interview session has been terminated due to a proctoring policy violation.';
  const isInterviewerPortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer';
  const dashboardPath = isInterviewerPortal ? '/dashboard' : '/studies';

  return (
    <main className="app-shell min-h-screen px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center justify-center">
        <section className="surface w-full border-[color:var(--danger)]/20 p-6">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--danger-soft)] text-[color:var(--danger)]">
            <ShieldAlert size={28} />
          </div>

          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--danger)]">
            <AlertTriangle size={14} />
            Interview Terminated
          </p>
          <h1 className="text-2xl font-bold text-[color:var(--text)]">This interview can no longer continue.</h1>

          <div className="mt-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-4">
            <p className="text-sm font-medium text-[color:var(--text-soft)]">Reason</p>
            <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{reason}</p>
          </div>

          <p className="mt-5 text-sm leading-6 text-[color:var(--muted)]">
            The session has been locked to preserve interview integrity. If this was unexpected, contact the interviewer before attempting another interview.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={dashboardPath}
              className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm"
            >
              <ArrowLeft size={16} />
              Return to dashboard
            </a>
            <a
              href="/setup"
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-[color:var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[color:var(--danger)] transition-colors hover:brightness-95"
            >
              New interview
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
