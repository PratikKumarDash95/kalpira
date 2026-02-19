'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Database, Key, CheckCircle, XCircle, Loader2,
  AlertCircle, ExternalLink, ArrowLeft, Save, ChevronDown, ChevronUp
} from 'lucide-react';

interface ResearcherProfile {
  name: string;
  email: string;
  avatarUrl: string | null;
  hasRedisConfigured: boolean;
  hasGeminiKey: boolean;
  hasAnthropicKey: boolean;
}

interface ValidationState {
  loading: boolean;
  valid: boolean | null;
  error: string | null;
}

const Settings: React.FC = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<ResearcherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [geminiKey, setGeminiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [redisUrl, setRedisUrl] = useState('');
  const [redisToken, setRedisToken] = useState('');

  // Validation state
  const [geminiValidation, setGeminiValidation] = useState<ValidationState>({ loading: false, valid: null, error: null });
  const [anthropicValidation, setAnthropicValidation] = useState<ValidationState>({ loading: false, valid: null, error: null });
  const [redisValidation, setRedisValidation] = useState<ValidationState>({ loading: false, valid: null, error: null });

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Expandable guide state
  const [geminiGuideOpen, setGeminiGuideOpen] = useState(false);
  const [claudeGuideOpen, setClaudeGuideOpen] = useState(false);
  const [redisGuideOpen, setRedisGuideOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.profile) setProfile(data.profile);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const validateAiKey = async (provider: 'gemini' | 'claude', apiKey: string) => {
    const setValidation = provider === 'gemini' ? setGeminiValidation : setAnthropicValidation;
    setValidation({ loading: true, valid: null, error: null });

    try {
      const res = await fetch('/api/onboarding/validate-ai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json();
      setValidation({ loading: false, valid: data.valid, error: data.error || null });
    } catch {
      setValidation({ loading: false, valid: false, error: 'Validation failed' });
    }
  };

  const validateRedis = async () => {
    setRedisValidation({ loading: true, valid: null, error: null });
    try {
      const res = await fetch('/api/onboarding/validate-redis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redisUrl, redisToken }),
      });
      const data = await res.json();
      setRedisValidation({ loading: false, valid: data.valid, error: data.error || null });
    } catch {
      setRedisValidation({ loading: false, valid: false, error: 'Validation failed' });
    }
  };

  const hasChanges = !!(geminiKey || anthropicKey || (redisUrl && redisToken));

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);

    try {
      const body: Record<string, string | undefined> = {};
      if (geminiKey) body.geminiApiKey = geminiKey;
      if (anthropicKey) body.anthropicApiKey = anthropicKey;
      if (redisUrl && redisToken) {
        body.redisUrl = redisUrl;
        body.redisToken = redisToken;
      }

      if (Object.keys(body).length === 0) {
        setSaving(false);
        return;
      }

      const res = await fetch('/api/onboarding/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSaveSuccess(true);
        // Refresh profile
        const meRes = await fetch('/api/auth/me');
        const meData = await meRes.json();
        if (meData.profile) setProfile(meData.profile);
        // Clear form fields
        setGeminiKey('');
        setAnthropicKey('');
        setRedisUrl('');
        setRedisToken('');
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || 'Failed to save changes. Please try again.');
      }
    } catch {
      setSaveError('Connection error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const StatusIcon: React.FC<{ configured: boolean }> = ({ configured }) =>
    configured
      ? <CheckCircle size={16} className="text-green-400" />
      : <XCircle size={16} className="text-stone-500" />;

  const ValidationBadge: React.FC<{ state: ValidationState }> = ({ state }) => {
    if (state.loading) return <Loader2 size={16} className="animate-spin text-stone-400" />;
    if (state.valid === true) return <CheckCircle size={16} className="text-green-400" />;
    if (state.valid === false) return <AlertCircle size={16} className="text-red-400" />;
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-900 p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto"
      >
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.push('/studies')}
            className="p-2 hover:bg-stone-800 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-stone-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Settings</h1>
            {profile && (
              <p className="text-stone-400 text-sm">{profile.email}</p>
            )}
          </div>
        </div>

        {/* Current Status */}
        {profile && (
          <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">Current Status</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <StatusIcon configured={profile.hasGeminiKey} />
                <span className="text-stone-300 text-sm">Gemini Key</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon configured={profile.hasAnthropicKey} />
                <span className="text-stone-300 text-sm">Claude Key</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusIcon configured={profile.hasRedisConfigured} />
                <span className="text-stone-300 text-sm">Redis Storage</span>
              </div>
            </div>
          </div>
        )}

        {/* AI API Keys */}
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Key size={18} className="text-stone-400" />
            <h2 className="text-lg font-semibold text-white">AI API Keys</h2>
          </div>
          <p className="text-stone-400 text-sm mb-4">
            Update your API keys. Leave blank to keep the current key.
          </p>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-stone-300">Gemini API Key</label>
                <ValidationBadge state={geminiValidation} />
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => { setGeminiKey(e.target.value); setGeminiValidation({ loading: false, valid: null, error: null }); }}
                  placeholder={profile?.hasGeminiKey ? '(currently set)' : 'AIza...'}
                  className="flex-1 px-3 py-2 rounded-lg bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
                />
                <button
                  onClick={() => validateAiKey('gemini', geminiKey)}
                  disabled={!geminiKey || geminiValidation.loading}
                  className="px-3 py-2 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 text-stone-300 text-sm rounded-lg transition-colors"
                >
                  Test
                </button>
              </div>
              {geminiValidation.error && <p className="text-red-400 text-xs mt-1">{geminiValidation.error}</p>}

              {/* Expandable setup guide */}
              <div className="mt-2">
                <button
                  onClick={() => setGeminiGuideOpen(!geminiGuideOpen)}
                  className="text-xs text-stone-500 hover:text-stone-400 inline-flex items-center gap-1"
                >
                  {geminiGuideOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Setup guide
                </button>

                {geminiGuideOpen && (
                  <div className="mt-2 p-3 bg-stone-800/30 border border-stone-600 rounded-lg text-xs space-y-2">
                    <ol className="list-decimal list-inside space-y-1 text-stone-300">
                      <li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-stone-400 hover:text-stone-300 underline">aistudio.google.com/apikey</a></li>
                      <li>Sign in and click "Create API key"</li>
                      <li>Copy the key (starts with AIza)</li>
                    </ol>
                    <div className="flex items-start gap-1.5 text-stone-400 mt-2">
                      <span>•</span>
                      <span>Free: 10 req/min, 250 req/day</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-stone-300">Claude API Key</label>
                <ValidationBadge state={anthropicValidation} />
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => { setAnthropicKey(e.target.value); setAnthropicValidation({ loading: false, valid: null, error: null }); }}
                  placeholder={profile?.hasAnthropicKey ? '(currently set)' : 'sk-ant-...'}
                  className="flex-1 px-3 py-2 rounded-lg bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
                />
                <button
                  onClick={() => validateAiKey('claude', anthropicKey)}
                  disabled={!anthropicKey || anthropicValidation.loading}
                  className="px-3 py-2 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 text-stone-300 text-sm rounded-lg transition-colors"
                >
                  Test
                </button>
              </div>
              {anthropicValidation.error && <p className="text-red-400 text-xs mt-1">{anthropicValidation.error}</p>}

              {/* Expandable setup guide */}
              <div className="mt-2">
                <button
                  onClick={() => setClaudeGuideOpen(!claudeGuideOpen)}
                  className="text-xs text-stone-500 hover:text-stone-400 inline-flex items-center gap-1"
                >
                  {claudeGuideOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Setup guide
                </button>

                {claudeGuideOpen && (
                  <div className="mt-2 p-3 bg-stone-800/30 border border-stone-600 rounded-lg text-xs space-y-2">
                    <ol className="list-decimal list-inside space-y-1 text-stone-300">
                      <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-stone-400 hover:text-stone-300 underline">console.anthropic.com</a></li>
                      <li>Sign up and claim $5 free credits (US phone verification required)</li>
                      <li>Go to API Keys → Create API Key → copy it (starts with sk-ant-)</li>
                    </ol>
                    <div className="flex items-start gap-1.5 text-stone-400 mt-2">
                      <span>•</span>
                      <span>$5 free ≈ 15-100 interviews</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Redis Storage */}
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Database size={18} className="text-stone-400" />
            <h2 className="text-lg font-semibold text-white">Upstash Redis Storage</h2>
          </div>
          <p className="text-stone-400 text-sm mb-4">
            Update your Redis credentials. Leave blank to keep the current connection.
            <span className="text-amber-400"> Warning: changing your Redis URL will disconnect from your current data.</span>
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-stone-300 mb-1 block">REST API URL</label>
              <input
                type="text"
                value={redisUrl}
                onChange={(e) => { setRedisUrl(e.target.value); setRedisValidation({ loading: false, valid: null, error: null }); }}
                placeholder={profile?.hasRedisConfigured ? '(currently set)' : 'https://your-db.upstash.io'}
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-stone-300 mb-1 block">REST API Token</label>
              <input
                type="password"
                value={redisToken}
                onChange={(e) => { setRedisToken(e.target.value); setRedisValidation({ loading: false, valid: null, error: null }); }}
                placeholder={profile?.hasRedisConfigured ? '(currently set)' : 'AXxx...'}
                className="w-full px-3 py-2 rounded-lg bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ValidationBadge state={redisValidation} />
                {redisValidation.valid && <span className="text-green-400 text-sm">Connected</span>}
                {redisValidation.error && <span className="text-red-400 text-sm">{redisValidation.error}</span>}
              </div>
              <button
                onClick={validateRedis}
                disabled={!redisUrl || !redisToken || redisValidation.loading}
                className="px-4 py-2 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 text-stone-300 text-sm rounded-lg transition-colors"
              >
                {redisValidation.loading ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {/* Expandable setup guide */}
            <div>
              <button
                onClick={() => setRedisGuideOpen(!redisGuideOpen)}
                className="text-xs text-stone-500 hover:text-stone-400 inline-flex items-center gap-1"
              >
                {redisGuideOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Setup guide
              </button>

              {redisGuideOpen && (
                <div className="mt-2 p-3 bg-stone-800/30 border border-stone-600 rounded-lg text-xs space-y-2">
                  <ol className="list-decimal list-inside space-y-1 text-stone-300">
                    <li>Go to <a href="https://console.upstash.com" target="_blank" rel="noopener noreferrer" className="text-stone-400 hover:text-stone-300 underline">console.upstash.com</a> and sign in</li>
                    <li>Click "+ Create Database" → choose Regional and Free plan</li>
                    <li>After creation, go to database details → REST API section</li>
                    <li>Copy REST URL (https://*.upstash.io) and REST Token</li>
                  </ol>
                  <div className="flex items-start gap-1.5 text-amber-400 mt-2">
                    <span>⚠</span>
                    <span>Use REST URL (https://), not regular URL (redis://)</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Save Button */}
        {/* Partial Redis warning */}
        {((redisUrl && !redisToken) || (!redisUrl && redisToken)) && (
          <div className="flex items-center gap-2 p-3 mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
            <AlertCircle size={16} className="flex-shrink-0" />
            Both Redis URL and token are required to update storage credentials.
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            {saveSuccess && (
              <span className="text-green-400 text-sm flex items-center gap-1">
                <CheckCircle size={14} /> Saved successfully
              </span>
            )}
            {saveError && (
              <span className="text-red-400 text-sm flex items-center gap-1">
                <AlertCircle size={14} /> {saveError}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-6 py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={18} />
                Save Changes
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default Settings;
