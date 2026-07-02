import StudyDetail from '@/components/StudyDetail';
import RequireAuth from '@/components/RequireAuth';

interface StudyPageProps {
  params: Promise<{ id: string }>;
}

export default async function StudyPage({ params }: StudyPageProps) {
  const { id } = await params;
  return (
    <RequireAuth>
      <StudyDetail studyId={id} />
    </RequireAuth>
  );
}
