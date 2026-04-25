// POST /api/generate-link - Generate participant link with signed JWT token
// Creates a stateless URL that embeds the study configuration
// Note: Token is signed (integrity) not encrypted — payload is base64-visible to anyone with the URL
// Requires admin authentication to prevent unauthorized link generation

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import * as jose from 'jose';
import { StudyConfig, ParticipantToken, LinkExpirationOption } from '@/types';
import { getRequestContext } from '@/lib/researcherContext';
import { isHostedMode } from '@/lib/mode';

// Convert link expiration option to jose expiration string
const getExpirationTime = (option?: LinkExpirationOption): string | null => {
  switch (option) {
    case '7days': return '7d';
    case '30days': return '30d';
    case '90days': return '90d';
    case 'never':
    default:
      return null; // No expiration
  }
};

// Get signing secret from environment
// Uses dedicated PARTICIPANT_TOKEN_SECRET if available, falls back to ADMIN_PASSWORD
const getSecret = () => {
  const secret = process.env.PARTICIPANT_TOKEN_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('Token signing secret not configured');
  }
  return new TextEncoder().encode(secret);
};

export async function POST(request: Request) {
  try {
    const { authorized, context, researcherId, error } = await getRequestContext();
    if (!authorized || !context) {
      return NextResponse.json(
        { error: error || 'Admin authentication required to generate participant links' },
        { status: 401 }
      );
    }

    // Verify secret is configured
    let secret: Uint8Array;
    try {
      secret = getSecret();
    } catch {
      return NextResponse.json(
        { error: 'Token signing not configured. Set ADMIN_PASSWORD or PARTICIPANT_TOKEN_SECRET.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { studyConfig } = body as { studyConfig: StudyConfig };

    // Validate required fields
    if (!studyConfig) {
      return NextResponse.json(
        { error: 'Missing required field: studyConfig' },
        { status: 400 }
      );
    }

    // Get expiration time from study config
    const expirationTime = getExpirationTime(studyConfig.linkExpiration);

    // Create token payload
    const tokenData: ParticipantToken = {
      studyId: studyConfig.id,
      studyConfig,
      createdAt: Date.now(),
      // Store expiration info for display purposes
      ...(expirationTime && { expiresAt: Date.now() + (expirationTime === '7d' ? 7 : expirationTime === '30d' ? 30 : 90) * 24 * 60 * 60 * 1000 }),
      // In hosted mode, embed researcherId so participant requests can resolve the correct researcher
      ...(isHostedMode() && researcherId && { researcherId }),
    };

    // Sign the token (with or without expiration)
    let jwtBuilder = new jose.SignJWT(tokenData as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt();

    // Only set expiration if configured
    if (expirationTime) {
      jwtBuilder = jwtBuilder.setExpirationTime(expirationTime);
    }

    const token = await jwtBuilder.sign(secret);

    // Build the full URL
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    const participantUrl = `${baseUrl}/p/${token}`;

    return NextResponse.json({
      token,
      url: participantUrl
    });
  } catch (error) {
    console.error('Generate link API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate participant link' },
      { status: 500 }
    );
  }
}

// GET /api/generate-link?token=xxx - Verify and decode a token
// Used by participant page to validate token before starting interview
// Strips sensitive fields (researcherId) from response
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing token parameter' },
        { status: 400 }
      );
    }

    // Get secret for verification
    let secret: Uint8Array;
    try {
      secret = getSecret();
    } catch {
      return NextResponse.json(
        { valid: false, error: 'Token verification not configured' },
        { status: 500 }
      );
    }

    // Verify and decode the token (jose.jwtVerify checks expiration automatically)
    const { payload } = await jose.jwtVerify(token, secret);

    // Strip internal fields not needed by participants
    const { researcherId: _rid, ...safePayload } = payload as unknown as ParticipantToken & { researcherId?: string };

    return NextResponse.json({
      valid: true,
      data: safePayload as ParticipantToken
    });
  } catch (error) {
    // Handle expired tokens specifically
    if (error instanceof jose.errors.JWTExpired) {
      return NextResponse.json(
        { valid: false, error: 'Token has expired. Please request a new participant link.' },
        { status: 400 }
      );
    }

    console.error('Token verification error:', error);
    return NextResponse.json(
      { valid: false, error: 'Invalid or expired token' },
      { status: 400 }
    );
  }
}
