import Synthesis from '@/components/Synthesis';
import RequireAuth from '@/components/RequireAuth';

export default function SynthesisPage() {
  return (
    <RequireAuth redirectTo="/login">
      <Synthesis />
    </RequireAuth>
  );
}

