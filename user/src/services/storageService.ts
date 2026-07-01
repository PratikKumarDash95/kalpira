import { apiFetch, apiUrl } from '@/lib/apiClient';
// Storage Service - Client-side interface for interview storage
// Calls API routes which persist through Supabase to Supabase Postgres.

import { StoredInterview, StoredStudy } from '@/types';

export type InterviewPage = {
  interviews: StoredInterview[];
  pagination: {
    limit: number;
    offset: number;
    count: number;
    hasMore: boolean;
    nextOffset: number;
  };
};

// Save completed interview
export async function saveCompletedInterview(
  interview: Omit<StoredInterview, 'completedAt' | 'status'>,
  participantToken?: string | null
): Promise<{ success: boolean; id: string }> {
  try {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (participantToken) {
      headers['Authorization'] = `Bearer ${participantToken}`;
    }

    const response = await apiFetch('/api/interviews/save', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...interview,
        completedAt: Date.now(),
        status: 'completed'
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error saving interview:', error);
    return { success: false, id: '' };
  }
}

// Get all interviews (researcher only)
export async function getAllInterviews(options?: { summary?: boolean; limit?: number; offset?: number }): Promise<StoredInterview[]> {
  try {
    const params = new URLSearchParams();
    if (options?.summary) params.set('summary', '1');
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.summary && !options?.limit) params.set('limit', '50');

    const response = await apiFetch(`/api/interviews${params.size ? `?${params.toString()}` : ''}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.interviews || [];
  } catch (error) {
    console.error('Error fetching interviews:', error);
    return [];
  }
}

export async function getAllInterviewsPage(options?: { summary?: boolean; limit?: number; offset?: number }): Promise<InterviewPage> {
  try {
    const params = new URLSearchParams();
    if (options?.summary) params.set('summary', '1');
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const response = await apiFetch(`/api/interviews${params.size ? `?${params.toString()}` : ''}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const interviews = data.interviews || [];
    return {
      interviews,
      pagination: data.pagination || {
        limit: options?.limit || interviews.length,
        offset: options?.offset || 0,
        count: interviews.length,
        hasMore: false,
        nextOffset: (options?.offset || 0) + interviews.length
      }
    };
  } catch (error) {
    console.error('Error fetching interview page:', error);
    return {
      interviews: [],
      pagination: {
        limit: options?.limit || 0,
        offset: options?.offset || 0,
        count: 0,
        hasMore: false,
        nextOffset: options?.offset || 0
      }
    };
  }
}

// Get single interview by ID
export async function getInterview(id: string): Promise<StoredInterview | null> {
  try {
    const response = await apiFetch(`/api/interviews/${id}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.interview || null;
  } catch (error) {
    console.error('Error fetching interview:', error);
    return null;
  }
}

// Export all interviews as ZIP
export async function exportAllInterviews(): Promise<Blob | null> {
  try {
    const response = await apiFetch('/api/interviews/export');

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Error exporting interviews:', error);
    return null;
  }
}

// Get interviews for a specific study
export async function getStudyInterviews(studyId: string, options?: { summary?: boolean }): Promise<StoredInterview[]> {
  try {
    const params = new URLSearchParams({ studyId });
    if (options?.summary) params.set('summary', '1');
    if (options?.summary) params.set('limit', '50');
    const response = await apiFetch(`/api/interviews?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.interviews || [];
  } catch (error) {
    console.error('Error fetching study interviews:', error);
    return [];
  }
}

// Get all studies (researcher only)
export async function getAllStudies(): Promise<{ studies: StoredStudy[]; warning?: string }> {
  try {
    const response = await apiFetch('/api/studies');

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      studies: data.studies || [],
      warning: data.warning
    };
  } catch (error) {
    console.error('Error fetching studies:', error);
    return { studies: [] };
  }
}

// Get single study by ID
export async function getStudy(id: string): Promise<StoredStudy | null> {
  try {
    const response = await apiFetch(`/api/studies/${id}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.study || null;
  } catch (error) {
    console.error('Error fetching study:', error);
    return null;
  }
}

// Delete study
export async function deleteStudy(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/studies/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting study:', error);
    return { success: false, error: 'Failed to delete study' };
  }
}

// Delete interview
export async function deleteInterview(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await apiFetch(`/api/interviews/${id}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting interview:', error);
    return { success: false, error: 'Failed to delete interview' };
  }
}
