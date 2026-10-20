'use client';

import InterviewerStudyDetail from '@/components/InterviewerStudyDetail';
import RequireAuth from '@/components/RequireAuth';

export default function InterviewerStudyPage() {
    return (
        <RequireAuth redirectTo="/interviewer/login">
            <InterviewerStudyDetail />
        </RequireAuth>
    );
}

