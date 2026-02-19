// Platform Database Access Layer (Hosted Mode Only)
// Stores researcher accounts, encrypted credentials, and study ownership
// Migrated from Redis to SQLite/Prisma

import prisma from './prisma';
import { ResearcherAccount, ResearcherProfile } from '@/types';

// ============================================
// Researcher Account CRUD
// ============================================

export async function getResearcherById(id: string): Promise<ResearcherAccount | null> {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return userToResearcherAccount(user);
  } catch (error) {
    console.error('Error getting researcher:', error);
    return null;
  }
}

export async function getResearcherByOAuth(
  provider: string,
  oauthId: string
): Promise<ResearcherAccount | null> {
  try {
    const user = await prisma.user.findUnique({
      where: {
        oauthProvider_oauthId: {
          oauthProvider: provider,
          oauthId: oauthId,
        },
      },
    });
    if (!user) return null;
    return userToResearcherAccount(user);
  } catch (error) {
    console.error('Error getting researcher by OAuth:', error);
    return null;
  }
}

export async function getResearcherByEmail(email: string): Promise<ResearcherAccount | null> {
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    return userToResearcherAccount(user);
  } catch (error) {
    console.error('Error getting researcher by email:', error);
    return null;
  }
}

export async function saveResearcher(researcher: ResearcherAccount): Promise<boolean> {
  try {
    await prisma.user.upsert({
      where: { id: researcher.id },
      update: {
        email: researcher.email,
        name: researcher.name,
        avatarUrl: researcher.avatarUrl,
        oauthProvider: researcher.oauthProvider,
        oauthId: researcher.oauthId,
        encryptedGeminiApiKey: researcher.encryptedGeminiApiKey,
        encryptedAnthropicApiKey: researcher.encryptedAnthropicApiKey,
        onboardingComplete: researcher.onboardingComplete,
      },
      create: {
        id: researcher.id,
        email: researcher.email,
        name: researcher.name,
        avatarUrl: researcher.avatarUrl,
        oauthProvider: researcher.oauthProvider,
        oauthId: researcher.oauthId,
        encryptedGeminiApiKey: researcher.encryptedGeminiApiKey,
        encryptedAnthropicApiKey: researcher.encryptedAnthropicApiKey,
        onboardingComplete: researcher.onboardingComplete,
      },
    });
    return true;
  } catch (error) {
    console.error('Error saving researcher:', error);
    return false;
  }
}

export async function updateResearcher(
  id: string,
  updates: Partial<ResearcherAccount>
): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return false;

    // Map ResearcherAccount fields to Prisma User fields
    const prismaUpdates: Record<string, unknown> = {};
    if (updates.encryptedGeminiApiKey !== undefined) {
      prismaUpdates.encryptedGeminiApiKey = updates.encryptedGeminiApiKey;
    }
    if (updates.encryptedAnthropicApiKey !== undefined) {
      prismaUpdates.encryptedAnthropicApiKey = updates.encryptedAnthropicApiKey;
    }
    if (updates.onboardingComplete !== undefined) {
      prismaUpdates.onboardingComplete = updates.onboardingComplete;
    }
    if (updates.name !== undefined) {
      prismaUpdates.name = updates.name;
    }
    if (updates.avatarUrl !== undefined) {
      prismaUpdates.avatarUrl = updates.avatarUrl;
    }

    await prisma.user.update({ where: { id }, data: prismaUpdates });
    return true;
  } catch (error) {
    console.error('Error updating researcher:', error);
    return false;
  }
}

// ============================================
// Study Ownership Mapping
// ============================================

export async function registerStudyOwnership(
  studyId: string,
  researcherId: string
): Promise<boolean> {
  try {
    await prisma.study.update({
      where: { id: studyId },
      data: { userId: researcherId },
    });
    return true;
  } catch (error) {
    console.error('Error registering study ownership:', error);
    return false;
  }
}

export async function getStudyOwner(studyId: string): Promise<string | null> {
  try {
    const study = await prisma.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });
    return study?.userId ?? null;
  } catch (error) {
    console.error('Error getting study owner:', error);
    return null;
  }
}

export async function deleteStudyOwnership(studyId: string): Promise<boolean> {
  try {
    await prisma.study.update({
      where: { id: studyId },
      data: { userId: null },
    });
    return true;
  } catch (error) {
    console.error('Error deleting study ownership:', error);
    return false;
  }
}

// ============================================
// Helpers
// ============================================

// Convert Prisma User row to ResearcherAccount domain type
function userToResearcherAccount(user: {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  oauthProvider: string | null;
  oauthId: string | null;
  encryptedGeminiApiKey: string | null;
  encryptedAnthropicApiKey: string | null;
  onboardingComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ResearcherAccount {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    avatarUrl: user.avatarUrl,
    oauthProvider: (user.oauthProvider as 'google' | 'github') || 'google',
    oauthId: user.oauthId || '',
    createdAt: user.createdAt.getTime(),
    lastLoginAt: user.updatedAt.getTime(),
    onboardingComplete: user.onboardingComplete,
    encryptedRedisUrl: null,      // No longer used — Redis removed
    encryptedRedisToken: null,    // No longer used — Redis removed
    encryptedGeminiApiKey: user.encryptedGeminiApiKey,
    encryptedAnthropicApiKey: user.encryptedAnthropicApiKey,
    redisConfiguredAt: null,      // No longer used — Redis removed
  };
}

// Convert full account to safe client-side profile
export function toResearcherProfile(account: ResearcherAccount): ResearcherProfile {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    avatarUrl: account.avatarUrl,
    onboardingComplete: account.onboardingComplete,
    hasRedisConfigured: true,  // Always true — SQLite is always available
    hasGeminiKey: !!account.encryptedGeminiApiKey,
    hasAnthropicKey: !!account.encryptedAnthropicApiKey,
  };
}
