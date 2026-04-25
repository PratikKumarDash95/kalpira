'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2, AlertCircle, Mail, UserPlus, UserCircle, Briefcase } from 'lucide-react';
import OAuthLogin from './OAuthLogin';

const Login: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'standalone' | 'hosted' | null>(null);

  // Use Email login by default now as requested
  const [loginMethod, setLoginMethod] = useState<'email' | 'admin'>('email');

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

      // Redirect to studies on success (validate to prevent open redirect)
      const rawRedirect = searchParams.get('redirect') || '/studies';
      const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
        ? rawRedirect
        : '/studies';
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
            <h1 className="text-xl font-bold text-white">Researcher Login</h1>
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!email || !password || loading}
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={loginMethod === 'admin' ? "Enter admin password" : "Enter password"}
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                    autoFocus={loginMethod === 'admin'}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={(!password.trim()) || (loginMethod === 'email' && !email) || loading}
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
