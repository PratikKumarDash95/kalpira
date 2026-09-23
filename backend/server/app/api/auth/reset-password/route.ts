import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { hashPassword } from '@/lib/auth';
import { verifyPasswordResetOtp } from '@/lib/email';
import { validatePasswordPolicy } from '@/lib/passwordPolicy';
import { BUDGETS, accountKey, checkBudget, clearBudget, penalize, tooManyRequests } from '@/lib/throttle';

export const dynamic = 'force-dynamic';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const otpPattern = /^\d{6}$/;

/**
 * Wrong codes allowed for one emailed OTP before it is thrown away.
 *
 * The code space is ten to the sixth. Five guesses is a five-in-a-million
 * chance, and the cost of missing is that the account holder asks for a new
 * code — which is also what happens when they simply mistype five times, and
 * which resets this counter to zero. There is no permanent lockout to inherit.
 */
const MAX_OTP_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'interviewer' ? 'interviewer' : 'candidate';
    const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!emailPattern.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    if (!otpPattern.test(otp)) {
      return NextResponse.json({ error: 'Enter the 6-digit OTP code.' }, { status: 400 });
    }

    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
    }

    // ── The guess budget, checked before anything is looked up ───────────────
    //
    // This route is a password reset guarded by six digits. It had no limit of
    // any kind: a script could walk the million-value space inside the 15-minute
    // validity window and then set its own password on the account. Two limits
    // stand here now, and they cover each other's blind spots —
    //
    //   · this per-account budget, which is what a *distributed* guesser runs
    //     into (thousands of addresses, each under the per-IP limit, all aimed
    //     at one mailbox);
    //   · `passwordResetOtpAttempts` on the user row, which is what survives a
    //     process restart and bounds the count even across instances.
    //
    // The budget is spent only once a code has actually been checked, so a
    // mistyped new password costs the account holder nothing. Everything above
    // this line is shape and policy validation — it can neither guess nor mail.
    const budgetKey = accountKey('reset-otp', role, email);
    const budget = checkBudget(budgetKey, BUDGETS.resetOtp);
    if (!budget.allowed) {
      return NextResponse.json(
        tooManyRequests(budget, 'Too many attempts for this account. Please request a new code.'),
        { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } }
      );
    }

    const user = await supabaseDb.user.findFirst({ where: { email, role } });

    const expiresAt = user?.passwordResetOtpExpiresAt
      ? new Date(user.passwordResetOtpExpiresAt).getTime()
      : 0;
    const hasLiveOtp = Boolean(user?.passwordResetOtp) && expiresAt > Date.now();
    const codeMatches = hasLiveOtp && verifyPasswordResetOtp(otp, user!.passwordResetOtp);

    if (!hasLiveOtp || !codeMatches) {
      penalize(budgetKey, BUDGETS.resetOtp);

      // Count the miss against the *account*, not the connection — but only
      // while there is a live code to guess at. Misses against an expired or
      // absent code cannot lead anywhere, and counting them would let a stranger
      // exhaust a reset the account holder has not even started.
      if (user && hasLiveOtp) {
        const attempts = Number(user.passwordResetOtpAttempts ?? 0) + 1;

        if (attempts >= MAX_OTP_ATTEMPTS) {
          // Spend the code. Further guesses now target nothing, so the remaining
          // 999,995 values are worthless, and the account holder's next request
          // issues a fresh code with a fresh budget.
          await supabaseDb.user.update({
            where: { id: user.id },
            data: {
              passwordResetOtp: null,
              passwordResetOtpSentAt: null,
              passwordResetOtpExpiresAt: null,
              passwordResetOtpAttempts: 0,
            },
          });
        } else {
          await supabaseDb.user.update({
            where: { id: user.id },
            data: { passwordResetOtpAttempts: attempts },
          });
        }
      }

      // One message for every failure mode. Which of "no such account", "no code
      // in flight", "code expired" and "wrong code" it was is not the caller's
      // business, and telling them apart would turn this route into an account
      // oracle.
      return NextResponse.json({ error: 'Invalid or expired OTP code.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    await supabaseDb.user.update({
      where: { id: user!.id },
      data: {
        password: passwordHash,
        passwordResetOtp: null,
        passwordResetOtpSentAt: null,
        passwordResetOtpExpiresAt: null,
        passwordResetOtpAttempts: 0,
      },
    });

    clearBudget(budgetKey);

    return NextResponse.json({
      success: true,
      message: 'Password updated. You can sign in now.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Failed to update password.' }, { status: 500 });
  }
}
