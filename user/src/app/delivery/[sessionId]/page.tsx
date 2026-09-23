import type { Metadata } from 'next';
import DeliveryReport from '@/components/DeliveryReport';
import RequireAuth from '@/components/RequireAuth';

export const metadata: Metadata = {
  title: 'Delivery report — Kalpira',
  description:
    'What was measured about how you answered — pace, pauses, vocal variation and picture quality — with the healthy range for each measurement and what it changed.',
};

interface Props {
  params: Promise<{ sessionId: string }>;
}

// Thin wrapper, as with /ability: page identity lives here and the screen is the
// component, so it can be embedded in a dashboard panel without a second route.
export default async function DeliveryReportPage({ params }: Props) {
  const { sessionId } = await params;

  return (
    <RequireAuth>
      <DeliveryReport sessionId={sessionId} />
    </RequireAuth>
  );
}
