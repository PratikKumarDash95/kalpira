"use client";

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  Layers3,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';

  const stats = [
    ['Adaptive flow', 'Follow-ups react to candidate depth'],
    ['Team review', 'Structured studies and scorecards'],
    ['Evidence first', 'Transcripts, summaries, and exports'],
  ];

  const features = [
    { title: 'Research studies', text: 'Create reusable interview studies with consent, profile fields, and participant links.', icon: Layers3 },
    { title: 'Interview practice', text: 'Run role-specific mock interviews with adaptive questions and focused feedback.', icon: BrainCircuit },
    { title: 'Hiring workspace', text: 'Give interviewers a dedicated portal for candidates, links, and result review.', icon: BriefcaseBusiness },
    { title: 'Readiness analytics', text: 'Track scores, weak skills, session history, and progress from one dashboard.', icon: BarChart3 },
  ];

  return (
    <main className="app-shell overflow-hidden">
      <div className="app-container min-h-screen py-5 sm:py-6 flex flex-col">
        <header className="surface rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
          <button onClick={() => router.push('/')} className="flex items-center gap-3 text-left">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 border border-teal-400/30">
              <Sparkles className="h-5 w-5 text-teal-300" />
            </span>
            <span>
              <span className="block text-sm font-bold text-white">Kalpira</span>
              <span className="block text-xs text-slate-400">AI interview operating system</span>
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-2 text-sm">
            <button onClick={() => router.push('/studies')} className="px-3 py-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">Studies</button>
            <button onClick={() => router.push('/interviewer/login')} className="px-3 py-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">Interviewer</button>
            <button onClick={() => { window.location.href = adminUrl; }} className="px-3 py-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-colors">Admin</button>
          </nav>

          <button onClick={() => router.push('/login')} className="btn-primary px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
            Sign in <ArrowRight size={16} />
          </button>
        </header>

        <section className="grid lg:grid-cols-[1.05fr_0.95fr] gap-6 lg:gap-8 items-center py-8 sm:py-12 flex-1">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-xs font-medium text-teal-200 mb-5">
              <ShieldCheck size={14} /> Built for research, practice, and hiring teams
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight text-white">
              One consistent workspace for better interviews.
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-8 text-slate-300 max-w-xl">
              Kalpira brings study setup, adaptive conversations, interviewer workflows, and readiness analytics into a single polished frontend.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button onClick={() => router.push('/login')} className="btn-primary px-5 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2">
                Start interviewing <ArrowRight size={17} />
              </button>
              <button onClick={() => router.push('/studies')} className="px-5 py-3 rounded-xl border border-slate-700 bg-slate-900/70 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors">
                View studies
              </button>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="surface rounded-2xl p-4 sm:p-5">
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-4">
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <p className="text-xs uppercase text-slate-500">Live session</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Product Designer Interview</h2>
                </div>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300 border border-emerald-400/20">Active</span>
              </div>
              <div className="grid grid-cols-3 gap-3 py-4">
                {[
                  ['86%', 'Readiness'],
                  ['12', 'Signals'],
                  ['34m', 'Duration'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-2xl font-bold text-white">{value}</p>
                    <p className="mt-1 text-xs text-slate-500">{label}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {stats.map(([title, text]) => (
                  <div key={title} className="flex items-start gap-3 rounded-xl bg-slate-900/60 p-3">
                    <CheckCircle2 size={17} className="mt-0.5 text-teal-300 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{title}</p>
                      <p className="text-xs text-slate-400">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        <section className="pb-8">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: index * 0.04 }}
                className="surface rounded-2xl p-5"
              >
                <feature.icon className="h-5 w-5 text-teal-300 mb-4" />
                <h3 className="text-sm font-semibold text-white">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{feature.text}</p>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
