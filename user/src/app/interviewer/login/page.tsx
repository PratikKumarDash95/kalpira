import { Suspense } from 'react';
import InterviewerLogin from '@/components/InterviewerLogin';
import { Loader2 } from 'lucide-react';

export default function InterviewerLoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-violet-400" />
            </div>
        }>
            <InterviewerLogin />
        </Suspense>
    );
}

export const metadata = {
    title: 'Interviewer Sign In | OpenInterviewer',
    description: 'Sign in to your interviewer account to manage interviews and view candidate results.',
};
