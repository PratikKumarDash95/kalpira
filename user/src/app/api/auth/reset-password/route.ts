import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { hashPassword } from '@/lib/auth';
import { hashPasswordResetOtp } from '@/lib/email';

export const dynamic = 'force-dynamic';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const otpPattern = /^\d{6}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!otpPattern.test(otp)) {
      return NextResponse.json({ error: 'Enter the 6-digit OTP code.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    if (password.length > 256) {
      return NextResponse.json({ error: 'Password is too long.' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
    }

    const user = await supabaseDb.user.findUnique({ where: { email } });
    const hashedOtp = hashPasswordResetOtp(otp);

    if (
      !user ||
      !user.passwordResetOtp ||
      user.passwordResetOtp !== hashedOtp ||
      !user.passwordResetOtpExpiresAt ||
      new Date(user.passwordResetOtpExpiresAt).getTime() < Date.now()
    ) {
      return NextResponse.json({ error: 'Invalid or expired OTP code.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    await supabaseDb.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        passwordResetOtp: null,
        passwordResetOtpSentAt: null,
        passwordResetOtpExpiresAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Password updated. You can sign in now.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Failed to update password.' }, { status: 500 });
  }
}
