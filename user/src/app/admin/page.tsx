import type { Metadata } from 'next';
import { Shield } from 'lucide-react';
import PageShell from '@/components/layout/PageShell';
import PageHeader from '@/components/layout/PageHeader';
import EmptyState from '@/components/layout/EmptyState';

export const metadata: Metadata = {
  title: 'Admin console — Kalpira',
  description: 'Where the Kalpira admin console lives.',
};

/**
 * The admin console is a separate app on its own origin, and this route used to
 * redirect the browser to it.
 *
 * It no longer does, deliberately. The session cookie is valid on every port, so
 * a cross-port redirect is exactly how one role ends up inside another role's
 * app: an admin could be moved from the console into this app, and this app
 * could move them back. No portal in this product navigates another one, so this
 * page says where the console is instead of taking the browser there. An
 * administrator can also reach it from the header's Admin link.
 */
export default function AdminPage() {
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';

  return (
    <PageShell width="narrow">
      <PageHeader
        back="/studies"
        icon={<Shield size={20} />}
        title="Admin"
        subtitle="Not part of this app"
      />
      <EmptyState
        icon={<Shield size={30} />}
        title="The admin console is a separate app"
        description={`It runs at ${adminUrl} and requires an administrator account. Open it there — nothing on this page redirects you to it.`}
      />
    </PageShell>
  );
}
