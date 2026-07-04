import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { hashEmailVerificationToken } from '@/lib/email';

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const email = url.searchParams.get('email')?.trim().toLowerCase();

  const redirectUrl = new URL('/login', getBaseUrl());

  if (!token || !email) {
    redirectUrl.searchParams.set('error', 'verification_invalid');
    return NextResponse.redirect(redirectUrl);
  }

  const hashedToken = hashEmailVerificationToken(token);
  // The verification token is unique per row, so match on (email, token) to
  // pick the exact account even when a candidate and interviewer share the
  // email. findFirst (not findUnique) since email alone is no longer unique.
  const user = await supabaseDb.user.findFirst({
    where: { email, emailVerificationToken: hashedToken },
  });

  if (!user || user.emailVerificationToken !== hashedToken) {
    redirectUrl.searchParams.set('error', 'verification_invalid');
    return NextResponse.redirect(redirectUrl);
  }

  await supabaseDb.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationSentAt: null,
    },
  });

  redirectUrl.searchParams.set('verified', '1');
  if (user.role === 'interviewer') {
    redirectUrl.searchParams.set('role', 'interviewer');
  }
  return NextResponse.redirect(redirectUrl);
}
