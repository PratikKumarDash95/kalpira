"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Layers3,
  MessageSquare,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

interface HeaderProfile {
  role?: string;
}

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Create an interview',
    text: 'Set up a reusable study or practice interview with consent, profile fields, focus areas, and adaptive questions.',
    icon: Layers3,
  },
  {
    step: '2',
    title: 'Invite candidates',
    text: 'Share a single link or import a candidate list. Interviews run async, in the browser, on any device.',
    icon: MessageSquare,
  },
  {
    step: '3',
    title: 'Review & advance',
    text: 'Get transcripts, scores, and readiness signals in one workspace. Compare candidates and advance the best.',
    icon: BarChart3,
  },
];

const FEATURES = [
  { title: 'Research studies', text: 'Reusable interview studies with consent, profile fields, and participant links.', icon: Layers3 },
  { title: 'Interview practice', text: 'Role-specific mock interviews with adaptive questions and focused feedback.', icon: BrainCircuit },
  { title: 'Hiring workspace', text: 'A dedicated interviewer portal for candidates, links, and result review.', icon: BriefcaseBusiness },
  { title: 'Readiness analytics', text: 'Track scores, weak skills, session history, and progress from one dashboard.', icon: BarChart3 },
];

const WHY = [
  { title: 'Save screening time', text: 'Async interviews run without you in the room. Review only what matters, when it suits you.', icon: Zap },
  { title: 'Conversational AI', text: 'Follow-ups adapt to candidate depth — every interview feels tailored, not templated.', icon: BrainCircuit },
  { title: 'Evidence, everywhere', text: 'Transcripts, summaries, and exports on any device. Nothing gets lost between rounds.', icon: ShieldCheck },
];

const PRICING = [
  { name: 'Starter', price: '₹100', tagline: 'For small hiring rounds', features: ['2 interviews', 'Up to 15 candidates each', 'Transcripts & scores', 'Email support'], highlight: false },
  { name: 'Pro', price: '₹250', tagline: 'For growing teams', features: ['5 interviews', 'Up to 40 candidates each', 'Readiness analytics', 'Priority support'], highlight: true },
  { name: 'Max', price: '₹500', tagline: 'For high-volume hiring', features: ['10 interviews', 'Up to 60 candidates each', 'Advanced exports', 'Dedicated support'], highlight: false },
];

const FAQS = [
  { q: 'How long does an interview take to set up?', a: 'A few minutes. Pick a role or research question, choose focus areas and question count, and share the link — the adaptive flow handles the rest.' },
  { q: 'Do candidates need to install anything?', a: 'No. Interviews run entirely in the browser on any device, so candidates just open a link and start.' },
  { q: 'Is candidate data secure?', a: 'Consent is captured up front, transcripts are scoped to your studies, and exports are available whenever you need them.' },
  { q: 'Can I use this for both practice and hiring?', a: 'Yes. The same workspace powers self-practice, research studies, and interviewer-led hiring rounds.' },
];

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="surface-soft p-3">
      <p className="text-2xl font-bold text-[color:var(--text)]">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">{label}</p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-[color:var(--text)]">{q}</span>
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--brand-strong)]">
          {open ? <Minus size={14} /> : <Plus size={14} />}
        </span>
      </button>
      {open && <p className="px-5 pb-5 text-sm leading-6 text-[color:var(--muted)]">{a}</p>}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<HeaderProfile | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.profile) setProfile(data.profile);
      })
      .catch(() => {});
  }, []);

  const primaryCta = () => router.push(profile ? '/studies' : '/login');

  return (
    <div className="app-shell min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="app-container pt-14 pb-10 sm:pt-20 sm:pb-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="badge-brand badge mx-auto">
            <ShieldCheck size={14} /> Built for research, practice & hiring teams
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-[color:var(--text)] sm:text-6xl"
          >
            Conversational AI interviews,{' '}
            <span className="text-brand-500">one calm workspace.</span>
          </motion.h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[color:var(--muted)] sm:text-lg">
            Kalpira brings study setup, adaptive conversations, interviewer workflows, and readiness
            analytics into a single polished frontend — no extra tabs, no context switching.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button onClick={primaryCta} className="btn-primary px-6 py-3 text-sm">
              Start free <ArrowRight size={17} />
            </button>
            <button onClick={() => router.push('/studies')} className="btn-secondary px-6 py-3 text-sm">
              View studies
            </button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><Check size={14} className="text-brand-500" /> No credit card to start</span>
            <span className="inline-flex items-center gap-1.5"><Check size={14} className="text-brand-500" /> Runs in the browser</span>
            <span className="inline-flex items-center gap-1.5"><Check size={14} className="text-brand-500" /> GDPR-friendly</span>
          </div>
        </div>

        {/* Product mock card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="surface mx-auto mt-14 max-w-4xl p-4 shadow-card-lg sm:p-6"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[color:var(--line)] pb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">Live session</p>
              <h2 className="mt-1 text-lg font-semibold text-[color:var(--text)]">Product Designer Interview</h2>
            </div>
            <span className="badge inline-flex items-center gap-1.5 bg-[color:var(--success-soft)] text-[color:var(--success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" /> Active
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 py-5">
            <Stat value="86%" label="Readiness" />
            <Stat value="12" label="Signals" />
            <Stat value="34m" label="Duration" />
          </div>
          <div className="space-y-2">
            {[
              ['Adaptive flow', 'Follow-ups react to candidate depth'],
              ['Team review', 'Structured studies and scorecards'],
              ['Evidence first', 'Transcripts, summaries, and exports'],
            ].map(([title, text]) => (
              <div key={title} className="flex items-start gap-3 rounded-xl bg-[color:var(--surface-soft)] p-3">
                <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0 text-brand-500" />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--text)]">{title}</p>
                  <p className="text-xs text-[color:var(--muted)]">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="app-container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text)] sm:text-4xl">How it works</h2>
          <p className="mt-3 text-[color:var(--muted)]">Create an interview, invite candidates, review results — in three steps.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {HOW_IT_WORKS.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: i * 0.05 }}
              className="surface p-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
                  {s.step}
                </span>
                <s.icon size={18} className="text-brand-500" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-[color:var(--text)]">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="app-container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <div className="badge-brand badge mx-auto"><Sparkles size={13} /> Built for every team</div>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[color:var(--text)] sm:text-4xl">Everything in one frontend</h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ delay: i * 0.04 }}
              className="surface p-6"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
                <f.icon className="h-5 w-5 text-brand-500" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-[color:var(--text)]">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Why teams */}
      <section className="app-container py-16">
        <div className="surface bg-[color:var(--brand-softer)] p-8 sm:p-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text)] sm:text-4xl">Why teams choose Kalpira</h2>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {WHY.map((w) => (
              <div key={w.title} className="rounded-2xl bg-[color:var(--surface)] p-6 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
                  <w.icon className="h-5 w-5 text-brand-500" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-[color:var(--text)]">{w.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="app-container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text)] sm:text-4xl">Simple pricing, made for scale</h2>
          <p className="mt-3 text-[color:var(--muted)]">Start free. Upgrade when your hiring rounds grow.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PRICING.map((p) => (
            <div
              key={p.name}
              className={`surface flex flex-col p-6 ${p.highlight ? 'ring-2 ring-brand-500 shadow-card-lg' : ''}`}
            >
              {p.highlight && <span className="badge-brand badge mb-3 self-start">Most popular</span>}
              <h3 className="text-lg font-semibold text-[color:var(--text)]">{p.name}</h3>
              <p className="mt-1 text-sm text-[color:var(--muted)]">{p.tagline}</p>
              <p className="mt-4">
                <span className="text-4xl font-bold text-[color:var(--text)]">{p.price}</span>
                <span className="text-sm text-[color:var(--muted)]"> /round</span>
              </p>
              <ul className="mt-5 space-y-2.5">
                {p.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-[color:var(--text-soft)]">
                    <Check size={16} className="mt-0.5 flex-shrink-0 text-brand-500" /> {feat}
                  </li>
                ))}
              </ul>
              <button
                onClick={primaryCta}
                className={`mt-6 py-2.5 text-sm ${p.highlight ? 'btn-primary' : 'btn-secondary'}`}
              >
                Get started
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="app-container py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text)] sm:text-4xl">Frequently asked questions</h2>
        </div>
        <div className="mx-auto mt-10 max-w-2xl space-y-3">
          {FAQS.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="app-container pb-20">
        <div className="surface bg-brand-500 p-10 text-center sm:p-14">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Ready to transform your workflow?</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">
            Set up your first interview in minutes and see candidates come to life — no extra tabs.
          </p>
          <button
            onClick={primaryCta}
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-[color:var(--brand-strong)] transition-transform hover:-translate-y-0.5"
          >
            Get started free <ArrowRight size={17} />
          </button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
