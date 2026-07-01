import { randomBytes, createHash, randomInt } from 'crypto';

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

export function createPasswordResetOtp(): { otp: string; hashedOtp: string; expiresAt: Date } {
  const otp = String(randomInt(100000, 1000000));
  const hashedOtp = createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  return { otp, hashedOtp, expiresAt };
}

export function hashPasswordResetOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
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
