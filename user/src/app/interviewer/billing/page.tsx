'use client';

import InterviewerBilling from '@/components/InterviewerBilling';
import RequireAuth from '@/components/RequireAuth';

export default function InterviewerBillingPage() {
    return (
        <RequireAuth redirectTo="/interviewer/login">
            <InterviewerBilling />
        </RequireAuth>
    );
}
