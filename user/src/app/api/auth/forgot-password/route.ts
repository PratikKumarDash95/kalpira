import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { createPasswordResetOtp, sendPasswordResetEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    const user = await supabaseDb.user.findUnique({ where: { email } });

    if (!user || !user.password) {
      return NextResponse.json({
        success: true,
        message: 'If an account exists for this email, an OTP has been sent.',
      });
    }

    const { otp, hashedOtp, expiresAt } = createPasswordResetOtp();
    const now = new Date();

    await supabaseDb.user.update({
      where: { id: user.id },
      data: {
        passwordResetOtp: hashedOtp,
        passwordResetOtpSentAt: now,
        passwordResetOtpExpiresAt: expiresAt,
      },
    });

    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      otp,
    });

    return NextResponse.json({
      success: true,
      message: 'If an account exists for this email, an OTP has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Failed to send password reset OTP.' }, { status: 500 });
  }
}
