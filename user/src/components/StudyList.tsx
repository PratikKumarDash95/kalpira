'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { StoredStudy, StudyConfig } from '@/types';
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
  UserCircle,
  AlertTriangle,
  Menu,
  X,
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
  const [assignedInterviewCount, setAssignedInterviewCount] = useState(0);

  useEffect(() => {
    loadStudies();
    // Check if logged in as admin (admin password login has no researcherId)
    fetch('/api/auth')
      .then(r => r.json())
      .then(d => setIsAdmin(d.authenticated && !d.researcherId))
      .catch(() => { });

    fetch('/api/candidate/sessions')
      .then(async r => {
        if (!r.ok) return null;
        return r.json();
      })
      .then(data => {
        const assignedCount = (data?.sessions || []).filter((session: { status?: string }) => session.status === 'assigned').length;
        setAssignedInterviewCount(assignedCount);
      })
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
    router.push('/setup');
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

  // Check if demo data exists (Removed)
  // const hasDemoData = studies.some(s => s.id.startsWith('demo-'));

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const renderStudySkeleton = () => (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="skeleton-card rounded-xl border border-stone-700 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
            <div className="skeleton h-9 w-9 rounded-lg" />
          </div>
          <div className="mt-6 flex gap-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-28" />
          </div>
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-7 w-20 rounded-full" />
            <div className="skeleton h-7 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );

  const renderAssignedBadge = () => {
    if (assignedInterviewCount <= 0) return null;

    return (
      <span className="absolute -right-2 -top-2 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center shadow-lg shadow-red-500/30 ring-2 ring-white">
        {assignedInterviewCount > 99 ? '99+' : assignedInterviewCount}
      </span>
    );
  };

  return (
    <div className="kalpira-light min-h-screen p-4 sm:p-8">
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
                className="relative px-3 py-2 text-sm border border-violet-700/50 text-violet-400 hover:bg-violet-900/30 rounded-xl transition-colors flex items-center gap-2"
              >
                <Briefcase size={16} />
                Interviewer Practice
                {renderAssignedBadge()}
              </button>

              <button
                onClick={() => router.push('/dashboard')}
                className="px-3 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center gap-2"
              >
                <Users size={16} />
                All Interviews
              </button>

              <button
                onClick={() => router.push('/profile')}
                className="px-3 py-2 text-sm border border-stone-600 text-stone-400 hover:bg-stone-700 rounded-xl transition-colors flex items-center gap-2"
              >
                <UserCircle size={16} />
                Profile
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
                <button onClick={handleInterviewerPractice} className="relative px-3 py-2 text-sm bg-violet-900/50 text-violet-200 rounded-xl flex items-center gap-2 justify-center">
                  <Briefcase size={14} /> Interviewer Practice
                  {renderAssignedBadge()}
                </button>
                <button onClick={() => router.push('/dashboard')} className="px-3 py-2 text-sm bg-stone-700 text-stone-300 rounded-xl flex items-center gap-2 justify-center">
                  <Users size={14} /> All Interviews
                </button>

                <button onClick={() => router.push('/profile')} className="px-3 py-2 text-sm border border-stone-600 text-stone-400 rounded-xl flex items-center gap-2 justify-center">
                  <UserCircle size={14} /> Profile
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Storage Warning Banner */}
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
                Check Supabase project and table setup for Supabase Postgres.
              </p>
            </div>
          </motion.div>
        )}

        {/* Content */}
        {loading ? (
          renderStudySkeleton()
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
                className="relative px-6 py-3 border border-violet-700/50 text-violet-400 hover:bg-violet-900/30 rounded-xl transition-colors flex items-center gap-2"
              >
                <Briefcase size={18} />
                Interviewer Practice
                {renderAssignedBadge()}
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
