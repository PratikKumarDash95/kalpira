import type { Metadata } from 'next';
import CoachDashboard from '@/components/dashboard/CoachDashboard';
import RequireAuth from '@/components/RequireAuth';

export const metadata: Metadata = {
    title: 'Interview Coach Dashboard | AI Interview Intelligence',
    description: 'Track your interview readiness, weak skills, improvement roadmap, and achievements with AI-powered coaching analytics.',
};

export default function CoachDashboardPage() {
    return (
        <RequireAuth>
            <CoachDashboard />
        </RequireAuth>
    );
}
