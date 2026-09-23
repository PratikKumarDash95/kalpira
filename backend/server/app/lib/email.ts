import { randomBytes, createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';

const brevoApiKey = process.env.BREVO_API_KEY;
const defaultSenderEmail = process.env.BREVO_SENDER_EMAIL;
const defaultSenderName = process.env.BREVO_SENDER_NAME || 'Kalpira';

export class EmailDeliveryError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.status = status;
  }
}

type Recipient = {
  email: string;
  name?: string | null;
};

function getBaseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

function requireBrevoConfig() {
  if (!brevoApiKey || !defaultSenderEmail) {
    throw new EmailDeliveryError(
      'Brevo is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.',
      503,
    );
  }
}

export function createEmailVerificationToken(): { rawToken: string; hashedToken: string } {
  const rawToken = randomBytes(32).toString('hex');
  const hashedToken = createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, hashedToken };
}

export function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ── The password-reset OTP is hashed with a key, not just a hash function ─────
//
// A reset OTP is six digits. That is a million possible values, which is a fine
// secret only for as long as it is not stored in a form that can be searched.
// A bare `sha256(otp)` cannot survive a database read: the whole input space is
// a million hashes, seconds of work on a laptop, and the attacker learns the
// code for every account with a reset in flight. Keying the hash with a secret
// that lives in the environment and not in the database means a leaked table is
// not a leaked OTP.
//
// The context string is mixed in so this key can never be confused with any
// other use of the same secret elsewhere in the app.
const OTP_HASH_CONTEXT = 'kalpira.password-reset-otp.v1';

function otpHashSecret(): string {
  const secret = process.env.OTP_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    // Refusing is the safe failure: falling back to an unkeyed hash here would
    // silently restore the weakness this exists to close.
    throw new Error('No secret available to hash password-reset OTPs. Set OTP_SECRET or SESSION_SECRET.');
  }
  return secret;
}

export function hashPasswordResetOtp(otp: string): string {
  return createHmac('sha256', otpHashSecret()).update(`${OTP_HASH_CONTEXT}:${otp}`).digest('hex');
}

/**
 * Compares a submitted OTP against the stored hash in constant time.
 *
 * Both sides go through Buffer.from(..., 'hex') so a stored value that is not
 * hex — an empty string, a legacy value, anything malformed — produces a
 * different length and returns false rather than throwing or matching loosely.
 */
export function verifyPasswordResetOtp(otp: string, storedHash: unknown): boolean {
  if (typeof storedHash !== 'string' || !storedHash) return false;

  const expected = Buffer.from(storedHash, 'hex');
  if (expected.length === 0) return false;

  const candidate = Buffer.from(hashPasswordResetOtp(otp), 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function createPasswordResetOtp(): { otp: string; hashedOtp: string; expiresAt: Date } {
  // randomInt is rejection-sampled and unbiased, unlike `Math.random()` — the
  // difference matters because this value is the only thing standing between a
  // stranger and a password reset.
  const otp = String(randomInt(100000, 1000000));
  const hashedOtp = hashPasswordResetOtp(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  return { otp, hashedOtp, expiresAt };
}

async function sendBrevoEmail(params: {
  to: Recipient[];
  subject: string;
  htmlContent: string;
  textContent: string;
}) {
  requireBrevoConfig();

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': brevoApiKey!,
    },
    body: JSON.stringify({
      sender: { email: defaultSenderEmail, name: defaultSenderName },
      to: params.to.map((recipient) => ({
        email: recipient.email,
        ...(recipient.name ? { name: recipient.name } : {}),
      })),
      subject: params.subject,
      htmlContent: params.htmlContent,
      textContent: params.textContent,
    }),
  });

  if (!response.ok) {
    const data = await response.text().catch(() => '');
    throw new EmailDeliveryError(
      `Brevo email send failed (${response.status}): ${data || 'Unknown error'}`,
      response.status,
    );
  }
}

export async function sendVerificationEmail(params: {
  email: string;
  name?: string | null;
  role?: 'candidate' | 'interviewer' | 'researcher';
  token: string;
}) {
  const verifyUrl = new URL('/api/auth/verify-email', getBaseUrl());
  verifyUrl.searchParams.set('token', params.token);
  verifyUrl.searchParams.set('email', params.email);

  const subject = 'Verify your email address';
  const greeting = params.name?.trim() ? `Hi ${params.name.trim()},` : 'Hi,';
  const roleLabel = params.role === 'interviewer'
    ? 'interviewer account'
    : params.role === 'candidate'
      ? 'candidate account'
      : 'account';

  await sendBrevoEmail({
    to: [{ email: params.email, name: params.name }],
    subject,
    textContent: `${greeting}

Please verify your email address to finish setting up your ${roleLabel}.

Verify email: ${verifyUrl.toString()}

If you did not create this account, you can ignore this email.`,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <p style="margin: 0 0 16px;">${greeting}</p>
        <p style="margin: 0 0 24px;">Please verify your email address to finish setting up your ${roleLabel}.</p>
        <p style="margin: 0 0 24px;">
          <a
            href="${verifyUrl.toString()}"
            style="display: inline-block; background-color: #111111; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600;"
          >
            Verify email
          </a>
        </p>
        <p style="margin: 0; color: #4b5563;">If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(params: {
  email: string;
  name?: string | null;
  otp: string;
}) {
  const subject = 'Reset your Kalpira password';
  const greeting = params.name?.trim() ? `Hi ${params.name.trim()},` : 'Hi,';

  await sendBrevoEmail({
    to: [{ email: params.email, name: params.name }],
    subject,
    textContent: `${greeting}

Use this OTP code to reset your Kalpira password:

${params.otp}

This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.`,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
        <p style="margin: 0 0 16px;">${greeting}</p>
        <p style="margin: 0 0 16px;">Use this OTP code to reset your Kalpira password:</p>
        <p style="margin: 0 0 24px; font-size: 28px; letter-spacing: 6px; font-weight: 700;">${params.otp}</p>
        <p style="margin: 0; color: #4b5563;">This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendInterviewAssignmentEmail(params: {
  candidateEmail: string;
  candidateName?: string | null;
  interviewerName?: string | null;
  studyName: string;
  companyName?: string | null;
}) {
  const dashboardUrl = new URL('/candidate/dashboard', getBaseUrl()).toString();
  const greeting = params.candidateName?.trim() ? `Hi ${params.candidateName.trim()},` : 'Hi,';
  const interviewer = params.interviewerName?.trim() || 'your interviewer';
  const companyLine = params.companyName?.trim() ? ` for ${params.companyName.trim()}` : '';
  const subject = `New interview assignment: ${params.studyName}`;

  await sendBrevoEmail({
    to: [{ email: params.candidateEmail, name: params.candidateName }],
    subject,
    textContent: `${greeting}

${interviewer} assigned you a new interview${companyLine}: ${params.studyName}.

Sign in to view and start your assigned interview:
${dashboardUrl}

If you do not already have a password-based account for this email, sign in with Google using the same email address or register first and verify your email.`,
    htmlContent: `
      <p>${greeting}</p>
      <p><strong>${interviewer}</strong> assigned you a new interview${companyLine}: <strong>${params.studyName}</strong>.</p>
      <p><a href="${dashboardUrl}">Open candidate dashboard</a></p>
      <p>If you do not already have a password-based account for this email, sign in with Google using the same email address or register first and verify your email.</p>
    `,
  });
}
