import type { Metadata } from 'next';
import DeliveryProfile from '@/components/DeliveryProfile';
import RequireAuth from '@/components/RequireAuth';

export const metadata: Metadata = {
  title: 'Delivery profile — Kalpira',
  description:
    'How delivery was measured: pace, pauses, fillers and picture quality, each with the number of answers it was measured on.',
};

interface Props {
  // Next hands a server page its query string directly, which keeps the reader's
  // identity out of a client hook. What arrives is a session, not a person: the
  // server resolves who sat it and decides whether the caller may see them.
  searchParams: Promise<{ sessionId?: string }>;
}

// Thin wrapper: page identity lives here, the screen itself is the component, so it
// can be embedded elsewhere without a route — the same split the ability map uses.
//
// Bare `/delivery` is the signed-in person's own profile. `/delivery?sessionId=…` is
// an interviewer looking at a candidate, and the server scopes that answer to the
// caller's own studies — a profile otherwise spans every answer the person has given
// here, including in another interviewer's study.
export default async function DeliveryProfilePage({ searchParams }: Props) {
  const { sessionId } = await searchParams;

  return (
    <RequireAuth>
      <DeliveryProfile sessionId={sessionId} />
    </RequireAuth>
  );
}
