'use client';

import React, { useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Briefcase, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';
import { validatePasswordPolicy, PASSWORD_RULE_MESSAGE } from '@/lib/passwordPolicy';

const GoogleIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
);

const InterviewerLogin: React.FC = () => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isStandalonePortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer' || !pathname?.startsWith('/interviewer');
    const portalPath = (path: string) => isStandalonePortal ? path : `/interviewer${path}`;
    const [email, setEmail, clearEmailDraft] = useSessionState('kalpira:interviewer-login:email', '');
    const passwordRef = useRef<HTMLInputElement>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [authView, setAuthView] = useState<'login' | 'forgot' | 'reset'>('login');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetOtp, setResetOtp] = useState('');
    const newPasswordRef = useRef<HTMLInputElement>(null);
    const confirmPasswordRef = useRef<HTMLInputElement>(null);

    // Handle OAuth errors from URL params
    React.useEffect(() => {
        const oauthError = searchParams.get('error');
        const verified = searchParams.get('verified');
        if (verified === '1') {
            setSuccess('Email verified. You can sign in now.');
        }
        if (oauthError) {
            const messages: Record<string, string> = {
                oauth_init_failed: 'Failed to start Google sign-in. Please try again.',
                oauth_failed: 'Google sign-in failed. Please try again.',
                missing_params: 'Invalid callback. Please try again.',
                invalid_state: 'Session expired. Please try again.',
                user_fetch_failed: 'Failed to get your Google profile. Please try again.',
                verification_invalid: 'This verification link is invalid or already used.',
            };
            setError(messages[oauthError] || 'Sign-in failed. Please try again.');
        }
    }, [searchParams]);

    const handleGoogleSignIn = () => {
        setGoogleLoading(true);
        window.location.href = '/api/auth/oauth/google/interviewer';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        const password = passwordRef.current?.value ?? '';
        if (!email.trim() || !password) { setError('Email and password are required.'); return; }

        setIsLoading(true);
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error || 'Login failed.'); return; }

            // Verify the logged-in user is actually an interviewer via dedicated endpoint
            const meRes = await fetch('/api/interviewer/me');
            if (!meRes.ok) {
                // 403 = wrong role, 401 = session issue
                const meData = await meRes.json();
                setError(meData.error || 'This account is not an interviewer account.');
                await fetch('/api/auth', { method: 'DELETE' }); // logout
                return;
            }

            const defaultRedirect = portalPath('/dashboard');
            const rawRedirect = searchParams.get('redirect') || defaultRedirect;
            const redirect = rawRedirect.startsWith(isStandalonePortal ? '/' : '/interviewer/') && !rawRedirect.startsWith('//')
                ? rawRedirect
                : defaultRedirect;
            clearEmailDraft();
            router.push(redirect);
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) {
            setError('Email is required.');
            return;
        }

        setResetLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || 'Failed to send password reset OTP.');
                return;
            }
            setSuccess('OTP sent. Check your email and enter the code below.');
            setAuthView('reset');
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setResetLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        const password = newPasswordRef.current?.value ?? '';
        const confirmPassword = confirmPasswordRef.current?.value ?? '';
        const passwordError = validatePasswordPolicy(password);

        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setResetLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim(),
                    otp: resetOtp,
                    password,
                    confirmPassword,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.error || 'Failed to update password.');
                return;
            }
            setSuccess(data.message || 'Password updated. You can sign in now.');
            setAuthView('login');
            setResetOtp('');
            if (newPasswordRef.current) newPasswordRef.current.value = '';
            if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setResetLoading(false);
        }
    };

    const inputCls = "w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors text-sm";

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-slate-950 to-indigo-950/10" />
                <div className="absolute top-0 left-1/3 w-96 h-96 bg-violet-600/5 rounded-full blur-3xl" />
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
                        <Briefcase size={26} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">{authView === 'login' ? 'Interviewer Sign In' : 'Reset Password'}</h1>
                    <p className="text-slate-400 text-sm mt-1">{authView === 'login' ? 'Access your interview dashboard' : 'Use your email OTP to choose a new password'}</p>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 backdrop-blur-sm">
                    {authView === 'login' && (
                    <>
                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={googleLoading || isLoading}
                        className="w-full py-3 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-800 font-medium rounded-xl transition-colors flex items-center justify-center gap-3 border border-gray-200 mb-4"
                    >
                        {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
                        Sign in with Google
                    </button>

                    <div className="relative mb-4">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-slate-700" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-slate-900/60 px-2 text-slate-500">Or continue with email</span>
                        </div>
                    </div>
                    </>
                    )}

                    {authView === 'forgot' ? (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div className="relative">
                            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                autoComplete="email"
                                placeholder="Work email" className={inputCls} required />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>
                        )}

                        <button type="submit" disabled={resetLoading || !email.trim()}
                            className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
                            {resetLoading ? <Loader2 size={18} className="animate-spin" /> : 'Send OTP'}
                        </button>
                        <button type="button" onClick={() => { setAuthView('login'); setError(null); setSuccess(null); }}
                            className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-2">
                            <ArrowLeft size={16} /> Back to sign in
                        </button>
                    </form>
                    ) : authView === 'reset' ? (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <input
                            type="text"
                            inputMode="numeric"
                            value={resetOtp}
                            onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            autoComplete="one-time-code"
                            placeholder="Enter 6-digit OTP"
                            className={inputCls.replace('pl-10', 'pl-4')}
                            required
                        />
                        <div className="relative">
                            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type={showPassword ? 'text' : 'password'} ref={newPasswordRef}
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

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>
                        )}

                        {success && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-300 flex items-center gap-2">
                                <CheckCircle2 size={16} className="flex-shrink-0" />
                                {success}
                            </div>
                        )}

                        <button type="submit" disabled={resetLoading || resetOtp.length !== 6}
                            className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
                            {resetLoading ? <Loader2 size={18} className="animate-spin" /> : 'Save Password'}
                        </button>
                        <button type="button" onClick={() => { setAuthView('forgot'); setError(null); setSuccess(null); }}
                            className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors">
                            Send a new OTP
                        </button>
                    </form>
                    ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="relative">
                            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                autoComplete="email"
                                placeholder="Work email" className={inputCls} required />
                        </div>

                        <div className="relative">
                            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input type={showPassword ? 'text' : 'password'} ref={passwordRef}
                                autoComplete="current-password"
                                placeholder="Password" className={`${inputCls} pr-10`} required />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        <div className="text-right">
                            <button type="button" onClick={() => { setAuthView('forgot'); setError(null); setSuccess(null); }}
                                className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors">
                                Forgot password?
                            </button>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>
                        )}

                        {success && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-300 flex items-center gap-2">
                                <CheckCircle2 size={16} className="flex-shrink-0" />
                                {success}
                            </div>
                        )}

                        <button type="submit" disabled={isLoading}
                            className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-2">
                            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                            {isLoading ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>
                    )}

                    {authView === 'login' && (
                    <p className="text-center text-sm text-slate-500 mt-6">
                        New interviewer?{' '}
                        <button onClick={() => router.push(portalPath('/register'))} className="text-violet-400 hover:text-violet-300 transition-colors">
                            Create account
                        </button>
                    </p>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default InterviewerLogin;
