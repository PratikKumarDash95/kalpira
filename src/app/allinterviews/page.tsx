'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StoredInterview } from '@/types';
import { getAllInterviews, deleteInterview } from '@/services/storageService';
import { motion } from 'framer-motion';
import {
    Loader2,
    FileText,
    Search,
    Trash2,
    ExternalLink,
    Calendar,
    Clock,
    ArrowLeft
} from 'lucide-react';

export default function AllInterviewsPage() {
    const router = useRouter();
    const [interviews, setInterviews] = useState<StoredInterview[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadInterviews();
    }, []);

    const loadInterviews = async () => {
        try {
            setLoading(true);
            const data = await getAllInterviews();
            setInterviews(data);
        } catch (error) {
            console.error('Failed to load interviews:', error);
        } finally {
            setLoading(false);
        }
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
        <div className="min-h-screen bg-stone-950 text-stone-200 p-6 md:p-12">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="p-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-3xl font-bold text-white tracking-tight">All Results</h1>
                            <p className="text-stone-400 mt-1">
                                View detailed reports and analysis for all completed interviews
                            </p>
                        </div>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search by study or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-stone-900 border border-stone-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-700 w-full md:w-64"
                        />
                    </div>
                </div>

                {/* Content */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="animate-spin text-stone-500" size={32} />
                    </div>
                ) : filteredInterviews.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredInterviews.map((interview) => (
                            <motion.div
                                key={interview.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="group bg-stone-900/50 border border-stone-800 hover:border-stone-700 rounded-2xl p-6 transition-all hover:bg-stone-900/80"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${interview.status === 'completed'
                                                ? 'bg-green-900/20 text-green-400 border-green-900/30'
                                                : 'bg-yellow-900/20 text-yellow-400 border-yellow-900/30'
                                            }`}>
                                            {interview.status === 'completed' ? 'Completed' : 'In Progress'}
                                        </span>
                                        <h3 className="text-lg font-semibold text-white mt-3 truncate" title={interview.studyName}>
                                            {interview.studyName || 'Untitled Study'}
                                        </h3>
                                        <p className="text-xs text-stone-500 font-mono mt-1">ID: {interview.id.slice(0, 8)}</p>
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => handleDelete(interview.id, e)}
                                            className="p-2 text-stone-500 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-colors"
                                            title="Delete Result"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-6 text-xs text-stone-400">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={14} />
                                        {new Date(interview.createdAt).toLocaleDateString()}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Clock size={14} />
                                        {interview.completedAt ? (
                                            Math.round((interview.completedAt - interview.createdAt) / 1000 / 60) + ' min'
                                        ) : '-'}
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-stone-800 flex justify-between items-center">
                                    <div className="text-xs text-stone-500">
                                        {interview.transcript?.length || 0} messages
                                    </div>
                                    <a
                                        href={`/results/${interview.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-white text-stone-900 rounded-xl text-sm font-medium transition-colors"
                                    >
                                        View Report <ExternalLink size={14} />
                                    </a>
                                </div>
                            </motion.div>
                        ))}
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
