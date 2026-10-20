/**
 * lipSync.ts — Word-boundary synchronized lip-sync controller for VRM avatars.
 *
 * Coordinates Web Speech API SpeechSynthesisUtterance events (utt.onboundary)
 * with VRM expression blendshapes ('aa', 'ih', 'ou', 'ee', 'oh').
 *
 * Design:
 * - Maps spoken English words to their dominant vowel expression via a lightweight
 *   grapheme-to-viseme heuristic.
 * - Listens to `SpeechSynthesisUtterance.onboundary` events to lock viseme timing
 *   to actual browser-spoken words using `event.charIndex`.
 * - Provides an intra-word articulation envelope: opens during the vowel core and
 *   returns to closed/neutral before the next word boundary for natural cadence.
 * - Includes a documented approximate fallback timeline if the browser's speech
 *   engine does not emit word boundary events.
 * - Exposes zero global mutable state: instantiated per component via createLipSyncController.
 */

export type VrmVowel = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';

export const VRM_VOWELS: readonly VrmVowel[] = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;

export interface VisemeWeights {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export type LipSyncMode = 'idle' | 'word-boundary' | 'estimated-timeline';

interface ParsedWord {
  word: string;
  charIndex: number;
  charLength: number;
  vowel: VrmVowel;
  targetWeight: number;
  estimatedDurationMs: number;
  estimatedStartMs: number;
}

const ZERO_WEIGHTS: Readonly<VisemeWeights> = Object.freeze({
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
});

/**
 * Standard aperture strengths for each vowel (0.55 - 0.70 avoids grotesque over-opening).
 */
const VOWEL_WEIGHTS: Record<VrmVowel, number> = {
  aa: 0.65, // Open jaw
  ih: 0.50, // Slight spread/smile
  ou: 0.65, // Rounded puckered lips
  ee: 0.55, // Wide horizontal spread
  oh: 0.65, // Oval vertical opening
};

/**
 * High-frequency English interview words mapped to their dominant vowel expression.
 */
const COMMON_WORD_MAP: Record<string, VrmVowel> = {
  // 'ou' (rounded / back)
  you: 'ou',
  to: 'ou',
  do: 'ou',
  who: 'ou',
  through: 'ou',
  two: 'ou',
  true: 'ou',
  good: 'ou',
  could: 'ou',
  would: 'ou',
  should: 'ou',
  new: 'ou',
  group: 'ou',
  room: 'ou',
  school: 'ou',
  move: 'ou',
  use: 'ou',
  user: 'ou',

  // 'aa' (open central / front)
  the: 'aa',
  a: 'aa',
  an: 'aa',
  and: 'aa',
  that: 'aa',
  at: 'aa',
  as: 'aa',
  can: 'aa',
  have: 'aa',
  had: 'aa',
  has: 'aa',
  back: 'aa',
  what: 'aa',
  was: 'aa',
  are: 'aa',
  but: 'aa',
  up: 'aa',
  us: 'aa',
  start: 'aa',
  task: 'aa',
  past: 'aa',
  ask: 'aa',
  last: 'aa',
  fast: 'aa',

  // 'ih' (close front lax)
  in: 'ih',
  it: 'ih',
  is: 'ih',
  if: 'ih',
  this: 'ih',
  with: 'ih',
  which: 'ih',
  will: 'ih',
  think: 'ih',
  give: 'ih',
  him: 'ih',
  his: 'ih',
  did: 'ih',
  live: 'ih',
  skill: 'ih',
  still: 'ih',
  system: 'ih',
  fit: 'ih',

  // 'ee' (close front tense / spread)
  we: 'ee',
  he: 'ee',
  she: 'ee',
  me: 'ee',
  see: 'ee',
  be: 'ee',
  been: 'ee',
  feel: 'ee',
  team: 'ee',
  lead: 'ee',
  read: 'ee',
  each: 'ee',
  speak: 'ee',
  need: 'ee',
  tell: 'ee',
  get: 'ee',
  set: 'ee',
  let: 'ee',
  yes: 'ee',
  help: 'ee',
  please: 'ee',
  these: 'ee',
  meet: 'ee',

  // 'oh' (mid back / open-mid rounded)
  no: 'oh',
  so: 'oh',
  go: 'oh',
  or: 'oh',
  for: 'oh',
  more: 'oh',
  your: 'oh',
  all: 'oh',
  call: 'oh',
  also: 'oh',
  role: 'oh',
  hope: 'oh',
  over: 'oh',
  open: 'oh',
  show: 'oh',
  know: 'oh',
  most: 'oh',
  on: 'oh',
  not: 'oh',
  from: 'oh',
  job: 'oh',
  work: 'oh',
  world: 'oh',
};

/**
 * Heuristic grapheme-to-viseme resolver for unknown words.
 * Evaluates vowel digraphs and letter patterns to select the dominant VRM vowel.
 */
export function estimateWordVowel(rawWord: string): VrmVowel {
  const clean = rawWord.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 'aa';

  // Direct lookup in common lexicon
  if (COMMON_WORD_MAP[clean]) {
    return COMMON_WORD_MAP[clean];
  }

  // Digraph and dipthong rules
  if (/ee|ea|ey|ie|ei/.test(clean)) return 'ee';
  if (/oo|ou|ew|ue|ui/.test(clean)) return 'ou';
  if (/oa|ow|aw|au|ore|oor/.test(clean)) return 'oh';
  if (/ai|ay|ar/.test(clean)) return 'aa';
  if (/al|all|ol/.test(clean)) return 'oh';

  // Primary vowel detection by first occurrence
  const match = clean.match(/[aeiouy]/);
  if (match) {
    switch (match[0]) {
      case 'a': return 'aa';
      case 'e': return 'ee';
      case 'i':
      case 'y': return 'ih';
      case 'o': return 'oh';
      case 'u': return 'ou';
    }
  }

  return 'aa';
}

/**
 * Tokenize an utterance string into a sequence of parsed words with character offsets
 * and estimated time spans based on speech rate.
 */
function parseUtterance(text: string, rate: number = 0.95): ParsedWord[] {
  const words: ParsedWord[] = [];
  const regex = /\b[a-zA-Z0-9']+\b/g;
  let match: RegExpExecArray | null;

  // Average syllables per word in English is ~1.4; base pacing is ~65ms per character scaled by rate
  let accumulatedTime = 0;
  const speed = Math.max(0.5, Math.min(2.0, rate));

  while ((match = regex.exec(text)) !== null) {
    const word = match[0];
    const charIndex = match.index;
    const vowel = estimateWordVowel(word);
    const targetWeight = VOWEL_WEIGHTS[vowel];

    // Compute estimated duration for this word (bounded between 180ms and 550ms)
    const durationMs = Math.round(
      Math.max(180, Math.min(550, (word.length * 60 + 80) / speed))
    );

    words.push({
      word,
      charIndex,
      charLength: word.length,
      vowel,
      targetWeight,
      estimatedDurationMs: durationMs,
      estimatedStartMs: accumulatedTime,
    });

    // Add inter-word spacing (~50ms)
    accumulatedTime += durationMs + Math.round(50 / speed);
  }

  return words;
}

export interface LipSyncController {
  /** Prepare a new utterance for playback */
  startUtterance: (text: string, speechRate?: number) => void;
  /** Browser SpeechSynthesisUtterance onstart event */
  onStart: () => void;
  /** Browser SpeechSynthesisUtterance onboundary event */
  onBoundary: (event: SpeechSynthesisEvent) => void;
  /** Reset all lip-sync state immediately (onend, onerror, interruption, or cancellation) */
  reset: () => void;
  /** Retrieve the current target viseme weights for the active frame */
  getTargetWeights: (currentTimeMs?: number) => VisemeWeights;
  /** Current operating mode of the controller */
  getMode: () => LipSyncMode;
  /** Whether speech is currently active */
  isSpeaking: () => boolean;
}

/**
 * Factory creating an encapsulated LipSyncController instance.
 */
export function createLipSyncController(): LipSyncController {
  let speaking = false;
  let words: ParsedWord[] = [];
  let speechRate = 0.95;
  let utteranceStartTime = 0;
  let hasReceivedBoundary = false;
  let activeWordIndex = -1;
  let activeWordStartTime = 0;
  let activeWordDuration = 300;

  return {
    startUtterance(text: string, rate: number = 0.95) {
      speaking = false;
      hasReceivedBoundary = false;
      activeWordIndex = -1;
      speechRate = rate;
      words = parseUtterance(text, rate);
    },

    onStart() {
      speaking = true;
      utteranceStartTime = performance.now();
      hasReceivedBoundary = false;
      activeWordIndex = words.length > 0 ? 0 : -1;
      activeWordStartTime = utteranceStartTime;
      if (words[0]) {
        activeWordDuration = words[0].estimatedDurationMs;
      }
    },

    onBoundary(event: SpeechSynthesisEvent) {
      if (!speaking || words.length === 0) return;

      // Note: event.name may be 'word' or undefined on some browser implementations.
      // event.charIndex identifies the character offset in the clean utterance string.
      hasReceivedBoundary = true;
      const charIndex = typeof event.charIndex === 'number' ? event.charIndex : 0;

      // Locate matching word by charIndex
      let foundIdx = -1;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (charIndex >= w.charIndex && charIndex < w.charIndex + w.charLength + 2) {
          foundIdx = i;
          break;
        }
      }

      // If exact boundary not matched, pick closest start index
      if (foundIdx === -1) {
        let minDiff = Infinity;
        for (let i = 0; i < words.length; i++) {
          const diff = Math.abs(words[i].charIndex - charIndex);
          if (diff < minDiff) {
            minDiff = diff;
            foundIdx = i;
          }
        }
      }

      if (foundIdx !== -1) {
        activeWordIndex = foundIdx;
        activeWordStartTime = performance.now();
        activeWordDuration = words[foundIdx].estimatedDurationMs;
      }
    },

    reset() {
      speaking = false;
      hasReceivedBoundary = false;
      activeWordIndex = -1;
      words = [];
    },

    getTargetWeights(currentTimeMs?: number): VisemeWeights {
      if (!speaking || words.length === 0) {
        return { ...ZERO_WEIGHTS };
      }

      const now = currentTimeMs ?? performance.now();

      // Mode detection & Fallback handling:
      // If after 350ms of speech no boundary events have fired, fall back to the estimated word timeline.
      let currentWord: ParsedWord | null = null;
      let elapsedInWord = 0;
      let wordDuration = activeWordDuration;

      if (hasReceivedBoundary && activeWordIndex >= 0 && activeWordIndex < words.length) {
        // Mode: 'word-boundary' (browser supplies boundary events)
        currentWord = words[activeWordIndex];
        elapsedInWord = now - activeWordStartTime;
      } else {
        // Mode: 'estimated-timeline' fallback (e.g. Firefox or voices without onboundary)
        const elapsedSinceStart = Math.max(0, now - utteranceStartTime);
        let found = words[0];
        for (const w of words) {
          if (elapsedSinceStart >= w.estimatedStartMs) {
            found = w;
          } else {
            break;
          }
        }
        currentWord = found;
        elapsedInWord = elapsedSinceStart - found.estimatedStartMs;
        wordDuration = found.estimatedDurationMs;
      }

      if (!currentWord) {
        return { ...ZERO_WEIGHTS };
      }

      // ── Intra-word articulation envelope ─────────────────────────────────────
      // Phase 1 (0% to ~65% of word): Open toward target vowel weight
      // Phase 2 (~65% to 100% of word): Release toward 0 for consonant closure and pause
      const progress = Math.min(1.0, Math.max(0, elapsedInWord / Math.max(1, wordDuration)));
      let intensity = 0;

      if (progress < 0.65) {
        // Ease in / hold open
        const t = progress / 0.65;
        intensity = Math.sin(t * (Math.PI / 2)) * currentWord.targetWeight;
      } else {
        // Smooth release towards 0 for consonant / inter-word neutral closure
        const t = (progress - 0.65) / 0.35;
        intensity = Math.cos(t * (Math.PI / 2)) * currentWord.targetWeight;
      }

      // Construct weights object with only the active dominant vowel non-zero
      // (prevents incompatible vowels from fighting or distorting the face)
      const weights: VisemeWeights = { ...ZERO_WEIGHTS };
      weights[currentWord.vowel] = Math.max(0, Math.min(1.0, intensity));

      return weights;
    },

    getMode(): LipSyncMode {
      if (!speaking) return 'idle';
      return hasReceivedBoundary ? 'word-boundary' : 'estimated-timeline';
    },

    isSpeaking(): boolean {
      return speaking;
    },
  };
}
