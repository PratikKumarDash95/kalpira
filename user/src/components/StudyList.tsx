'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { StoredStudy } from '@/types';
import { getAllStudies, deleteStudy } from '@/services/storageService';
import {
  Loader2,
  Plus,
  BookOpen,
  Users,
  Calendar,
  Lock,
  Unlock,
  Trash2,
  Eye,
  Link as LinkIcon,
  MoreVertical,
  LogOut,
  AlertTriangle,
  Database,
  Sparkles,
  Menu,
  X,
  Shield,
  Briefcase
} from 'lucide-react';

const StudyList: React.FC = () => {
  const router = useRouter();
  const [studies, setStudies] = useState<StoredStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [kvWarning, setKvWarning] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadStudies();
    // Check if logged in as admin (admin password login has no researcherId)
    fetch('/api/auth')
      .then(r => r.json())
      .then(d => setIsAdmin(d.authenticated && !d.researcherId))
      .catch(() => { });
  }, []);

  const loadStudies = async () => {
    setLoading(true);
    try {
      const { studies: data, warning } = await getAllStudies();
      setStudies(data);
      setKvWarning(warning || null);
    } catch (error) {
      console.error('Error loading studies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInterviewerPractice = async () => {
    setLoading(true);
    try {
      // Create a persistent "practice" study configuration
      const practiceConfig = {
        name: `Interviewer Practice - ${new Date().toLocaleDateString()}`,
        description: "A simulated interview session to test the platform capabilities from a participant's perspective.",
        researchQuestion: "Platform Capabilities",
        coreQuestions: [
          "What are your main goals for using this platform?",
          "How do you currently conduct user research interviews?"
        ],
        topicAreas: ["User Research", "AI Tools"],
        profileSchema: [
          { id: "role", label: "Current Role", extractionHint: "Job title", required: false }
        ],
        aiBehavior: "standard",
        aiProvider: "gemini",
        aiModel: "gemini-2.5-flash",
        linkExpiration: "never",
        linksEnabled: true,
        consentText: "This is a practice session. No data will be permanently stored."
      };

      // 1. Create the study in DB so it shows on dashboard
      const studyRes = await fetch('/api/interviewer/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: practiceConfig })
      });

      if (!studyRes.ok) throw new Error('Failed to create practice study record');
      const studyData = await studyRes.json();
      const studyId = studyData.study.id;

      // 2. Generate link for this specific study ID
      const response = await fetch('/api/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studyConfig: { ...practiceConfig, id: studyId } })
      });

      const data = await response.json();

      if (data.url) {
        // Navigate to the participant flow
        const urlObj = new URL(data.url);
        router.push(urlObj.pathname);
      } else {
        alert('Failed to generate practice link: ' + (data.error || 'Unknown error'));
        setLoading(false);
      }
    } catch (error) {
      console.error('Error generating practice link:', error);
      alert('Failed to start practice session');
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this study? This cannot be undone.')) {
      return;
    }

    setDeletingId(id);
    try {
      const result = await deleteStudy(id);
      if (result.success) {
        setStudies(studies.filter(s => s.id !== id));
      } else {
        alert(result.error || 'Failed to delete study');
      }
    } catch (error) {
      console.error('Error deleting study:', error);
      alert('Failed to delete study');
    } finally {
      setDeletingId(null);
      setMenuOpenId(null);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Check if demo data exists (Removed)
  // const hasDemoData = studies.some(s => s.id.startsWith('demo-'));

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-stone-900 p-4 sm:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 sm:mb-8"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-stone-700 flex items-center justify-center flex-shrink-0">
                <BookOpen className="text-stone-300" size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-3xl font-bold text-white truncate">My Studies</h1>
                <p className="text-stone-400 text-sm">
                  {studies.length} {studies.length === 1 ? 'study' : 'studies'}
                </p>
              </div>
            </div>

            {/* Desktop buttons */}
            <div className="hidden md:flex gap-2 flex-wrap justify-end">
              <button
                onClick={() => router.push('/setup')}
                className="px-3 py-2 text-sm bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors flex items-center gap-2"
              >
                <Plus size={16} />
                Create Study
              </button>

              <button
                onClick={handleInterviewerPractice}
                className="px-3 py-2 text-sm border border-violet-700/50 text-violet-400 hover:bg-violet-900/30 rounded-xl transition-colors flex items-center gap-2"
              >
                <Briefcase size={16} />
                Interviewer Practice
              </button>

              <button
                onClick={() => router.push('/dashboard')}
                className="px-3 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center gap-2"
              >
                <Users size={16} />
                All Interviews
              </button>

              <button
                onClick={handleLogout}
                className="px-3 py-2 text-sm border border-stone-600 text-stone-400 hover:bg-stone-700 rounded-xl transition-colors flex items-center gap-2"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl bg-stone-800 text-stone-300 hover:bg-stone-700 transition-colors flex-shrink-0"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>

          {/* Mobile menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="md:hidden mt-3 grid grid-cols-2 gap-2 overflow-hidden"
              >
                <button onClick={() => router.push('/setup')} className="px-3 py-2 text-sm bg-stone-600 text-white rounded-xl flex items-center gap-2 justify-center">
                  <Plus size={14} /> Create Study
                </button>
                <button onClick={handleInterviewerPractice} className="px-3 py-2 text-sm bg-violet-900/50 text-violet-200 rounded-xl flex items-center gap-2 justify-center">
                  <Briefcase size={14} /> Interviewer Practice
                </button>
                <button onClick={() => router.push('/dashboard')} className="px-3 py-2 text-sm bg-stone-700 text-stone-300 rounded-xl flex items-center gap-2 justify-center">
                  <Users size={14} /> All Interviews
                </button>

                <button onClick={handleLogout} className="px-3 py-2 text-sm border border-stone-600 text-stone-400 rounded-xl flex items-center gap-2 justify-center">
                  <LogOut size={14} /> Logout
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* KV Warning Banner */}
        {kvWarning && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-amber-900/30 border border-amber-700/50 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-medium text-amber-300 mb-1">Storage Not Configured</h4>
              <p className="text-sm text-amber-400/80">{kvWarning}</p>
              <p className="text-sm text-amber-400/60 mt-2">
                See the README for setup instructions using Vercel KV (Upstash Redis).
              </p>
            </div>
          </motion.div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={48} className="animate-spin text-stone-400" />
          </div>
        ) : studies.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-stone-800/50 rounded-2xl border border-stone-700 p-12 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
              <BookOpen size={32} className="text-stone-500" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No Studies Yet</h2>
            <p className="text-stone-400 mb-6">
              Create your first study or start interviewer practice to explore the platform.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => router.push('/setup')}
                className="px-6 py-3 bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                Create Study
              </button>

              <button
                onClick={handleInterviewerPractice}
                className="px-6 py-3 border border-violet-700/50 text-violet-400 hover:bg-violet-900/30 rounded-xl transition-colors flex items-center gap-2"
              >
                <Briefcase size={18} />
                Interviewer Practice
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {studies.map((study, index) => (
              <motion.div
                key={study.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-stone-800/50 rounded-xl border border-stone-700 p-6 hover:border-stone-500 transition-colors relative"
              >
                {/* Menu button */}
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => setMenuOpenId(menuOpenId === study.id ? null : study.id)}
                    className="p-2 text-stone-500 hover:text-stone-400 rounded-lg hover:bg-stone-700"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {menuOpenId === study.id && (
                    <div className="absolute right-0 mt-1 w-48 bg-stone-800 border border-stone-700 rounded-xl shadow-lg z-10 overflow-hidden">
                      <button
                        onClick={() => {
                          router.push(`/studies/${study.id}`);
                          setMenuOpenId(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-stone-300 hover:bg-stone-700 flex items-center gap-2"
                      >
                        <Eye size={14} />
                        View Details
                      </button>
                      <button
                        onClick={() => {
                          // Store study config in sessionStorage for setup page
                          sessionStorage.setItem('prefillStudyConfig', JSON.stringify(study.config));
                          router.push(`/setup?prefill=edit&studyId=${study.id}`);
                          setMenuOpenId(null);
                        }}
                        disabled={study.isLocked}
                        className="w-full px-4 py-2 text-left text-sm text-stone-300 hover:bg-stone-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LinkIcon size={14} />
                        Edit & Generate Link
                      </button>
                      <button
                        onClick={() => handleDelete(study.id)}
                        disabled={deletingId === study.id || study.interviewCount > 0}
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-stone-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {deletingId === study.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div
                  className="cursor-pointer"
                  onClick={() => router.push(`/studies/${study.id}`)}
                >
                  <div className="flex items-start gap-3 mb-3 pr-8">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-lg mb-1">
                        {study.config.name}
                      </h3>
                      {study.config.description && (
                        <p className="text-sm text-stone-400 line-clamp-2">
                          {study.config.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm text-stone-500 mb-3">
                    <div className="flex items-center gap-1">
                      <Users size={14} />
                      <span>{study.interviewCount} interviews</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar size={14} />
                      <span>{formatDate(study.createdAt)}</span>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${study.isLocked
                      ? 'bg-stone-700 text-stone-400'
                      : 'bg-green-900/50 text-green-400'
                      }`}>
                      {study.isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                      {study.isLocked ? 'Locked' : 'Editable'}
                    </span>
                    <span className="px-2 py-1 text-xs rounded-full bg-stone-700 text-stone-400">
                      {study.config.coreQuestions?.length ?? 0} questions
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudyList;
