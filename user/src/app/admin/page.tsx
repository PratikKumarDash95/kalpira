import { redirect } from 'next/navigation';

export default function AdminPage() {
  redirect(process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001');
}
