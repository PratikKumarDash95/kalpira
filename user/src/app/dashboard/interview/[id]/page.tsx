'use client';

import { useParams } from 'next/navigation';
import InterviewDetail from '@/components/InterviewDetail';
import RequireAuth from '@/components/RequireAuth';

export default function InterviewDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <RequireAuth>
      <InterviewDetail interviewId={id} />
    </RequireAuth>
  );
}
