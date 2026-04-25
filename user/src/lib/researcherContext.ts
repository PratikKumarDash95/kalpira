// Researcher Context Resolution
// Central abstraction for resolving per-request credentials in both deployment modes
// Every API route calls one of these to get the appropriate DB access and API keys
// Migrated from Redis to SQLite/Prisma — kvClient removed entirely

import { cookies } from 'next/headers';
import { isStandaloneMode, isHostedMode } from './mode';
import { getResearcherById, getStudyOwner } from './platformDb';
import { decrypt } from './crypto';
import { verifySessionToken, verifyParticipantToken, SESSION_COOKIE_NAME } from './auth';
import { getStudy } from './kv';
import prisma from './prisma';

export interface ResearcherContext {
  // Identity (null in standalone mode, unless mapped to userId)
  researcherId: string | null;
  userId: string | null; // Added for candidate/unified user support

  // AI API keys
  geminiApiKey: string | null;
  anthropicApiKey: string | null;

  // Whether the researcher has completed onboarding
  onboardingComplete: boolean;
}

// Resolve context for a researcher by ID (shared logic)
async function resolveById(researcherId: string): Promise<ResearcherContext> {
  const researcher = await getResearcherById(researcherId);
  if (!researcher) {
    throw new Error(`Researcher not found: ${researcherId}`);
  }

  return {
    researcherId,
    userId: researcherId, // Map researcherId to userId
    geminiApiKey: researcher.encryptedGeminiApiKey
      ? decrypt(researcher.encryptedGeminiApiKey)
      : null,
    anthropicApiKey: researcher.encryptedAnthropicApiKey
      ? decrypt(researcher.encryptedAnthropicApiKey)
      : null,
    onboardingComplete: researcher.onboardingComplete,
  };
}

// Standalone context: uses env vars, resolves default user
async function getStandaloneContext(): Promise<ResearcherContext> {
  // In standalone mode, use the single admin user as the context user
  const user = await prisma.user.findFirst();

  return {
    researcherId: null,
    userId: user?.id || null,
    geminiApiKey: process.env.GEMINI_API_KEY || null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
    onboardingComplete: true,
  };
}

// ============================================
// For researcher/admin API routes
// ============================================

export interface RequestContextResult {
  authorized: boolean;
  context: ResearcherContext | null;
  researcherId?: string;
  error?: string;
}

export async function getRequestContext(): Promise<RequestContextResult> {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (!authCookie?.value) {
    return { authorized: false, context: null, error: 'Unauthorized' };
  }

  const session = await verifySessionToken(authCookie.value);
  if (!session.valid) {
    return { authorized: false, context: null, error: 'Session expired or invalid' };
  }

  try {
    if (isStandaloneMode()) {
      return {
        authorized: true,
        context: await getStandaloneContext(),
      };
    }

    // Hosted mode: resolve researcher credentials
    if (!session.researcherId) {
      return { authorized: false, context: null, error: 'No researcher identity in session' };
    }

    const context = await resolveById(session.researcherId);
    return {
      authorized: true,
      context,
      researcherId: session.researcherId,
    };
  } catch (err) {
    console.error('Failed to resolve researcher context:', err);
    return { authorized: false, context: null, error: 'Failed to resolve researcher context' };
  }
}

// ============================================
// For participant API routes
// ============================================

export interface ParticipantContextResult {
  valid: boolean;
  context: ResearcherContext | null;
  studyId?: string;
  isAdmin?: boolean;
  error?: string;
}

export async function getParticipantRequestContext(
  request: Request
): Promise<ParticipantContextResult> {
  const auth = await verifyParticipantToken(request);

  if (!auth.valid) {
    // In standalone mode, allow unauthenticated access as fallback
    // This is safe because standalone mode is single-user (the researcher themselves)
    // and API keys come from environment variables, not per-user credentials
    if (isStandaloneMode()) {
      return {
        valid: true,
        context: await getStandaloneContext(),
      };
    }
    return { valid: false, context: null, error: auth.error };
  }

  // Admin preview: use their own session context
  if (auth.isAdmin) {
    const { context } = await getRequestContext();
    return { valid: true, context, isAdmin: true };
  }

  // Standalone mode: use env vars
  if (isStandaloneMode()) {
    // Check if links are disabled for this study
    if (auth.studyId) {
      const study = await getStudy(auth.studyId);
      if (study && study.config.linksEnabled === false) {
        return { valid: false, context: null, error: 'Participant links have been disabled for this study.' };
      }
    }

    return {
      valid: true,
      context: await getStandaloneContext(),
      studyId: auth.studyId,
    };
  }

  // Hosted mode: resolve researcher from token or study ownership
  try {
    let researcherId = auth.researcherId;

    if (!researcherId && auth.studyId) {
      // Fallback: look up study owner from platform DB
      researcherId = await getStudyOwner(auth.studyId) ?? undefined;
    }

    if (!researcherId) {
      return { valid: false, context: null, error: 'Study owner not found' };
    }

    const context = await resolveById(researcherId);

    // Check if links are disabled for this study
    if (auth.studyId) {
      try {
        const study = await getStudy(auth.studyId);
        if (study && study.config.linksEnabled === false) {
          return { valid: false, context: null, error: 'Participant links have been disabled for this study.' };
        }
      } catch (dbError) {
        // Fail closed: if we can't verify link status, deny access
        console.error('Failed to check link status for study:', auth.studyId, dbError);
        return { valid: false, context: null, error: 'Unable to verify study status. Please try again later.' };
      }
    }

    return { valid: true, context, studyId: auth.studyId };
  } catch (err) {
    console.error('Failed to resolve participant context:', err);
    return { valid: false, context: null, error: 'Failed to resolve study context' };
  }
}
