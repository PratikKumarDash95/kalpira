import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { createPasswordResetOtp, EmailDeliveryError, sendPasswordResetEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let email = '';
  let role: 'candidate' | 'interviewer' = 'candidate';

  try {
    const body = await request.json();
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Same email can own separate candidate/interviewer accounts — reset the
    // one matching the role the user chose on the login screen.
    role = body.role === 'interviewer' ? 'interviewer' : 'candidate';

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    const user = await supabaseDb.user.findFirst({ where: { email, role } });

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

    if (error instanceof EmailDeliveryError) {
      try {
        if (emailPattern.test(email)) {
          const user = await supabaseDb.user.findFirst({ where: { email, role } });
          if (user?.passwordResetOtp) {
            await supabaseDb.user.update({
              where: { id: user.id },
              data: {
                passwordResetOtp: null,
                passwordResetOtpSentAt: null,
                passwordResetOtpExpiresAt: null,
              },
            });
          }
        }
      } catch (cleanupError) {
        console.error('Forgot password cleanup error:', cleanupError);
      }

      const errorMessage = error.status === 401
        ? 'Email delivery is temporarily unavailable. Please contact support or try again after the mail service is reauthorized.'
        : error.status === 503
          ? 'Password reset email is not configured yet. Please contact support.'
          : 'Unable to deliver the password reset OTP right now. Please try again later.';

      return NextResponse.json({ error: errorMessage }, { status: 503 });
    }

    return NextResponse.json({ error: 'Failed to send password reset OTP.' }, { status: 500 });
  }
}
