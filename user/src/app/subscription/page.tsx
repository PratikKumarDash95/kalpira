'use client';

import CandidateBilling from '@/components/CandidateBilling';
import RequireAuth from '@/components/RequireAuth';

export default function SubscriptionPage() {
    return (
        <RequireAuth redirectTo="/login">
            <CandidateBilling />
        </RequireAuth>
    );
}
