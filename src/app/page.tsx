"use client";

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function Home() {
  const router = useRouter();

  const features = [
    {
      title: 'Adaptive Interview Simulation',
      description:
        'AI-driven interviews that react in real time to candidate answers, depth, and confidence.',
      icon: '🎛️',
    },
    {
      title: 'Question Intelligence Engine',
      description:
        'Generate role-specific questions and follow-ups from your JD, company values, and seniority.',
      icon: '🎯',
    },
    {
      title: 'Live Performance Analytics',
      description:
        'Track structure, clarity, and problem-solving signals with visual scoring overlays.',
      icon: '📊',
    },
    {
      title: 'Multi-Modal Recording',
      description:
        'Capture voice, screen, and code in a single streamlined session for later review.',
      icon: '🎥',
    },
    {
      title: 'Candidate Readiness Radar',
      description:
        'Surface strengths, risks, and readiness scores with explainable AI summaries.',
      icon: '🧭',
    },
    {
      title: 'Collaborative Scorecards',
      description:
        'Standardise hiring decisions with structured scorecards and async feedback.',
      icon: '👥',
    },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Background grid + glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-950" />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
        <div className="absolute -top-40 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="absolute bottom-[-6rem] right-[-4rem] h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 min-h-screen flex flex-col">
        {/* Nav */}
        <header className="flex items-center justify-between gap-6 mb-16">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Kalpira</p>
              <p className="text-base font-semibold tracking-[0.4em] text-slate-50">PLATFORM</p>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-8 text-sm text-slate-300">
            <button
              onClick={() => {
                const el = document.getElementById('features');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-white/90 transition-colors"
            >
              Features
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('footer');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-white/90 transition-colors"
            >
              About
            </button>
            <button
              onClick={() => (window.location.href = 'http://localhost:3000/login')}
              className="inline-flex items-center rounded-full border border-violet-500/70 bg-violet-600/20 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-violet-100 hover:bg-violet-500/30 hover:border-violet-400 transition-colors"
            >
              Let&apos;s Interview
            </button>
          </nav>

          <button
            onClick={() => (window.location.href = 'http://localhost:3000/login')}
            className="sm:hidden text-[0.65rem] font-semibold tracking-[0.22em] uppercase text-violet-200 border border-violet-500/60 rounded-full px-3 py-1.5 hover:bg-violet-600/20"
          >
            Let&apos;s Interview
          </button>
        </header>

        {/* Hero */}
        <section className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-12 items-center flex-1 mb-16">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-[0.7rem] sm:text-xs font-medium tracking-[0.35em] text-slate-400 uppercase mb-6"
            >
              AI-POWERED INTERVIEW PLATFORM
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-[0.6em] text-center lg:text-left"
            >
              <span className="block text-slate-100">KALPIRA</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-6 max-w-xl text-sm sm:text-base text-slate-300/80 text-center lg:text-left tracking-[0.25em] uppercase"
            >
              Innovation awaits
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <button
                onClick={() => (window.location.href = 'http://localhost:3000/login')}
                className="relative inline-flex items-center gap-3 rounded-full px-8 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-400 hover:to-indigo-400 shadow-lg shadow-violet-900/40 transition-all group"
              >
                <span className="text-[0.68rem] tracking-[0.25em] uppercase">Let&apos;s Interview</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                <span className="pointer-events-none absolute -inset-[1px] rounded-full border border-violet-300/40 opacity-50" />
              </button>

              <button
                onClick={() => router.push('/studies')}
                className="text-xs sm:text-sm text-slate-300 hover:text-white/90 underline-offset-4 hover:underline"
              >
                View existing studies
              </button>
            </motion.div>
          </div>

          {/* Glassy stats / preview card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 80, damping: 18 }}
            className="relative"
          >
            <div className="absolute -inset-0.5 rounded-3xl bg-gradient-to-br from-violet-500/40 via-sky-500/20 to-transparent opacity-70 blur-xl" />
            <div className="relative rounded-3xl border border-slate-700/80 bg-slate-900/60 px-6 py-5 sm:px-7 sm:py-6 backdrop-blur-xl shadow-[0_24px_80px_rgba(15,23,42,0.9)]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[0.65rem] uppercase tracking-[0.26em] text-slate-400">Next
                    Session</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">Senior Backend · System
                    Design</p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[0.7rem] font-medium text-emerald-300 border border-emerald-500/40">
                  Live AI
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-[0.68rem] text-slate-300">
                <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-3 py-3 flex flex-col gap-1">
                  <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500">Signal</span>
                  <span className="text-sm font-semibold text-slate-50">92%</span>
                  <span className="text-[0.65rem] text-emerald-300">Strong problem solving</span>
                </div>
                <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-3 py-3 flex flex-col gap-1">
                  <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500">Focus</span>
                  <span className="text-sm font-semibold text-slate-50">Backend</span>
                  <span className="text-[0.65rem] text-slate-400">APIs · scaling · queues</span>
                </div>
                <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 px-3 py-3 flex flex-col gap-1">
                  <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500">Time</span>
                  <span className="text-sm font-semibold text-slate-50">45m</span>
                  <span className="text-[0.65rem] text-slate-400">Auto-scheduled</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-4 text-[0.68rem] text-slate-400">
                <p>
                  Built for teams who care about <span className="text-slate-100">signal</span>, not
                  gut feel.
                </p>
                <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-[0.65rem] font-medium text-violet-200">
                  Async friendly
                </span>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Features */}
        <section id="features" className="mb-10 sm:mb-16">
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            <h2 className="text-sm sm:text-base font-semibold tracking-[0.25em] uppercase text-slate-300">
              PLATFORM CAPABILITIES
            </h2>
            <p className="hidden sm:block text-xs text-slate-500 max-w-xs text-right">
              Every interview is a tiny experiment. OpenInterviewer helps you run them with
              scientific precision.
            </p>
          </div>

          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: 0.05 * index, duration: 0.4 }}
                className="group relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/60 px-5 py-5 sm:px-6 sm:py-6 backdrop-blur-xl hover:border-violet-500/60 hover:bg-slate-900/70 transition-colors"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-violet-600/10 via-sky-500/5 to-transparent" />
                <div className="relative flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/80 border border-slate-700/70 text-base">
                    <span aria-hidden>{feature.icon}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100 mb-1.5">{feature.title}</h3>
                    <p className="text-[0.8rem] leading-relaxed text-slate-400">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer
          id="footer"
          className="mt-auto border-t border-slate-800/80 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[0.75rem] text-slate-500"
        >
          <p className="tracking-[0.18em] uppercase">Kalpira · Innovation Awaits</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                const el = document.getElementById('features');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="hover:text-slate-200 transition-colors"
            >
              Features
            </button>
            <span className="text-slate-600">·</span>
            <span>© {new Date().getFullYear()} Kalpira Labs</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
