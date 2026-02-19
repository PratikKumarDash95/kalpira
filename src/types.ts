// Research Interview Tool Types

// ============================================
// Interview Phase & Progress Tracking
// ============================================

export type InterviewPhase =
  | 'background'      // AI gathers participant context
  | 'core-questions'  // Working through core research questions
  | 'exploration'     // Optional deeper exploration
  | 'feedback'        // Final feedback for researchers
  | 'wrap-up';        // AI concludes, interview complete

export interface QuestionProgress {
  questionsAsked: number[];  // Indices of completed questions
  total: number;
  currentPhase: InterviewPhase;
  isComplete: boolean;
}

// ============================================
// Profile Schema - Researcher-defined fields
// ============================================

export interface ProfileField {
  id: string;
  label: string;              // e.g., "Current Role"
  extractionHint: string;     // e.g., "Their job title or position"
  required: boolean;
  options?: string[];         // Optional preset options for validation
}

export type ProfileFieldStatus = 'pending' | 'extracted' | 'vague' | 'refused';

export interface ProfileFieldValue {
  fieldId: string;
  value: string | null;
  status: ProfileFieldStatus;
  extractedAt?: number;
}

export interface ParticipantProfile {
  id: string;
  fields: ProfileFieldValue[];  // Structured field values
  rawContext: string;           // Full context summary from conversation
  timestamp: number;
}

// ============================================
// Study Configuration
// ============================================

export type AIBehavior = 'structured' | 'standard' | 'exploratory';

export type AIProviderType = 'gemini' | 'claude' | 'ollama';

// ============================================
// AI Model Configuration
// ============================================

export interface AIModelOption {
  id: string;
  label: string;
  desc: string;
}

// Available Gemini models (verified from official docs)
export const GEMINI_MODELS: AIModelOption[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Fast, cost-effective' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Higher quality' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', desc: 'Most intelligent (preview)' },
];

// Available Claude models (verified from official docs)
export const CLAUDE_MODELS: AIModelOption[] = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', desc: 'Fastest ($1/$5 per MTok)' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', desc: 'Balanced ($3/$15 per MTok)' },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', desc: 'Most capable ($15/$75 per MTok)' },
];

// Available Ollama models (common local models)
export const OLLAMA_MODELS: AIModelOption[] = [
  { id: 'phi3:mini', label: 'Phi-3 Mini', desc: 'Fast, compact (recommended)' },
  { id: 'llama3', label: 'Llama 3', desc: 'Meta\'s latest open model' },
  { id: 'llama3:70b', label: 'Llama 3 70B', desc: 'Larger, more capable' },
  { id: 'mistral', label: 'Mistral 7B', desc: 'Fast, efficient (requires mistral:latest)' },
  { id: 'mistral:7b-instruct-q4_K_M', label: 'Mistral 7B Instruct Q4', desc: 'Quantized, fast' },
  { id: 'mixtral', label: 'Mixtral 8x7B', desc: 'Mixture of experts' },
  { id: 'gemma2', label: 'Gemma 2', desc: 'Google\'s open model' },
  { id: 'qwen2.5', label: 'Qwen 2.5', desc: 'Alibaba\'s latest model' },
  { id: 'phi3', label: 'Phi-3', desc: 'Microsoft\'s compact model' },
  { id: 'deepseek-r1', label: 'DeepSeek R1', desc: 'Strong reasoning model' },
];

// Default models for each provider
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_OLLAMA_MODEL = 'phi3:mini';

// Synthesis models (auto-upgrade to best available for reasoning tasks)
export const GEMINI_SYNTHESIS_MODEL = 'gemini-3-pro-preview';
export const CLAUDE_SYNTHESIS_MODEL = 'claude-opus-4-5';

// Link expiration options
export type LinkExpirationOption = 'never' | '7days' | '30days' | '90days';

export interface StudyConfig {
  id: string;
  name: string;
  description: string;
  researchQuestion: string;
  coreQuestions: string[];
  topicAreas: string[];           // General topic areas for synthesis
  profileSchema: ProfileField[];  // Fields to collect during interview
  aiBehavior: AIBehavior;
  aiProvider?: AIProviderType;    // Optional, defaults to env or 'gemini'
  aiModel?: string;               // Optional, defaults to provider-specific env or default
  consentText: string;
  createdAt: number;
  // Follow-up study lineage
  parentStudyId?: string;         // ID of parent study if this is a follow-up
  parentStudyName?: string;       // Name of parent study for display
  generatedFrom?: 'synthesis' | 'manual';  // How this study was created
  // Link management
  linksEnabled?: boolean;         // Whether participant links are active (default: true)
  linkExpiration?: LinkExpirationOption;  // When links expire (default: 'never')
  // AI Reasoning
  enableReasoning?: boolean;      // undefined=auto, true=force on, false=force off
}

// ============================================
// Interview Messages
// ============================================

export interface InterviewMessage {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  timestamp: number;
}

// ============================================
// Behavior & Analysis Data
// ============================================

export interface BehaviorData {
  timePerTopic: Record<string, number>;
  messagesPerTopic: Record<string, number>;
  topicsExplored: string[];
  contradictions: string[];
}

export interface SynthesisResult {
  statedPreferences: string[];
  revealedPreferences: string[];
  themes: { theme: string; evidence: string; frequency: number }[];
  contradictions: string[];
  keyInsights: string[];
  bottomLine: string;
}

// ============================================
// App State
// ============================================

export type AppStep =
  | 'setup'        // Researcher configures study
  | 'consent'      // Participant sees consent + foreshadowing
  | 'interview'    // Main interview chat (includes background gathering)
  | 'synthesis'    // Analysis results
  | 'export';      // Export data

export type ViewMode = 'researcher' | 'participant';

export interface ContextEntry {
  id: string;
  text: string;
  source: 'text' | 'system';
  timestamp: number;
}

// ============================================
// AI Response Structure (for API routes)
// ============================================

export interface AIInterviewResponse {
  message: string;
  questionAddressed: number | null;     // Which core question was covered (0-indexed)
  phaseTransition: InterviewPhase | null;  // If moving to new phase
  profileUpdates: {
    fieldId: string;
    value: string | null;
    status: 'extracted' | 'vague' | 'refused';
  }[];
  shouldConclude: boolean;              // AI signals interview should end
  scores?: {                            // Real-time evaluation of the last user answer
    technical: number;
    communication: number;
    confidence: number;
    logic: number;
    depth: number;
  };
}

// ============================================
// Stored Interview (Vercel KV)
// ============================================

export interface StoredInterview {
  id: string;
  studyId: string;
  studyName: string;
  participantProfile: ParticipantProfile;
  transcript: InterviewMessage[];
  synthesis: SynthesisResult | null;
  behaviorData: BehaviorData;
  createdAt: number;
  completedAt: number;
  status: 'in_progress' | 'completed';
}

// ============================================
// Participant Token (URL)
// ============================================

export interface ParticipantToken {
  studyId: string;
  studyConfig: StudyConfig;
  createdAt: number;
  expiresAt?: number;
  researcherId?: string;  // Present in hosted mode for researcher context resolution
}

// ============================================
// Researcher Account (Platform DB - Hosted Mode)
// ============================================

export interface ResearcherAccount {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  oauthProvider: 'google' | 'github';
  oauthId: string;
  createdAt: number;
  lastLoginAt: number;
  onboardingComplete: boolean;

  // Encrypted credentials — never sent to client
  encryptedRedisUrl: string | null;
  encryptedRedisToken: string | null;
  encryptedGeminiApiKey: string | null;
  encryptedAnthropicApiKey: string | null;

  redisConfiguredAt: number | null;
}

// Safe subset for client-side display
export interface ResearcherProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  onboardingComplete: boolean;
  hasRedisConfigured: boolean;
  hasGeminiKey: boolean;
  hasAnthropicKey: boolean;
}

// ============================================
// Stored Study (Vercel KV)
// ============================================

export interface StoredStudy {
  id: string;                    // Server-assigned UUID
  config: StudyConfig;           // Full study configuration
  createdAt: number;
  updatedAt: number;
  interviewCount: number;        // Cached count for dashboard display
  isLocked: boolean;             // True after first interview collected
}

// ============================================
// Aggregate Synthesis (Cross-Interview)
// ============================================

export interface AggregateSynthesisResult {
  studyId: string;
  interviewCount: number;
  commonThemes: { theme: string; frequency: number; representativeQuotes: string[] }[];
  divergentViews: { topic: string; viewA: string; viewB: string }[];
  keyFindings: string[];
  researchImplications: string[];
  bottomLine: string;           // One-paragraph summary of all interviews
  generatedAt: number;
}
