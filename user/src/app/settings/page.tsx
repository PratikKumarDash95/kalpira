import Settings from '@/components/Settings';
import RequireAuth from '@/components/RequireAuth';

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}
