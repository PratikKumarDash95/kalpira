"use client";

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Camera, ImagePlus, Loader2, LogOut, Save, Settings, Upload, UserCircle } from 'lucide-react';

interface Profile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  onboardingComplete: boolean;
  hasGeminiKey: boolean;
  hasAnthropicKey: boolean;
}

type MediaKind = 'avatar' | 'cover';

export default function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const isStandaloneInterviewerPortal = process.env.NEXT_PUBLIC_PORTAL === 'interviewer';
  const isInterviewerProfile = isStandaloneInterviewerPortal || (pathname?.startsWith('/interviewer') ?? false);
  const profileApi = isInterviewerProfile ? '/api/interviewer/me' : '/api/auth/me';
  const loginPath = isInterviewerProfile ? (isStandaloneInterviewerPortal ? '/login' : '/interviewer/login') : '/login';
  const dashboardPath = isInterviewerProfile ? (isStandaloneInterviewerPortal ? '/dashboard' : '/interviewer/dashboard') : '/studies';
  const profilePath = isInterviewerProfile ? (isStandaloneInterviewerPortal ? '/profile' : '/interviewer/profile') : '/profile';
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<MediaKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(profileApi)
      .then((res) => {
        if (res.status === 401) {
          router.push(`${loginPath}?redirect=${encodeURIComponent(profilePath)}`);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        const loadedProfile = data?.profile || data?.user;
        if (loadedProfile) {
          setProfile(loadedProfile);
          setName(loadedProfile.name || '');
          setAvatarUrl(loadedProfile.avatarUrl || '');
          setCoverUrl(loadedProfile.coverUrl || '');
        }
      })
      .catch(() => setError('Failed to load profile.'))
      .finally(() => setLoading(false));
  }, [loginPath, profileApi, profilePath, router]);

  const uploadMedia = async (kind: MediaKind, file: File) => {
    setUploading(kind);
    setMessage(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('kind', kind);
      formData.append('file', file);

      const res = await fetch('/api/profile/media', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Failed to upload ${kind} image.`);
        return;
      }

      const nextAvatarUrl = kind === 'avatar' ? data.publicUrl : avatarUrl;
      const nextCoverUrl = kind === 'cover' ? data.publicUrl : coverUrl;

      if (kind === 'avatar') setAvatarUrl(data.publicUrl);
      else setCoverUrl(data.publicUrl);

      const saveRes = await fetch(profileApi, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarUrl: nextAvatarUrl,
          coverUrl: nextCoverUrl,
        }),
      });
      const saveData = await saveRes.json();

      if (!saveRes.ok) {
        setError(saveData.error || `Uploaded ${kind} image, but profile update failed.`);
        return;
      }

      const savedProfile = saveData.profile || saveData.user;
      setProfile(savedProfile);
      if (savedProfile) {
        setName(savedProfile.name || '');
        setAvatarUrl(savedProfile.avatarUrl || '');
        setCoverUrl(savedProfile.coverUrl || '');
      }
      setMessage(`${kind === 'avatar' ? 'Profile photo' : 'Cover image'} uploaded and saved.`);
    } catch {
      setError(`Failed to upload ${kind} image.`);
    } finally {
      setUploading(null);
    }
  };

  const handleFileChange = (kind: MediaKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    uploadMedia(kind, file);
  };

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(profileApi, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, avatarUrl, coverUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save profile.');
        return;
      }
      setProfile(data.profile || data.user);
      setMessage('Profile saved.');
    } catch {
      setError('Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="kalpira-light min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="skeleton mb-5 h-10 w-36 rounded-xl" />
          <section className="skeleton-card overflow-hidden rounded-3xl">
            <div className="skeleton h-40 rounded-none" />
            <div className="px-5 pb-6 sm:px-8 sm:pb-8">
              <div className="-mt-14 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-4">
                  <div className="skeleton h-28 w-28 rounded-3xl border-4 border-white" />
                  <div className="space-y-3 pb-3">
                    <div className="skeleton h-7 w-44" />
                    <div className="skeleton h-4 w-56" />
                  </div>
                </div>
                <div className="skeleton h-10 w-28 rounded-xl" />
              </div>
              <div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="skeleton-card rounded-2xl p-5">
                  <div className="skeleton mb-5 h-5 w-36" />
                  <div className="skeleton mb-4 h-12 w-full" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="skeleton h-12" />
                    <div className="skeleton h-12" />
                  </div>
                </div>
                <div className="skeleton-card rounded-2xl p-5">
                  <div className="skeleton mb-5 h-5 w-32" />
                  <div className="space-y-3">
                    <div className="skeleton h-10" />
                    <div className="skeleton h-10" />
                    <div className="skeleton h-10" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="kalpira-light flex min-h-screen items-center justify-center p-6">
        <div className="surface max-w-md rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-600">{error || 'No profile found.'}</p>
          <button onClick={() => router.push(loginPath)} className="btn-primary mt-4 px-5 py-2 text-sm font-semibold">
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="kalpira-light min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <button
          onClick={() => router.push(dashboardPath)}
          className="mb-5 inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
        >
          <ArrowLeft size={16} />
          {isInterviewerProfile ? 'Back to dashboard' : 'Back to studies'}
        </button>

        <section className="surface overflow-hidden rounded-3xl">
            <div className="relative h-40 overflow-hidden bg-gradient-to-r from-[#ffe4f2] via-[#efeaff] to-[#dff4ff]">
            {coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt="Profile cover" className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-white/12 to-white/4" />
            <input
              ref={coverInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange('cover')}
            />
              <button
                onClick={() => coverInputRef.current?.click()}
                disabled={uploading !== null}
                className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-xl border border-white/80 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white disabled:opacity-60"
              >
                {uploading === 'cover' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                {coverUrl ? 'Change cover' : 'Upload cover'}
              </button>
            </div>

          <div className="px-5 pb-6 sm:px-8 sm:pb-8">
            <div className="-mt-14 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-end gap-4">
                <div className="relative h-28 w-28 overflow-hidden rounded-3xl border-4 border-white bg-white shadow-[0_18px_40px_rgba(143,124,255,0.2)]">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-indigo-50">
                      <UserCircle className="h-16 w-16 text-indigo-400" />
                    </div>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleFileChange('avatar')}
                  />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploading !== null}
                    className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1 rounded-xl bg-white/90 px-2 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-white disabled:opacity-60"
                  >
                    {uploading === 'avatar' ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                    Photo
                  </button>
                </div>
                <div className="pb-2">
                  <h1 className="text-2xl font-bold text-slate-950">{profile.name || 'Kalpira User'}</h1>
                  <p className="text-sm text-slate-500">{profile.email || 'No email available'}</p>
                </div>
              </div>

              {!isInterviewerProfile && (
                <button
                  onClick={() => router.push('/settings')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/80 bg-white/70 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                >
                  <Settings size={16} />
                  Settings
                </button>
              )}
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-white/80 bg-white/65 p-5">
                <h2 className="text-base font-semibold text-slate-950">Profile details</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">Display name</label>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploading !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                    >
                      {uploading === 'avatar' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      Upload profile photo
                    </button>
                    <button
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploading !== null}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-sm font-semibold text-pink-700 hover:bg-pink-100 disabled:opacity-60"
                    >
                      {uploading === 'cover' ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                      Upload cover image
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    Images upload directly to Supabase Storage bucket `profile-images`; Kalpira saves the returned URLs to your profile.
                  </p>

                  {message && <p className="text-sm text-emerald-600">{message}</p>}
                  {error && <p className="text-sm text-red-500">{error}</p>}

                  <button
                    onClick={saveProfile}
                    disabled={saving || uploading !== null}
                    className="btn-primary inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                    Save profile
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/auth', { method: 'DELETE' });
                        if (!res.ok) {
                          setError('Logout failed. Please try again.');
                          return;
                        }
                      } catch {
                        setError('Logout failed. Please try again.');
                        return;
                      }
                      router.push(loginPath);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-white"
                  >
                    <LogOut size={17} />
                    Logout
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/80 bg-white/65 p-5">
                <h2 className="text-base font-semibold text-slate-950">Account status</h2>
                <div className="mt-4 space-y-3 text-sm">
                  {!isInterviewerProfile && (
                    <>
                      <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                        <span className="text-slate-600">Gemini key</span>
                        <span className={profile.hasGeminiKey ? 'text-emerald-600' : 'text-slate-400'}>
                          {profile.hasGeminiKey ? 'Configured' : 'Missing'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                        <span className="text-slate-600">Claude key</span>
                        <span className={profile.hasAnthropicKey ? 'text-emerald-600' : 'text-slate-400'}>
                          {profile.hasAnthropicKey ? 'Configured' : 'Missing'}
                        </span>
                      </div>
                    </>
                  )}
                  {isInterviewerProfile && (
                    <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                      <span className="text-slate-600">Portal</span>
                      <span className="text-indigo-600">Interviewer</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                    <span className="text-slate-600">Supabase media</span>
                    <span className="text-indigo-600">Uploads enabled</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
