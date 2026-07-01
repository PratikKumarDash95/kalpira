'use client';

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Lock, Loader2, AlertCircle, User, Mail, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';
import { validatePasswordPolicy, PASSWORD_RULE_MESSAGE } from '@/lib/passwordPolicy';

const isSafeAuthRedirect = (path: string) =>
    path.startsWith('/') && !path.startsWith('//') && !['/login', '/register', '/candidate/dashboard'].includes(path);

const Register: React.FC = () => {
    const router = useRouter();
    const [name, setName, clearNameDraft] = useSessionState('kalpira:register:name', '');
    const [email, setEmail] = useSessionState('kalpira:register:email', '');
    const passwordRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(null);

        const password = passwordRef.current?.value ?? '';

        if (!password) {
            setError('Password is required');
            setLoading(false);
            return;
        }

        const passwordError = validatePasswordPolicy(password);
        if (passwordError) {
            setError(passwordError);
            setLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Registration failed');
                return;
            }

            clearNameDraft();
            setSuccess(data.message || 'Check your email for a verification link before signing in.');
            if (passwordRef.current) passwordRef.current.value = '';
        } catch {
            setError('Connection error. Please try again.');
        } finally {
            setLoading(false);
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

    return (
        <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4 sm:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-sm w-full"
            >
                <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-8">
                    <div className="text-center mb-6">
                        <div className="w-12 h-12 rounded-full bg-stone-700 flex items-center justify-center mx-auto mb-4">
                            <User size={24} className="text-stone-300" />
                        </div>
                        <h1 className="text-xl font-bold text-white">Create Account</h1>
                        <p className="text-stone-400 text-sm mt-1">
                            Sign up to start conducting research interviews
                        </p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                            <AlertCircle size={16} className="flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 p-3 mb-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-sm">
                            <CheckCircle2 size={16} className="flex-shrink-0" />
                            {success}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-stone-300 mb-1">
                                Full Name
                            </label>
                            <div className="relative">
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="John Doe"
                                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="john@example.com"
                                    autoComplete="email"
                                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
                                Password
                            </label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                                <input
                                    id="password"
                                    type="password"
                                    ref={passwordRef}
                                    placeholder="6-10 chars, A1#"
                                    autoComplete="new-password"
                                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                                    required
                                    minLength={6}
                                    maxLength={10}
                                    pattern="(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,10}"
                                    title={PASSWORD_RULE_MESSAGE}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    Creating Account...
                                </>
                            ) : (
                                <>
                                    Register <ArrowRight size={18} />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 pt-6 border-t border-stone-700 text-center space-y-3">
                        <button
                            type="button"
                            onClick={handleResendVerification}
                            disabled={resending || loading || !email.trim()}
                            className="w-full py-3 border border-stone-600 text-stone-300 hover:bg-stone-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium rounded-xl transition-colors"
                        >
                            {resending ? 'Sending verification...' : 'Resend verification email'}
                        </button>
                        <button
                            onClick={() => router.push('/login')}
                            className="text-sm text-stone-400 hover:text-stone-300 transition-colors flex items-center justify-center gap-2 mx-auto"
                        >
                            <ArrowLeft size={16} /> Back to Login
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Register;
