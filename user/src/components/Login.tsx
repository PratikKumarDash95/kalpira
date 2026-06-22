'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2, AlertCircle, Mail, UserPlus, Briefcase } from 'lucide-react';
import OAuthLogin from './OAuthLogin';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const Login: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'standalone' | 'hosted' | null>(null);

  const [loginMethod, setLoginMethod] = useState<'email' | 'admin'>('email');

  const handleGoogleSignIn = () => {
    setGoogleLoading(true);
    window.location.href = '/api/auth/oauth/google/user';
  };

  // Check deployment mode
  useEffect(() => {
    fetch('/api/config/mode')
      .then(res => res.json())
      .then(data => {
        setMode(data.mode);
        // Default to admin login if strictly standalone and no email entered, 
        // but we want to encourage email login now.
      })
      .catch(() => setMode('standalone'));
  }, []);

  // Check for OAuth error in URL params
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      const errorMessages: Record<string, string> = {
        oauth_init_failed: 'Failed to start sign-in. Please try again.',
        oauth_failed: 'Sign-in failed. Please try again.',
        missing_params: 'Invalid callback. Please try again.',
        invalid_state: 'Session expired. Please try again.',
        user_fetch_failed: 'Failed to get your profile. Please try again.',
        no_email: 'Could not get your email. Make sure your GitHub email is verified.',
      };
      setError(errorMessages[oauthError] || 'Sign-in failed. Please try again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const password = passwordRef.current?.value ?? '';

    if (!password) {
      setError('Password is required');
      setLoading(false);
      return;
    }

    const payload = loginMethod === 'email'
      ? { email, password }
      : { password };

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      // Admin password login → go to admin panel
      if (loginMethod === 'admin') {
        router.push('/admin');
        return;
      }

      const userRole = data.user?.role || 'candidate';
      const defaultRedirect = userRole === 'candidate' ? '/candidate/dashboard' : '/studies';
      // Redirect on success (validate to prevent open redirect)
      const rawRedirect = searchParams.get('redirect') || defaultRedirect;
      const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') && !['/login', '/register'].includes(rawRedirect)
        ? rawRedirect
        : defaultRedirect;
      router.push(redirect);
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Loading state while checking mode
  if (mode === null) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-stone-400" />
      </div>
    );
  }

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
              <Lock size={24} className="text-stone-300" />
            </div>
            <h1 className="text-xl font-bold text-white">Login</h1>
            <p className="text-stone-400 text-sm mt-1">
              {mode === 'hosted'
                ? 'Sign in to access your research dashboard'
                : 'Enter your credentials to access the dashboard'
              }
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Google sign-in for standalone mode */}
          {mode === 'standalone' && loginMethod === 'email' && (
            <div className="mb-4 space-y-3">
              <button
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
                className="w-full py-3 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-800 font-medium rounded-xl transition-colors flex items-center justify-center gap-3 border border-gray-200"
              >
                {googleLoading ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
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

          {/* Toggle between Admin Password (Legacy) and Email Login */}
          {mode === 'standalone' && (
            <div className="flex bg-stone-800 rounded-lg p-1 mb-6 border border-stone-700">
              <button
                onClick={() => setLoginMethod('email')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${loginMethod === 'email' ? 'bg-stone-600 text-white' : 'text-stone-400 hover:text-stone-300'
                  }`}
              >
                User Login
              </button>
              <button
                onClick={() => setLoginMethod('admin')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${loginMethod === 'admin' ? 'bg-stone-600 text-white' : 'text-stone-400 hover:text-stone-300'
                  }`}
              >
                Admin Password
              </button>
            </div>
          )}

          {mode === 'hosted' ? (
            <div className="space-y-4">
              <OAuthLogin loading={loading} />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-stone-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-stone-800 px-2 text-stone-500">Or continue with</span>
                </div>
              </div>

              {/* Allow email login in hosted mode too now */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1">
                    Email
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
                      className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                    />
                  </div>
                </div>
                <div>
                    <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
                      Password
                    </label>
                  <input
                    id="password"
                    type="password"
                    ref={passwordRef}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    className="w-full px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!email || loading}
                  className="w-full py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Logging in...
                    </>
                  ) : (
                    'Login with Email'
                  )}
                </button>
              </form>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {loginMethod === 'email' && (
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1">
                    Email
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
                      className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
                  {loginMethod === 'admin' ? 'Admin Password' : 'Password'}
                </label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                  <input
                    id="password"
                    type="password"
                    ref={passwordRef}
                    placeholder={loginMethod === 'admin' ? "Enter admin password" : "Enter password"}
                    autoComplete="current-password"
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                    autoFocus={loginMethod === 'admin'}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={(loginMethod === 'email' && !email) || loading}
                className="w-full py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-stone-700 text-center space-y-3">
            {/* Register Link */}
            <button
              onClick={() => router.push('/register')}
              className="w-full py-3 border border-stone-600 text-stone-300 hover:bg-stone-800 hover:text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <UserPlus size={18} />
              Create Account
            </button>

            {/* Interviewer Portal */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-stone-700/60" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-stone-800/50 px-3 text-stone-500">or</span>
              </div>
            </div>

            <button
              onClick={() => router.push('/interviewer/login')}
              className="w-full py-3 border border-violet-500/40 bg-violet-600/10 hover:bg-violet-600/20 text-violet-300 hover:text-violet-200 font-medium rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Briefcase size={18} />
              Interviewer Portal
            </button>

          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
