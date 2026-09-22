'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
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
  Filter,
  Trash2
} from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import PageSection from '@/components/layout/PageSection';
import EmptyState from '@/components/layout/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';

const Dashboard: React.FC = () => {
  const router = useRouter();

  const [interviews, setInterviews] = useState<StoredInterview[]>([]);
  const [studies, setStudies] = useState<StoredStudy[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

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

  return (
    <PageShell width="wide" showFooter={false}>
      <PageHeader
        icon={<FolderOpen size={20} />}
        title="Interview Dashboard"
        subtitle={`${interviews.length} interview${interviews.length !== 1 ? 's' : ''} collected`}
        actions={
          <>
            <button
              onClick={() => router.push('/allinterviews')}
              className="btn-secondary px-3 py-2 text-sm"
            >
              <FolderOpen size={16} />
              View all results
            </button>
            {interviews.length > 0 && (
              <button
                onClick={handleExportAll}
                disabled={exporting}
                className="btn-primary sheen px-3 py-2 text-sm disabled:opacity-50"
              >
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                Export
              </button>
            )}
          </>
        }
      >
        {/* Study filter — the page-level control row, owned by the header. */}
        {studies.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-3">
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
          </div>
        )}
      </PageHeader>

      {warning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 p-4 bg-stone-800 border border-stone-600 rounded-xl text-stone-300 text-sm"
        >
          {warning}
        </motion.div>
      )}

      <PageSection>
        {loading ? (
          <SkeletonList rows={5} />
        ) : interviews.length === 0 ? (
          <EmptyState
            icon={<FileText size={32} />}
            title="No Interviews Yet"
            description="Completed interviews will appear here. Share participant links to start collecting data."
            action={
              <button onClick={() => router.push('/setup')} className="btn-primary sheen px-6 py-3">
                Create Study Link
              </button>
            }
          />
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
      </PageSection>
    </PageShell>
  );
};

export default Dashboard;
