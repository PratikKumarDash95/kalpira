'use client';
import { apiFetch, apiUrl } from '@/lib/apiClient';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { StoredInterview, StoredStudy } from '@/types';
import { getAllInterviews, exportAllInterviews, getStudyInterviews, getAllStudies, deleteInterview } from '@/services/storageService';
import {
  Loader2,
  FileText,
  Download,
  Eye,
  Clock,
  MessageSquare,
  Lightbulb,
  FolderOpen,
  UserCircle,
  Filter,
  BookOpen,
  Menu,
  X,
  Shield,
  Trash2
} from 'lucide-react';

const Dashboard: React.FC = () => {
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [interviews, setInterviews] = useState<StoredInterview[]>([]);
  const [studies, setStudies] = useState<StoredStudy[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Check admin status on mount
  useEffect(() => {
    apiFetch('/api/auth')
      .then(r => r.json())
      .then(d => setIsAdmin(d.authenticated && !d.researcherId))
      .catch(() => { });
  }, []);

  // Load studies on mount
  useEffect(() => {
    loadStudies();
  }, []);

  // Load interviews when study filter changes
  useEffect(() => {
    loadInterviews(selectedStudyId);
  }, [selectedStudyId]);

  const loadStudies = async () => {
    try {
      const { studies: data } = await getAllStudies();
      setStudies(data);
    } catch (error) {
      console.error('Error loading studies:', error);
    }
  };

  const loadInterviews = async (studyId: string | null) => {
    setLoading(true);
    try {
      const data = studyId
        ? await getStudyInterviews(studyId, { summary: true })
        : await getAllInterviews({ summary: true });
      setInterviews(data);
    } catch (error) {
      console.error('Error loading interviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const blob = await exportAllInterviews();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `interviews-export-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting:', error);
    } finally {
      setExporting(false);
    }
  };

  const handleViewInterview = (id: string) => {
    router.push(`/dashboard/interview/${id}`);
  };

  const handleDeleteInterview = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this interview? This action cannot be undone.')) {
      return;
    }

    try {
      const result = await deleteInterview(id);
      if (result.success) {
        setInterviews(prev => prev.filter(i => i.id !== id));
      } else {
        alert(result.error || 'Failed to delete interview');
      }
    } catch (error) {
      console.error('Error deleting interview:', error);
      alert('Failed to delete interview');
    }
  };

  const formatDuration = (start: number, end: number) => {
    const minutes = Math.round((end - start) / 1000 / 60);
    return `${minutes} min`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderDashboardSkeleton = () => (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="skeleton-card rounded-xl border border-stone-700 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex items-center gap-3">
                <div className="skeleton h-5 w-48 max-w-[55%]" />
                <div className="skeleton h-6 w-20 rounded-full" />
              </div>
              <div className="skeleton mb-3 h-4 w-2/3" />
              <div className="skeleton mb-4 h-12 w-full rounded-lg" />
              <div className="flex flex-wrap gap-4">
                <div className="skeleton h-4 w-20" />
                <div className="skeleton h-4 w-16" />
                <div className="skeleton hidden h-4 w-28 sm:block" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="skeleton h-9 w-9 rounded-lg" />
              <div className="skeleton h-9 w-9 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );



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
                <FolderOpen className="text-stone-300" size={20} />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-3xl font-bold text-white truncate">Interview Dashboard</h1>
                <p className="text-stone-400 text-sm">
                  {interviews.length} interview{interviews.length !== 1 ? 's' : ''} collected
                </p>
              </div>
            </div>

            {/* Desktop buttons */}
            <div className="hidden md:flex gap-2 flex-wrap justify-end">

              <button
                onClick={() => router.push('/allinterviews')}
                className="px-3 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center gap-2"
              >
                <FolderOpen size={16} />
                View All Results
              </button>
              <button
                onClick={() => router.push('/studies')}
                className="px-3 py-2 text-sm bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-xl transition-colors flex items-center gap-2"
              >
                <BookOpen size={16} />
                My Studies
              </button>
              {isAdmin && (
                <button
                  onClick={() => router.push('/admin')}
                  className="px-3 py-2 text-sm bg-violet-900/30 hover:bg-violet-900/50 text-violet-300 border border-violet-500/30 rounded-xl transition-colors flex items-center gap-2"
                >
                  <Shield size={16} />
                  Admin
                </button>
              )}
              {interviews.length > 0 && (
                <button
                  onClick={handleExportAll}
                  disabled={exporting}
                  className="px-3 py-2 text-sm bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  Export
                </button>
              )}
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

                <button onClick={() => router.push('/studies')} className="px-3 py-2 text-sm bg-stone-700 text-stone-300 rounded-xl flex items-center gap-2 justify-center">
                  <BookOpen size={14} /> My Studies
                </button>
                {isAdmin && (
                  <button onClick={() => router.push('/admin')} className="px-3 py-2 text-sm bg-violet-900/30 text-violet-300 border border-violet-500/30 rounded-xl flex items-center gap-2 justify-center">
                    <Shield size={14} /> Admin Panel
                  </button>
                )}
                {interviews.length > 0 && (
                  <button onClick={handleExportAll} disabled={exporting} className="px-3 py-2 text-sm bg-stone-600 text-white rounded-xl flex items-center gap-2 justify-center disabled:opacity-50">
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export
                  </button>
                )}
                <button onClick={() => router.push('/profile')} className="px-3 py-2 text-sm border border-stone-600 text-stone-400 rounded-xl flex items-center gap-2 justify-center">
                  <UserCircle size={14} /> Profile
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {warning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 p-4 bg-stone-800 border border-stone-600 rounded-xl text-stone-300 text-sm"
          >
            {warning}
          </motion.div>
        )}

        {/* Study Filter */}
        {studies.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 flex items-center gap-3"
          >
            <Filter size={16} className="text-stone-500" />
            <select
              value={selectedStudyId || ''}
              onChange={(e) => setSelectedStudyId(e.target.value || null)}
              className="px-4 py-2 bg-stone-800 border border-stone-700 rounded-xl text-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-500"
            >
              <option value="">All Studies</option>
              {studies.map((study) => (
                <option key={study.id} value={study.id}>
                  {study.config.name} ({study.interviewCount} interviews)
                </option>
              ))}
            </select>
            {selectedStudyId && (
              <button
                onClick={() => setSelectedStudyId(null)}
                className="text-sm text-stone-500 hover:text-stone-400"
              >
                Clear filter
              </button>
            )}
          </motion.div>
        )}

        {/* Content */}
        {loading ? (
          renderDashboardSkeleton()
        ) : interviews.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-stone-800/50 rounded-2xl border border-stone-700 p-12 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
              <FileText size={32} className="text-stone-500" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No Interviews Yet</h2>
            <p className="text-stone-400 mb-6">
              Completed interviews will appear here. Share participant links to start collecting data.
            </p>
            <button
              onClick={() => router.push('/setup')}
              className="px-6 py-3 bg-stone-600 hover:bg-stone-500 text-white rounded-xl transition-colors"
            >
              Create Study Link
            </button>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {interviews.map((interview, index) => (
              <motion.div
                key={interview.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-stone-800/50 rounded-xl border border-stone-700 p-4 sm:p-6 hover:border-stone-600 transition-colors cursor-pointer"
                onClick={() => handleViewInterview(interview.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="font-semibold text-white truncate max-w-full">{interview.studyName}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${interview.status === 'completed'
                        ? 'bg-stone-700 text-stone-300'
                        : 'bg-stone-600 text-stone-200'
                        }`}>
                        {interview.status}
                      </span>
                    </div>

                    {/* Participant info */}
                    {interview.participantProfile && interview.participantProfile.fields.length > 0 && (
                      <div className="text-sm text-stone-400 mb-3 truncate">
                        {interview.participantProfile.fields
                          .filter(f => f.status === 'extracted' && f.value)
                          .slice(0, 3)
                          .map(f => f.value)
                          .join(' • ')}
                      </div>
                    )}

                    {/* Key insight */}
                    {interview.synthesis?.bottomLine && (
                      <div className="flex items-start gap-2 text-sm text-stone-300 bg-stone-800 rounded-lg p-3 mb-3">
                        <Lightbulb size={16} className="text-stone-400 flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2 md:line-clamp-1 lg:line-clamp-2">{interview.synthesis.bottomLine}</span>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-stone-500">
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDuration(interview.createdAt, interview.completedAt)}
                      </div>
                      <div className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        {(interview.messageCount ?? interview.transcript.length)} msgs
                      </div>
                      <div className="hidden sm:block">
                        {formatDate(interview.createdAt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-1 sm:gap-2 flex-shrink-0">
                    <button
                      className="p-2 sm:p-2 text-stone-400 hover:text-stone-300 transition-colors bg-stone-800/50 rounded-lg sm:bg-transparent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewInterview(interview.id);
                      }}
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      className="p-2 sm:p-2 text-stone-400 hover:text-red-400 transition-colors bg-stone-800/50 rounded-lg sm:bg-transparent"
                      onClick={(e) => handleDeleteInterview(interview.id, e)}
                    >
                      <Trash2 size={18} />
                    </button>
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

export default Dashboard;
