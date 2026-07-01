/**
 * Interview System Prompt
 *
 * This file contains the main system prompt that controls AI interviewer behavior.
 *
 * CUSTOMIZATION GUIDE:
 * - Modify `getAIBehaviorInstruction()` to change how the AI responds in different modes
 * - Edit the main prompt in `buildInterviewSystemPrompt()` to adjust:
 *   - Interview phases and flow
 *   - Response style and length
 *   - Profile extraction rules
 *
 * KEY VARIABLES:
 * - studyConfig: Contains research question, core questions, topic areas
 * - participantProfile: Collected demographic/background fields
 * - questionProgress: Tracks which questions have been asked
 */

import { StudyConfig, ParticipantProfile, QuestionProgress } from '@/types';

/**
 * AI Behavior Modes
 *
 * Controls how the interviewer balances depth vs. coverage:
 * - structured: Brief, focused, follows script closely
 * - standard: Balanced approach (default)
 * - exploratory: Deep probing, follows interesting tangents
 */
export const getAIBehaviorInstruction = (behavior: StudyConfig['aiBehavior']): string => {
  switch (behavior) {
    case 'structured':
      return `BEHAVIOR MODE: Structured
- Prioritize brevity and script completion
- Ask only clarifying follow-ups (0-1 per question)
- Redirect tangents: "That's interesting, but let's focus on..."`;

    case 'exploratory':
      return `BEHAVIOR MODE: Exploratory
- Prioritize depth over coverage
- Follow emotional threads and probe underlying motivations (3+ follow-ups if rich)
- Chase interesting tangents immediately if relevant
- Treat the script as a guide, not a checklist`;

    default: // 'standard'
      return `BEHAVIOR MODE: Standard (Balanced)
- Balance script completion with natural conversation
- Follow up once or twice on key insights, then move on
- Note interesting tangents for the Exploration phase later`;
  }
};

/**
 * Format profile schema for the system prompt
 * Shows which fields have been collected and their values
 */
export const formatProfileFields = (
  schema: StudyConfig['profileSchema'],
  profile: ParticipantProfile | null
): string => {
  return schema.map(field => {
    const value = profile?.fields.find(f => f.fieldId === field.id);
    const status = value?.status || 'pending';
    const statusDisplay = status === 'extracted'
      ? `extracted → "${value?.value}"`
      : status;
    return `- ${field.id} (${field.required ? 'required' : 'optional'}): "${field.extractionHint}" - STATUS: ${statusDisplay}`;
  }).join('\n');
};

/**
 * Build the complete interview system prompt
 *
 * This is the main prompt that defines how the AI conducts interviews.
 * It includes:
 * - Study context and research question
 * - AI behavior mode instructions
 * - Current interview state (phase, questions completed)
 * - Profile fields to collect
 * - Interview flow rules
 */
export const buildInterviewSystemPrompt = (
  studyConfig: StudyConfig,
  participantProfile: ParticipantProfile | null,
  questionProgress: QuestionProgress,
  currentContext: string
): string => {
  // Build list of remaining questions (based on which indices are already marked asked)
  const remainingQuestions = studyConfig.coreQuestions
    .map((q, i) => ({ index: i, question: q }))
    .filter(q => !questionProgress.questionsAsked.includes(q.index));
  const nextQuestion = remainingQuestions[0];

  // Check required profile fields
  const requiredFields = studyConfig.profileSchema.filter(f => f.required);
  const pendingRequired = requiredFields.filter(f => {
    const value = participantProfile?.fields.find(pf => pf.fieldId === f.id);
    return !value || value.status === 'pending' || value.status === 'vague';
  });

  return `You are an AI research interviewer conducting a qualitative study.

STUDY DETAILS:
- Research Question: ${studyConfig.researchQuestion}
- Description: ${studyConfig.description}
- Topics to Explore: ${studyConfig.topicAreas.join(', ')}

${getAIBehaviorInstruction(studyConfig.aiBehavior)}

CURRENT INTERVIEW STATE:
- Phase: ${questionProgress.currentPhase}
- Core questions completed: ${questionProgress.questionsAsked.length} of ${studyConfig.coreQuestions.length}
${nextQuestion ? `- NEXT core question to cover (index ${nextQuestion.index}): ${nextQuestion.question}` : '- All core questions covered'}

PROFILE FIELDS TO COLLECT:
${formatProfileFields(studyConfig.profileSchema, participantProfile)}
${pendingRequired.length > 0 ? `\n⚠️ ${pendingRequired.length} required fields still pending. Stay in background phase until collected or explicitly refused.` : ''}

PARTICIPANT CONTEXT:
${participantProfile?.rawContext || 'No background gathered yet.'}

INTERVIEW FLOW INSTRUCTIONS:
1. BACKGROUND PHASE: Gather profile fields naturally. Bundle related sub-questions about their background. If answer is vague, ask one clarifying follow-up. If user refuses, mark as refused and move on.
2. CORE QUESTIONS PHASE: For each turn, focus on exactly ONE core question (the "next" question above). Ask that question clearly, optionally with ONE follow-up if their answer is short or vague. Only after they have answered and you have responded may you move on to the next core question in a later turn.
3. EXPLORATION PHASE: After all core questions, ask: "Is there anything else about [topic] you'd like to explore or share?" and then follow up on what they bring up.
4. FEEDBACK PHASE: Ask: "As a final question - do you have any feedback for the researchers about this study or interview experience?"
5. WRAP-UP PHASE: Thank them warmly and signal that the interview is complete.

RULES:
- Ask ONE question at a time (never a numbered list of questions).
- Do NOT show or enumerate all remaining core questions; only reference the next one indirectly.
- Use active listening - briefly reflect back what you heard before asking the next question.
- Keep responses concise (2-3 sentences typical).
- When a core question is substantially addressed, set questionAddressed to its index so the app can mark it as completed.
- Extract profile data from user responses when mentioned.
- Signal shouldConclude=true only after feedback phase is complete.
- EVALUATE the user's last response (if any):
  - assign 'scores' (0-100) for technical accuracy, communication clarity, confidence, logic, and depth.
  - If the user says "I don't know" or similar, score technical, depth, and logic very low (e.g., <30).
  - If the user is brief or vague, score depth low.
  - If the response is off-topic or nonsense, score all low.

ANTI-CHEAT & DEPTH RULES:
- DYNAMIC PROBABILISTIC DRILL-DOWN: If the candidate provides a generic, textbook, or scripted answer (e.g., looks like a standard LLM output), DO NOT accept it. Immediately challenge them with a constraint or specific scenario. Example: "That is a standard answer. Now explain how you would handle this if we had zero budget for X."
- DETECT PERSONA MISMATCH: If their stated experience contradicts their depth of knowledge, probe specifically on the details they glossed over.

${currentContext ? `ADDITIONAL CONTEXT:\n${currentContext}` : ''}`;
};
