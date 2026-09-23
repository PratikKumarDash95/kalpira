import type { Metadata } from 'next';
import DeliveryProfile from '@/components/DeliveryProfile';
import RequireAuth from '@/components/RequireAuth';

export const metadata: Metadata = {
  title: 'Candidate delivery — Kalpira',
};

interface Props {
  searchParams: Promise<{ sessionId?: string }>;
}

// The interviewer portal's route to the same screen the candidate sees. The
// `sessionId` is required here — an interviewer has no profile of their own to show
// on this page — and the server scopes the answer to the caller's own studies.
export default async function InterviewerDeliveryPage({ searchParams }: Props) {
  const { sessionId } = await searchParams;

  return (
    <RequireAuth redirectTo="/interviewer/login">
      <DeliveryProfile sessionId={sessionId} />
    </RequireAuth>
  );
}
