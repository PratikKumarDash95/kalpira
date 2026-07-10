'use client';
import { apiFetch, apiUrl } from '@/lib/apiClient';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Briefcase, CheckCircle2, Loader2, Lock, Mail, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import { useSessionState } from '@/hooks/useSessionState';
import { validatePasswordPolicy, PASSWORD_RULE_MESSAGE } from '@/lib/passwordPolicy';

type LoginRole = 'user' | 'interviewer' | 'admin';

const roleOptions: Array<{ id: LoginRole; label: string; Icon: typeof UserRound }> = [
  { id: 'user', label: 'User', Icon: UserRound },
  { id: 'interviewer', label: 'Interviewer', Icon: Briefcase },
  { id: 'admin', label: 'Admin', Icon: ShieldCheck },
];

const loginRoles: LoginRole[] = ['user', 'interviewer', 'admin'];

const getLoginRole = (value: string | null): LoginRole | null =>
  value && loginRoles.includes(value as LoginRole) ? (value as LoginRole) : null;

const isSafeRedirect = (path: string) =>
  path.startsWith('/') && !path.startsWith('//') && !['/login', '/register', '/candidate/dashboard', '/interviewer/login', '/interviewer/register'].includes(path);

const isSafeRoleRedirect = (path: string, role: LoginRole) => {
  if (!isSafeRedirect(path)) return false;
  if (role === 'interviewer') return path.startsWith('/interviewer/');
  if (role === 'admin') return path === '/admin' || path.startsWith('/admin/');
  return !path.startsWith('/interviewer/') && !path.startsWith('/admin');
};

const Login: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail, clearEmailDraft] = useSessionState('kalpira:login:email', '');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<'standalone' | 'hosted' | null>(null);
  // Guard: while true, we're checking for an existing session and show a spinner
  // instead of the form. If a session is found we redirect and never flip this
  // false, so the login form never flashes for an already-signed-in user.
  const [authChecking, setAuthChecking] = useState(true);
  const [selectedRole, setSelectedRole, clearRoleDraft] = useSessionState<LoginRole>('kalpira:login:role', 'user');
  const [authView, setAuthView] = useState<'login' | 'forgot' | 'reset'>('login');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetOtp, setResetOtp] = useState('');
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch('/api/config/mode')
      .then((res) => res.json())
      .then((data) => setMode(data.mode))
      .catch(() => setMode('standalone'));
  }, []);

  // Already-signed-in guard: if a valid session exists, send the user straight
  // to their dashboard instead of showing the login form. Prevents logging into
  // a second account "on top of" the current one without logging out first.
  useEffect(() => {
    let cancelled = false;

    const dashboardFor = (role: string | undefined) =>
      role === 'interviewer' ? '/interviewer/dashboard'
        : role === 'admin' ? '/admin'
        : '/studies';

    const check = async () => {
      try {
        // Candidate / interviewer sessions carry a profile with a role.
        const meRes = await apiFetch('/api/auth/me');
        if (meRes.ok) {
          const data = await meRes.json().catch(() => null);
          if (data?.authenticated && data.profile) {
            if (!cancelled) router.replace(dashboardFor(data.profile.role));
            return; // leave authChecking true → spinner stays until navigation
          }
        } else {
          // Legacy global-admin sessions have no profile; detect via /api/auth.
          const authRes = await apiFetch('/api/auth');
          if (authRes.ok) {
            const authData = await authRes.json().catch(() => null);
            if (authData?.authenticated && !authData.researcherId) {
              if (!cancelled) router.replace('/admin');
              return;
            }
          }
        }
      } catch {
        // Network error → treat as logged-out and show the form.
      }
      if (!cancelled) setAuthChecking(false);
    };

    check();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    const role = getLoginRole(searchParams.get('role'));
    if (role) setSelectedRole(role);
  }, [searchParams]);

  useEffect(() => {
    const oauthError = searchParams.get('error');
    const verified = searchParams.get('verified');
    if (verified === '1') {
      setSuccess('Email verified. You can sign in now.');
    }
    if (!oauthError) return;

    const oauthDetail = searchParams.get('detail');
    const messages: Record<string, string> = {
      oauth_init_failed: 'Failed to start sign-in. Please try again.',
      oauth_failed: 'Sign-in failed. Please try again.',
      missing_params: 'Invalid callback. Please try again.',
      invalid_state: 'Session expired. Please try again.',
      user_fetch_failed: 'Failed to get your profile. Please try again.',
      no_email: 'Could not get your email. Make sure your GitHub email is verified.',
      verification_invalid: 'This verification link is invalid or already used.',
    };

    const message = messages[oauthError] || 'Sign-in failed. Please try again.';
    setError(process.env.NODE_ENV === 'development' && oauthDetail ? `${message} (${oauthDetail})` : message);
  }, [searchParams]);

  const handleGoogleSignIn = () => {
    setGoogleLoading(true);
    window.location.href = apiUrl(selectedRole === 'interviewer'
      ? '/api/auth/oauth/google/interviewer'
      : '/api/auth/oauth/google/user');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const password = passwordRef.current?.value ?? '';
    const trimmedEmail = email.trim();

    if (!password) {
      setError('Password is required');
      setLoading(false);
      return;
    }

    if (selectedRole !== 'admin' && !trimmedEmail) {
      setError('Email is required');
      setLoading(false);
      return;
    }

    try {
      if (selectedRole === 'admin') {
        const response = await apiFetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Authentication failed');
          return;
        }

        clearEmailDraft();
        clearRoleDraft();
        router.push('/admin');
        return;
      }

      // Scope the login to the selected role — one email can own separate
      // candidate ('user') and interviewer accounts. Map UI 'user' → 'candidate'.
      const roleForApi = selectedRole === 'interviewer' ? 'interviewer' : 'candidate';
      const response = await apiFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password, role: roleForApi }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      if (selectedRole === 'interviewer') {
        const meRes = await apiFetch('/api/interviewer/me');
        if (!meRes.ok) {
          const meData = await meRes.json().catch(() => ({}));
          setError(meData.error || 'This account is not an interviewer account.');
          await apiFetch('/api/auth', { method: 'DELETE' });
          return;
        }
      }

      const defaultRedirect = selectedRole === 'interviewer' ? '/interviewer/dashboard' : '/studies';
      const rawRedirect = searchParams.get('redirect') || defaultRedirect;
      const redirect = isSafeRoleRedirect(rawRedirect, selectedRole) ? rawRedirect : defaultRedirect;
      clearEmailDraft();
      clearRoleDraft();
      router.push(redirect);
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setError('Email is required');
      return;
    }

    setResetLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, role: selectedRole === 'interviewer' ? 'interviewer' : 'candidate' }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send password reset OTP.');
        return;
      }

      setSuccess('OTP sent. Check your email and enter the code below.');
      setAuthView('reset');
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = newPasswordRef.current?.value ?? '';
    const confirmPassword = confirmPasswordRef.current?.value ?? '';
    const trimmedEmail = email.trim();
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
      const response = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          otp: resetOtp,
          password,
          confirmPassword,
          role: selectedRole === 'interviewer' ? 'interviewer' : 'candidate',
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
      setError('Connection error. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  // Wait for BOTH the mode fetch and the existing-session check before rendering
  // the form — otherwise an already-signed-in user briefly sees the login form
  // before being redirected.
  if (mode === null || authChecking) {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-brand-500" />
      </div>
    );
  }

  const isInterviewer = selectedRole === 'interviewer';
  const isAdmin = selectedRole === 'admin';
  const isResetFlow = authView !== 'login';

  return (
    <div className="app-shell min-h-screen flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="max-w-sm w-full"
      >
        <div className="surface p-8">
          <div className="text-center mb-6">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--brand-soft)]">
              <Lock size={22} className="text-brand-500" />
            </span>
            <h1 className="text-xl font-bold text-[color:var(--text)]">{isResetFlow ? 'Reset password' : 'Welcome back'}</h1>
            <p className="text-[color:var(--muted)] text-sm mt-1">
              {isResetFlow
                ? 'Use your email OTP to choose a new password'
                : mode === 'hosted' ? 'Sign in to access your research dashboard' : 'Enter your credentials to access the dashboard'}
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

          {!isResetFlow && (
          <div className="mb-4">
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--surface-soft)] p-1">
              {roleOptions.map(({ id, label, Icon }) => {
                const active = selectedRole === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedRole(id)}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      active ? 'bg-brand-500 text-white shadow-sm' : 'text-[color:var(--muted)] hover:text-[color:var(--text)]'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {selectedRole !== 'admin' && !isResetFlow && (
            <div className="mb-4 space-y-3">
              <button
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full py-3 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-800 font-medium rounded-xl transition-colors flex items-center justify-center gap-3 border border-gray-200"
              >
                {googleLoading ? <Loader2 size={18} className="animate-spin" /> : (
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                Sign in with Google
              </button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-stone-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-stone-800/50 px-2 text-stone-500">Or continue with email</span>
                </div>
              </div>
            </div>
          )}

          {authView === 'forgot' ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-stone-300 mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    autoComplete="email"
                    autoFocus
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={resetLoading || !email.trim()}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? <Loader2 size={18} className="animate-spin" /> : 'Send OTP'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthView('login');
                  setError(null);
                  setSuccess(null);
                }}
                className="w-full text-sm text-stone-400 hover:text-stone-300 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft size={16} /> Back to login
              </button>
            </form>
          ) : authView === 'reset' ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="reset-otp" className="block text-sm font-medium text-stone-300 mb-1">
                  OTP Code
                </label>
                <input
                  id="reset-otp"
                  type="text"
                  inputMode="numeric"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit OTP"
                  autoComplete="one-time-code"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                />
              </div>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-stone-300 mb-1">
                  New Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="new-password"
                    type="password"
                    ref={newPasswordRef}
                    placeholder="6-10 chars, A1#"
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={10}
                    pattern="(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,10}"
                    title={PASSWORD_RULE_MESSAGE}
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-stone-300 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="confirm-password"
                    type="password"
                    ref={confirmPasswordRef}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    minLength={6}
                    maxLength={10}
                    pattern="(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,10}"
                    title={PASSWORD_RULE_MESSAGE}
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={resetLoading || resetOtp.length !== 6}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? <Loader2 size={18} className="animate-spin" /> : 'Save Password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthView('forgot');
                  setError(null);
                  setSuccess(null);
                }}
                className="w-full text-sm text-stone-400 hover:text-stone-300 transition-colors"
              >
                Send a new OTP
              </button>
            </form>
          ) : selectedRole === 'admin' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
                  Admin Password
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="password"
                    type="password"
                    ref={passwordRef}
                    placeholder="Enter admin password"
                    autoComplete="current-password"
                    autoFocus
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Login'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1">
                  {isInterviewer ? 'Work Email' : 'Email'}
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    autoComplete="email"
                    autoFocus={selectedRole !== 'interviewer'}
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-sm font-medium text-stone-300">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthView('forgot');
                      setError(null);
                      setSuccess(null);
                    }}
                    className="text-xs font-medium text-stone-400 hover:text-stone-200 transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="password"
                    type="password"
                    ref={passwordRef}
                    placeholder={isInterviewer ? 'Enter work password' : 'Enter password'}
                    autoComplete="current-password"
                    autoFocus={selectedRole === 'interviewer'}
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Login'}
              </button>

            </form>
          )}

          {!isAdmin && !isResetFlow && (
            <div className="mt-6 pt-6 border-t border-stone-700 text-center space-y-3">
              <button
                onClick={() => router.push(isInterviewer ? '/interviewer/register' : '/register')}
                className="w-full py-3 border border-stone-600 text-stone-300 hover:bg-stone-800 hover:text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus size={18} />
                {isInterviewer ? 'Create Interviewer Account' : 'Create Account'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
