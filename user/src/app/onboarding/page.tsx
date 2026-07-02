import Onboarding from '@/components/Onboarding';
import RequireAuth from '@/components/RequireAuth';

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <Onboarding />
    </RequireAuth>
  );
}
