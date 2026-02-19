import { Suspense } from 'react';
import Login from '@/components/Login';

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
