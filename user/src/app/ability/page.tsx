import type { Metadata } from 'next';
import AbilityMap from '@/components/AbilityMap';
import RequireAuth from '@/components/RequireAuth';

export const metadata: Metadata = {
  title: 'Ability map — Kalpira',
  description:
    'Your measured competency profile: estimated ability per competency with its confidence interval, prerequisite effects, and what to work on next.',
};

// Thin wrapper: page identity lives here, the screen itself is the component,
// so it can be embedded elsewhere (e.g. a dashboard panel) without a route.
//
// `redirectTo` is the route to bounce a signed-out visitor to, not a return URL —
// the guard calls router.replace(redirectTo), so the default (/login) is what a
// protected page wants. Passing '/ability' here would redirect the page to itself.
export default function AbilityPage() {
  return (
    <RequireAuth>
      <AbilityMap />
    </RequireAuth>
  );
}
