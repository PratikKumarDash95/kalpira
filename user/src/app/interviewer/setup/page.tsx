'use client';

import { Suspense } from 'react';
import StudySetup from '@/components/StudySetup';
import { Loader2 } from 'lucide-react';

// The interviewer setup page reuses the same StudySetup component.
// After saving, the study is owned by the interviewer (role=interviewer user).
// The StudySetup component calls /api/studies which uses the session cookie
// to attribute the study to the logged-in user.
export default function InterviewerSetupPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-violet-400" />
            </div>
        }>
            <StudySetup />
        </Suspense>
    );
}
