import Consent from '@/components/Consent';
import RequireAuth from '@/components/RequireAuth';

export default function ConsentPage() {
  return (
    <RequireAuth redirectTo="/login">
      <Consent />
    </RequireAuth>
  );
}

