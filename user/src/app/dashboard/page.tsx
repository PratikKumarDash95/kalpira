import Dashboard from '@/components/Dashboard';
import RequireAuth from '@/components/RequireAuth';

export default function DashboardPage() {
  return (
    <RequireAuth>
      <div className="kalpira-light min-h-screen"><Dashboard /></div>
    </RequireAuth>
  );
}
