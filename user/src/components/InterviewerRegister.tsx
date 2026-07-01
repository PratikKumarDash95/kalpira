'use client';

import React, { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Briefcase, CheckCircle2 } from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';

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
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch('/api/interviewer/register', {
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
            const response = await fetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
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
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
                <div className="absolute top-0 left-1/3 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative w-full max-w-md"
            >
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
                        <Briefcase size={26} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Create Interviewer Account</h1>
                    <p className="text-slate-400 text-sm mt-1">Set up interviews and track candidate performance</p>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 backdrop-blur-sm">
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
                                placeholder="Password (min 6 chars)" className={`${inputCls} pr-10`} required />
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
                                placeholder="Confirm password" className={inputCls} required />
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
                            className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
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
