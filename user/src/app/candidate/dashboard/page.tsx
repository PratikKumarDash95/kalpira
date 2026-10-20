import CandidateDashboard from '@/components/CandidateDashboard';
import RequireAuth from '@/components/RequireAuth';

export default function CandidateDashboardPage() {
  return (
    <RequireAuth redirectTo="/login">
      <CandidateDashboard />
    </RequireAuth>
  );
}

