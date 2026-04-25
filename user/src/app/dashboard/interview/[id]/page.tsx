'use client';

import { useParams } from 'next/navigation';
import InterviewDetail from '@/components/InterviewDetail';

export default function InterviewDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return <InterviewDetail interviewId={id} />;
}
