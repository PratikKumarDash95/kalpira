'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area
} from 'recharts';
import {
    Activity,
    Zap,
    User,
    AlertTriangle,
    CheckCircle,
    Brain,
    Timer
} from 'lucide-react';

const NAMES = ['Alex', 'Sarah', 'Jordan', 'Taylor', 'Casey'];

const generateDataPoint = (time: number) => ({
    time,
    confidence: 60 + Math.random() * 30,
    technicalDepth: 50 + Math.random() * 40,
    fatigue: 20 + Math.random() * 20 + (time * 0.5) // Fatigue increases over time
});

const LiveMonitor: React.FC = () => {
    const [data, setData] = useState<any[]>([]);
    const [activeCandidates, setActiveCandidates] = useState<number>(3);
    const [alerts, setAlerts] = useState<string[]>([]);

    // Simulate live data stream
    useEffect(() => {
        let tick = 0;

        // Initial data
        const initialData = Array.from({ length: 20 }).map((_, i) => generateDataPoint(i));
        setData(initialData);
        tick = 20;

        const interval = setInterval(() => {
            setData(prev => {
                const newData = [...prev.slice(1), generateDataPoint(tick++)];

                // Randomly trigger alerts
                if (Math.random() > 0.9) {
                    const candidate = NAMES[Math.floor(Math.random() * NAMES.length)];
                    const alertType = Math.random() > 0.5 ? 'Avoidance Detected' : 'Scripted Response Suspected';
                    setAlerts(prevAlerts => [`[${new Date().toLocaleTimeString()}] ${candidate}: ${alertType}`, ...prevAlerts.slice(0, 4)]);
                }

                return newData;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="bg-stone-950 p-6 min-h-screen text-white">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-900/20 flex items-center justify-center border border-red-500/30">
                            <Activity className="text-red-500 animate-pulse" size={20} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">Mission Control</h1>
                            <p className="text-xs text-stone-500 uppercase tracking-wider">Live Interview Monitoring</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="text-center">
                            <div className="text-2xl font-bold">{activeCandidates}</div>
                            <div className="text-xs text-stone-500">Active Candidates</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-400">92%</div>
                            <div className="text-xs text-stone-500">System Health</div>
                        </div>
                    </div>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Main Chart */}
                    <div className="lg:col-span-2 bg-stone-900/50 border border-stone-800 rounded-xl p-6">
                        <h3 className="text-sm font-medium text-stone-400 mb-4 flex items-center gap-2">
                            <Brain size={16} /> Aggregate Sentiment & Depth
                        </h3>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={data}>
                                    <defs>
                                        <linearGradient id="colorConf" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorTech" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis dataKey="time" hide />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1c1917', borderColor: '#444' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="confidence"
                                        stroke="#8b5cf6"
                                        fillOpacity={1}
                                        fill="url(#colorConf)"
                                        name="Confidence"
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="technicalDepth"
                                        stroke="#10b981"
                                        fillOpacity={1}
                                        fill="url(#colorTech)"
                                        name="Tech Depth"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Alert Feed */}
                    <div className="bg-stone-900/50 border border-stone-800 rounded-xl p-6">
                        <h3 className="text-sm font-medium text-stone-400 mb-4 flex items-center gap-2">
                            <AlertTriangle size={16} /> Live Alerts
                        </h3>
                        <div className="space-y-3">
                            <motion.div
                                layout
                                className="space-y-2"
                            >
                                {alerts.map((alert, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="p-3 bg-red-900/10 border border-red-900/20 rounded-lg text-xs text-red-200 flex items-start gap-2"
                                    >
                                        <Zap size={12} className="mt-0.5 flex-shrink-0" />
                                        {alert}
                                    </motion.div>
                                ))}
                                {alerts.length === 0 && (
                                    <div className="text-stone-600 text-sm text-center py-10">No active alerts</div>
                                )}
                            </motion.div>
                        </div>
                    </div>
                </div>

                {/* Candidate List */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="bg-stone-900/50 border border-stone-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center">
                                        <User size={16} className="text-stone-300" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm">{NAMES[i]}</div>
                                        <div className="text-xs text-stone-500">System Design Interview</div>
                                    </div>
                                </div>
                                <div className="px-2 py-1 bg-green-900/20 text-green-400 text-xs rounded-full border border-green-900/30 flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                    Live
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-xs text-stone-400 mb-1">
                                        <span>Scripting Likelihood</span>
                                        <span>12%</span>
                                    </div>
                                    <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-green-500 w-[12%]" />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs text-stone-400 mb-1">
                                        <span>Fatigue Level</span>
                                        <span>{Math.round(20 + Math.random() * 10)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 w-[25%]" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LiveMonitor;
