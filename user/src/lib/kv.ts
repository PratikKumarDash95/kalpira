// SQLite/Prisma Storage Layer
// Replaces the previous Redis-based kv.ts
// All functions maintain the same public API signatures used by API routes

import prisma from './prisma';
import { StoredInterview, StoredStudy } from '@/types';

// ============================================
// Helper: Convert Prisma StoredInterview row to domain type
// ============================================
function toDomainInterview(row: {
  id: string;
  studyId: string;
  studyName: string;
  transcriptJSON: string;
  participantProfileJSON: string | null;
  synthesisJSON: string | null;
  behaviorDataJSON: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date;
}): StoredInterview {
  return {
    id: row.id,
    studyId: row.studyId,
    studyName: row.studyName,
    transcript: JSON.parse(row.transcriptJSON),
    participantProfile: row.participantProfileJSON
      ? JSON.parse(row.participantProfileJSON)
      : { id: row.id, fields: [], rawContext: '', timestamp: row.createdAt.getTime() },
    synthesis: row.synthesisJSON ? JSON.parse(row.synthesisJSON) : null,
    behaviorData: row.behaviorDataJSON
      ? JSON.parse(row.behaviorDataJSON)
      : { timePerTopic: {}, messagesPerTopic: {}, topicsExplored: [], contradictions: [] },
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt.getTime(),
    status: row.status as 'in_progress' | 'completed',
  };
}

// ============================================
// Helper: Convert Prisma Study row to domain type
// ============================================
function toDomainStudy(row: {
  id: string;
  configJSON: string;
  interviewCount: number;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
}): StoredStudy {
  return {
    id: row.id,
    config: JSON.parse(row.configJSON),
    interviewCount: row.interviewCount,
    isLocked: row.isLocked,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

// ============================================
// Interview CRUD
// ============================================

export async function getInterview(id: string): Promise<StoredInterview | null> {
  try {
    const row = await prisma.storedInterview.findUnique({ where: { id } });
    if (!row) return null;
    return toDomainInterview(row);
  } catch (error) {
    console.error('Error fetching interview:', error);
    return null;
  }
}

export async function saveInterview(interview: StoredInterview): Promise<boolean> {
  try {
    await prisma.storedInterview.upsert({
      where: { id: interview.id },
      update: {
        studyId: interview.studyId,
        studyName: interview.studyName,
        transcriptJSON: JSON.stringify(interview.transcript),
        participantProfileJSON: JSON.stringify(interview.participantProfile),
        synthesisJSON: interview.synthesis ? JSON.stringify(interview.synthesis) : null,
        behaviorDataJSON: JSON.stringify(interview.behaviorData),
        status: interview.status,
        completedAt: new Date(interview.completedAt),
      },
      create: {
        id: interview.id,
        studyId: interview.studyId,
        studyName: interview.studyName,
        transcriptJSON: JSON.stringify(interview.transcript),
        participantProfileJSON: JSON.stringify(interview.participantProfile),
        synthesisJSON: interview.synthesis ? JSON.stringify(interview.synthesis) : null,
        behaviorDataJSON: JSON.stringify(interview.behaviorData),
        status: interview.status,
        createdAt: new Date(interview.createdAt),
        completedAt: new Date(interview.completedAt),
      },
    });
    return true;
  } catch (error) {
    console.error('Error saving interview:', error);
    return false;
  }
}

export async function getAllInterviews(): Promise<StoredInterview[]> {
  try {
    const rows = await prisma.storedInterview.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomainInterview);
  } catch (error) {
    console.error('Error fetching all interviews:', error);
    return [];
  }
}

export async function getStudyInterviews(studyId: string): Promise<StoredInterview[]> {
  try {
    const rows = await prisma.storedInterview.findMany({
      where: { studyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomainInterview);
  } catch (error) {
    console.error('Error fetching study interviews:', error);
    return [];
  }
}

export async function deleteInterview(id: string, studyId: string): Promise<boolean> {
  try {
    await prisma.storedInterview.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error('Error deleting interview:', error);
    return false;
  }
}

// ============================================
// Storage Availability Check
// ============================================

export async function isKVAvailable(): Promise<boolean> {
  try {
    // SQLite is always available as an embedded database
    // Just verify the connection works
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Study CRUD
// ============================================

export async function saveStudy(study: StoredStudy): Promise<boolean> {
  try {
    await prisma.study.upsert({
      where: { id: study.id },
      update: {
        configJSON: JSON.stringify(study.config),
        interviewCount: study.interviewCount,
        isLocked: study.isLocked,
        updatedAt: new Date(study.updatedAt),
      },
      create: {
        id: study.id,
        configJSON: JSON.stringify(study.config),
        interviewCount: study.interviewCount,
        isLocked: study.isLocked,
        createdAt: new Date(study.createdAt),
        updatedAt: new Date(study.updatedAt),
      },
    });
    return true;
  } catch (error) {
    console.error('Error saving study:', error);
    return false;
  }
}

export async function getStudy(id: string): Promise<StoredStudy | null> {
  try {
    const row = await prisma.study.findUnique({ where: { id } });
    if (!row) return null;
    return toDomainStudy(row);
  } catch (error) {
    console.error('Error fetching study:', error);
    return null;
  }
}

export async function getAllStudies(): Promise<StoredStudy[]> {
  try {
    const rows = await prisma.study.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomainStudy);
  } catch (error) {
    console.error('Error fetching all studies:', error);
    return [];
  }
}

export async function deleteStudy(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Check for interviews first
    const interviewCount = await prisma.storedInterview.count({
      where: { studyId: id },
    });

    if (interviewCount > 0) {
      // Delete all associated interviews first (cascade)
      await prisma.storedInterview.deleteMany({ where: { studyId: id } });
    }

    await prisma.study.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    console.error('Error deleting study:', error);
    return { success: false, error: 'Failed to delete study' };
  }
}

// ============================================
// Study Metadata Updates
// ============================================

export async function incrementStudyInterviewCount(studyId: string): Promise<void> {
  try {
    await prisma.study.update({
      where: { id: studyId },
      data: { interviewCount: { increment: 1 } },
    });
  } catch (error) {
    console.error('Error incrementing study interview count:', error);
  }
}

export async function lockStudy(studyId: string): Promise<void> {
  try {
    await prisma.study.update({
      where: { id: studyId },
      data: { isLocked: true },
    });
  } catch (error) {
    console.error('Error locking study:', error);
  }
}
