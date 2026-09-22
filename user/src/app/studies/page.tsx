import StudyList from '@/components/StudyList';
import RequireAuth from '@/components/RequireAuth';

export default function StudiesPage() {
  return (
    <RequireAuth>
      <StudyList />
    </RequireAuth>
  );
}
