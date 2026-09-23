import { NextResponse } from 'next/server';
import supabaseDb from '@/lib/supabaseDb';
import { createEmailVerificationToken, sendVerificationEmail } from '@/lib/email';
import { BUDGETS, accountKey, checkBudget, penalize, tooManyRequests } from '@/lib/throttle';

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

    // ── One mail budget per account ──────────────────────────────────────────
    // Same shape as forgot-password, and for the same reason: this route sends
    // mail to an address the caller names, as often as it is asked. Without a
    // budget it is a way to flood a stranger's inbox — every request drawing a
    // fresh verification link, each one invalidating the last so that a real
    // click is hard to land. The per-IP limiter bounds one address; this bounds
    // one mailbox, which is the side being harmed.
    //
    // Spent on every request past validation, because the cost here *is* the
    // work. An attacker can mint keys for addresses they do not own, but those
    // keys cost them nothing to burn and buy them no mail either.
    const budgetKey = accountKey('resend-verification', role, email);
    const budget = checkBudget(budgetKey, BUDGETS.resendVerification);
    if (!budget.allowed) {
      return NextResponse.json(
        tooManyRequests(budget, 'A verification email was sent recently. Please check your inbox, then try again shortly.'),
        { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } }
      );
    }
    penalize(budgetKey, BUDGETS.resendVerification);

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
