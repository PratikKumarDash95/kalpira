import Export from '@/components/Export';
import RequireAuth from '@/components/RequireAuth';

export default function ExportPage() {
  return (
    <RequireAuth redirectTo="/login">
      <Export />
    </RequireAuth>
  );
}

