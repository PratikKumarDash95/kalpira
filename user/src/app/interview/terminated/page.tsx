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
    <main className="min-h-screen bg-stone-950 px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center justify-center">
        <section className="w-full rounded-2xl border border-red-500/20 bg-stone-900/80 p-6 shadow-2xl shadow-black/30">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-300">
            <ShieldAlert size={28} />
          </div>

          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-300">
            <AlertTriangle size={14} />
            Interview Terminated
          </p>
          <h1 className="text-2xl font-bold text-white">This interview can no longer continue.</h1>

          <div className="mt-5 rounded-xl border border-stone-700 bg-stone-800/70 p-4">
            <p className="text-sm font-medium text-stone-300">Reason</p>
            <p className="mt-1 text-sm leading-6 text-stone-400">{reason}</p>
          </div>

          <p className="mt-5 text-sm leading-6 text-stone-500">
            The session has been locked to preserve interview integrity. If this was unexpected, contact the interviewer before attempting another interview.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={dashboardPath}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-800 px-4 py-3 text-sm font-semibold text-stone-200 transition-colors hover:bg-stone-700"
            >
              <ArrowLeft size={16} />
              Return to dashboard
            </a>
            <a
              href="/setup"
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25"
            >
              New interview
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
