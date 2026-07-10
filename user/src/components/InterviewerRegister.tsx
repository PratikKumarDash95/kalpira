'use client';
import { apiFetch, apiUrl } from '@/lib/apiClient';

import React, { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Briefcase, CheckCircle2 } from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';
import { validatePasswordPolicy, PASSWORD_RULE_MESSAGE } from '@/lib/passwordPolicy';

const InterviewerRegister: React.FC = () => {
    const router = useRouter();
    const pathname = usePathname();
    const isStandalonePortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer' || !pathname?.startsWith('/interviewer');
    const portalPath = (path: string) => isStandalonePortal ? path : `/interviewer${path}`;
    const [name, setName, clearNameDraft] = useSessionState('kalpira:interviewer-register:name', '');
    const [email, setEmail] = useSessionState('kalpira:interviewer-register:email', '');
    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmPasswordRef = useRef<HTMLInputElement>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        const password = passwordRef.current?.value ?? '';
        const confirmPassword = confirmPasswordRef.current?.value ?? '';

        if (!name.trim() || !email.trim() || !password) {
            setError('All fields are required.');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        const passwordError = validatePasswordPolicy(password);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        setIsLoading(true);
        try {
            const res = await apiFetch('/api/interviewer/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Registration failed.');
                return;
            }
            clearNameDraft();
            setSuccess(data.message || 'Check your email for a verification link before signing in.');
            if (passwordRef.current) passwordRef.current.value = '';
            if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendVerification = async () => {
        if (!email.trim()) {
            setError('Enter your email address first.');
            return;
        }

        setResending(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await apiFetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), role: 'interviewer' }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || 'Failed to resend verification email.');
                return;
            }
            setSuccess(data.alreadyVerified
                ? 'This email is already verified. You can sign in now.'
                : 'Verification email sent. Check your inbox.');
        } catch {
            setError('Failed to resend verification email.');
        } finally {
            setResending(false);
        }
    };

    const inputCls = "w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm";

    return (
        <div className="app-shell min-h-screen flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full max-w-md"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--brand-soft)] mx-auto mb-4">
                        <Briefcase size={26} className="text-brand-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-[color:var(--text)]">Create Interviewer Account</h1>
                    <p className="text-slate-400 text-sm mt-1">Set up interviews and track candidate performance</p>
                </div>

                <div className="surface p-8">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Name */}
                        <div className="relative">
                            <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type="text" value={name} onChange={e => setName(e.target.value)}
                                placeholder="Full name" className={inputCls} required />
                        </div>

                        {/* Email */}
                        <div className="relative">
                            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                autoComplete="email"
                                placeholder="Work email" className={inputCls} required />
                        </div>

                        {/* Password */}
                        <div className="relative">
                            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type={showPassword ? 'text' : 'password'} ref={passwordRef}
                                autoComplete="new-password"
                                placeholder="6-10 chars, A1#" className={`${inputCls} pr-10`} required
                                minLength={6}
                                maxLength={10}
                                pattern="(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,10}"
                                title={PASSWORD_RULE_MESSAGE} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        {/* Confirm Password */}
                        <div className="relative">
                            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type={showPassword ? 'text' : 'password'} ref={confirmPasswordRef}
                                autoComplete="new-password"
                                placeholder="Confirm password" className={inputCls} required
                                minLength={6}
                                maxLength={10}
                                pattern="(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,10}"
                                title={PASSWORD_RULE_MESSAGE} />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                                {error}
                            </div>
                        )}

                        {success && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-300 flex items-center gap-2">
                                <CheckCircle2 size={16} className="flex-shrink-0" />
                                {success}
                            </div>
                        )}

                        {/* Submit */}
                        <button type="submit" disabled={isLoading}
                            className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed">
                            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                            {isLoading ? 'Creating account...' : 'Create Account'}
                        </button>
                    </form>

                    <div className="mt-6 space-y-4 text-center">
                        <button
                            type="button"
                            onClick={handleResendVerification}
                            disabled={resending || isLoading || !email.trim()}
                            className="w-full py-3.5 border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium rounded-xl transition-colors"
                        >
                            {resending ? 'Sending verification...' : 'Resend verification email'}
                        </button>
                    <p className="text-sm text-slate-500">
                        Already have an account?{' '}
                        <button onClick={() => router.push(portalPath('/login'))} className="text-violet-400 hover:text-violet-300 transition-colors">
                            Sign in
                        </button>
                    </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default InterviewerRegister;
