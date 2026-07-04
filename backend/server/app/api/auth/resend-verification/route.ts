import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { createEmailVerificationToken, sendVerificationEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'interviewer' ? 'interviewer' : 'candidate';

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    const user = await supabaseDb.user.findFirst({ where: { email, role } });

    if (!user) {
      return NextResponse.json({ success: true });
    }

    if (user.emailVerifiedAt) {
      return NextResponse.json({ success: true, alreadyVerified: true });
    }

    const { rawToken, hashedToken } = createEmailVerificationToken();

    await supabaseDb.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: hashedToken,
        emailVerificationSentAt: new Date(),
      },
    });

    await sendVerificationEmail({
      email: user.email,
      name: user.name,
      role: user.role === 'interviewer' ? 'interviewer' : user.role === 'candidate' ? 'candidate' : 'researcher',
      token: rawToken,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Resend verification error:', error);
    return NextResponse.json({ error: 'Failed to resend verification email.' }, { status: 500 });
  }
}
