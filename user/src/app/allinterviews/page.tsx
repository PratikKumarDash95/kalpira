'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StoredInterview } from '@/types';
import { getAllInterviewsPage, deleteInterview } from '@/services/storageService';
import { throttle } from '@/lib/rateControl';
import { motion } from 'framer-motion';
import RequireAuth from '@/components/RequireAuth';
import {
    FileText,
    Search,
    Trash2,
    ExternalLink,
    Calendar,
    Clock,
    ArrowLeft,
    Loader2,
    ChevronDown
} from 'lucide-react';

const INITIAL_BATCH_SIZE = 6;
const SCROLL_BATCH_SIZE = 3;
const SCROLL_IDLE_MS = 120;
const SCROLL_THROTTLE_MS = 100;
const LOAD_DELAY_MS = 20;
const BOTTOM_THRESHOLD_PX = 500;

export default function AllInterviewsPage() {
    return (
        <RequireAuth>
            <AllInterviewsContent />
        </RequireAuth>
    );
}

function AllInterviewsContent() {
    const router = useRouter();
    const [interviews, setInterviews] = useState<StoredInterview[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const scrollIdleTimerRef = useRef<number | null>(null);
    const loadLoopTimerRef = useRef<number | null>(null);
    const isScrollingRef = useRef(false);
    const loadingRef = useRef(loading);
    const loadingMoreRef = useRef(loadingMore);
    const hasMoreRef = useRef(hasMore);
    const offsetRef = useRef(offset);

    useEffect(() => {
        loadingRef.current = loading;
    }, [loading]);

    useEffect(() => {
        loadingMoreRef.current = loadingMore;
    }, [loadingMore]);

    useEffect(() => {
        hasMoreRef.current = hasMore;
    }, [hasMore]);

    useEffect(() => {
        offsetRef.current = offset;
    }, [offset]);

    useEffect(() => {
        loadInitialInterviews();
    }, []);

    useEffect(() => {
        // Throttled: scroll fires far more often than the near-bottom check
        // (a layout read) or the idle-timer reset needs to run.
        const onScroll = throttle(() => {
            isScrollingRef.current = true;

            if (scrollIdleTimerRef.current !== null) {
                window.clearTimeout(scrollIdleTimerRef.current);
            }

            scrollIdleTimerRef.current = window.setTimeout(() => {
                isScrollingRef.current = false;
                if (loadLoopTimerRef.current !== null) {
                    window.clearTimeout(loadLoopTimerRef.current);
                    loadLoopTimerRef.current = null;
                }
            }, SCROLL_IDLE_MS);

            if (isNearBottom()) {
                void ensureScrollLoading();
            }
        }, SCROLL_THROTTLE_MS);

        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (scrollIdleTimerRef.current !== null) {
                window.clearTimeout(scrollIdleTimerRef.current);
            }
            if (loadLoopTimerRef.current !== null) {
                window.clearTimeout(loadLoopTimerRef.current);
            }
        };
    }, []);

    const loadInitialInterviews = async () => {
        try {
            setLoading(true);
            const page = await getAllInterviewsPage({ summary: true, limit: INITIAL_BATCH_SIZE, offset: 0 });
            setInterviews(page.interviews);
            setOffset(page.pagination.nextOffset);
            setHasMore(page.pagination.hasMore);
            offsetRef.current = page.pagination.nextOffset;
            hasMoreRef.current = page.pagination.hasMore;
        } catch (error) {
            console.error('Failed to load interviews:', error);
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    };

    const isNearBottom = () => {
        if (typeof window === 'undefined') return false;
        const doc = document.documentElement;
        return window.innerHeight + window.scrollY >= doc.scrollHeight - BOTTOM_THRESHOLD_PX;
    };

    const loadMoreInterviews = async () => {
        if (loadingMoreRef.current || loadingRef.current || !hasMoreRef.current) return false;

        try {
            setLoadingMore(true);
            loadingMoreRef.current = true;
            const page = await getAllInterviewsPage({ summary: true, limit: SCROLL_BATCH_SIZE, offset: offsetRef.current });
            setInterviews(prev => [...prev, ...page.interviews]);
            setOffset(page.pagination.nextOffset);
            setHasMore(page.pagination.hasMore);
            offsetRef.current = page.pagination.nextOffset;
            hasMoreRef.current = page.pagination.hasMore;
            return page.interviews.length > 0;
        } catch (error) {
            console.error('Failed to load more interviews:', error);
            return false;
        } finally {
            setLoadingMore(false);
            loadingMoreRef.current = false;
        }
    };

    const ensureScrollLoading = async () => {
        if (loadLoopTimerRef.current !== null || loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) {
            return;
        }

        const tick = async () => {
            loadLoopTimerRef.current = null;

            if (!isScrollingRef.current || !isNearBottom() || loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) {
                return;
            }

            const loaded = await loadMoreInterviews();
            if (loaded && isScrollingRef.current && isNearBottom() && hasMoreRef.current) {
                loadLoopTimerRef.current = window.setTimeout(() => {
                    void tick();
                }, LOAD_DELAY_MS);
            }
        };

        loadLoopTimerRef.current = window.setTimeout(() => {
            void tick();
        }, LOAD_DELAY_MS);
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this interview result?')) return;

        try {
            const result = await deleteInterview(id);
            if (result.success) {
                setInterviews(prev => prev.filter(i => i.id !== id));
            } else {
                alert('Failed to delete interview');
            }
        } catch (error) {
            console.error('Error deleting:', error);
            alert('Error deleting interview');
        }
    };

    const filteredInterviews = interviews.filter(i =>
        i.studyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.id.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-stone-950 text-stone-200 p-4 sm:p-8 md:p-12">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-4">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="flex-shrink-0 p-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="min-w-0">
                            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate">All Results</h1>
                            <p className="text-stone-400 mt-1">
                                View detailed reports and analysis for all completed interviews
                            </p>
                        </div>
                    </div>

                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search by study or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-stone-900 border border-stone-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-700"
                        />
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div key={index} className="skeleton-card h-full rounded-2xl border border-stone-800 p-5 sm:p-6">
                                <div className="mb-4 flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="skeleton mb-4 h-7 w-24 rounded-full" />
                                        <div className="skeleton mb-2 h-6 w-4/5" />
                                        <div className="skeleton h-4 w-24" />
                                    </div>
                                    <div className="skeleton h-9 w-9 rounded-lg" />
                                </div>
                                <div className="mb-6 grid grid-cols-2 gap-4">
                                    <div className="skeleton h-4 w-24" />
                                    <div className="skeleton h-4 w-20" />
                                </div>
                                <div className="flex items-center justify-between border-t border-stone-800 pt-4">
                                    <div className="skeleton h-4 w-20" />
                                    <div className="skeleton h-10 w-28 rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : interviews.length > 0 ? (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                            <span>Loaded newest first</span>
                            <span>{interviews.length} interviews loaded</span>
                        </div>

                        {filteredInterviews.length > 0 ? (
                            <div className="grid grid-cols-1 auto-rows-fr md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {filteredInterviews.map((interview) => (
                                <motion.div
                                    key={interview.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="group flex h-full min-w-0 flex-col overflow-hidden bg-stone-900/50 border border-stone-800 hover:border-stone-700 rounded-2xl p-5 sm:p-6 transition-all hover:bg-stone-900/80"
                                >
                                    <div className="flex min-w-0 justify-between items-start gap-3 mb-4">
                                        <div className="min-w-0 flex-1">
                                            <span className={`text-xs font-medium px-2 py-1 rounded-full border ${interview.status === 'completed'
                                                    ? 'bg-green-900/20 text-green-400 border-green-900/30'
                                                    : 'bg-yellow-900/20 text-yellow-400 border-yellow-900/30'
                                                }`}>
                                                {interview.status === 'completed' ? 'Completed' : 'In Progress'}
                                            </span>
                                            <h3 className="text-lg font-semibold text-white mt-3 truncate max-w-full" title={interview.studyName}>
                                                {interview.studyName || 'Untitled Study'}
                                            </h3>
                                            <p className="text-xs text-stone-500 font-mono mt-1 truncate">ID: {interview.id.slice(0, 8)}</p>
                                        </div>
                                        <div className="flex flex-shrink-0 gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => handleDelete(interview.id, e)}
                                                className="p-2 text-stone-500 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors"
                                                title="Delete Result"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 mb-6 text-xs text-stone-400 sm:grid-cols-2 sm:gap-4">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Calendar size={14} className="flex-shrink-0" />
                                            {new Date(interview.createdAt).toLocaleDateString()}
                                        </div>
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Clock size={14} className="flex-shrink-0" />
                                            {interview.completedAt ? (
                                                Math.round((interview.completedAt - interview.createdAt) / 1000 / 60) + ' min'
                                            ) : '-'}
                                        </div>
                                    </div>

                                    <div className="mt-auto flex flex-col gap-3 border-t border-stone-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="text-xs text-stone-500">
                                            {interview.messageCount ?? interview.transcript?.length ?? 0} messages
                                        </div>
                                        <a
                                            href={`/results/${interview.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-100 px-4 py-2 text-sm font-medium text-stone-900 transition-colors hover:bg-white sm:w-auto"
                                        >
                                            View Report <ExternalLink size={14} />
                                        </a>
                                    </div>
                                </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-stone-500">
                                <FileText size={40} className="mx-auto mb-3 opacity-20" />
                                <p>No loaded interviews match this search.</p>
                            </div>
                        )}

                        {hasMore && (
                            <div className="flex items-center justify-center gap-2 text-xs text-stone-500">
                                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
                                Scroll near the bottom to load older interviews
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-20 text-stone-500">
                        <FileText size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No interview results found</p>
                    </div>
                )}
            </div>
        </div>
    );
}
