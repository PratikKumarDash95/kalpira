'use client';

import InterviewerBilling from '@/components/InterviewerBilling';
import RequireAuth from '@/components/RequireAuth';

export default function BillingPage() {
    return (
        <RequireAuth redirectTo="/login?role=interviewer">
            <InterviewerBilling />
        </RequireAuth>
    );
}
