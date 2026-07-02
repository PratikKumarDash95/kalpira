import StudyList from '@/components/StudyList';
import RequireAuth from '@/components/RequireAuth';

export default function StudiesPage() {
  return (
    <RequireAuth>
      <div className="kalpira-light min-h-screen"><StudyList /></div>
    </RequireAuth>
  );
}
