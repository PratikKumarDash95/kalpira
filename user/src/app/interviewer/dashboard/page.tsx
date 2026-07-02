'use client';

import InterviewerDashboard from '@/components/InterviewerDashboard';
import RequireAuth from '@/components/RequireAuth';

export default function InterviewerDashboardPage() {
    return (
        <RequireAuth redirectTo="/interviewer/login">
            <InterviewerDashboard />
        </RequireAuth>
    );
}
