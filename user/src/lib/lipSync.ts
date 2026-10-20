/**
 * lipSync.ts — Elite Multi-Syllable Phonemic Lip-Sync Engine for 3D VRM Avatars.
 *
 * Provides studio-grade speech visualization by going far beyond basic 1-word-1-vowel heuristics:
 *
 * 1. Sub-Word Syllabic Decomposition:
 *    Breaks words into true phonetic syllables (e.g., "in-ter-view", "ex-pe-ri-ence", "com-mu-ni-ca-tion"),
 *    dynamically articulating every vowel transition within a single word in real time.
 *
 * 2. Consonant Bilabial Closures (M / B / P Dynamics):
 *    In natural human speech, the lips must physically press together for bilabial consonants.
 *    This engine detects initial, medial, and terminal bilabials, snapping the aperture closed
 *    on sounds like "m", "b", and "p" (e.g., "make", "problem", "important", "team").
 *
 * 3. Diphthong Gliding & Coarticulation:
 *    Natural English vowels glide between articulatory targets (e.g., "I" glides 'aa' -> 'ih',
 *    "go" glides 'oh' -> 'ou', "day" glides 'ee' -> 'ih'). Crossfades multi-vowel blendshapes smoothly.
 *
 * 4. Punctuation Cadence & Conversational Breathing:
 *    Respects commas, semicolons, and periods, bringing the lips to a natural relaxed neutral
 *    during pauses instead of flapping through silence.
 *
 * 5. Physical Jaw Deflection & Conversational Head Emphasis:
 *    Provides computed jaw deflection and syllable-stress head nod impulses for full skeletal realism.
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

export interface LipSyncFrame {
  weights: VisemeWeights;
  jawOpen: number;         // 0 to 1 for physical jaw bone rotation
  headNodOffset: number;   // Subtle conversational nod impulse
  eyeDartOffset: { x: number; y: number };
}

export type LipSyncMode = 'idle' | 'word-boundary' | 'estimated-timeline';

export interface SyllableViseme {
  vowel: VrmVowel;
  targetWeight: number;
  glideTo?: VrmVowel;
  glideRatio?: number;     // When glide starts (e.g. 0.4 = 40% through syllable)
  bilabialStart?: boolean; // Starts with M, B, P (brief mouth closure)
  bilabialEnd?: boolean;   // Ends with M, B, P (crisp lip snap shut)
  relativeDuration: number;
  stress: number;          // 0.8 (unstressed) to 1.3 (stressed/emphasized)
}

interface ParsedWord {
  word: string;
  clean: string;
  charIndex: number;
  charLength: number;
  syllables: SyllableViseme[];
  estimatedDurationMs: number;
  estimatedStartMs: number;
  trailingPauseMs: number;
}

const ZERO_WEIGHTS: Readonly<VisemeWeights> = Object.freeze({
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
});

/**
 * Baseline natural aperture weights for VRM blendshapes (avoids grotesque over-opening).
 */
const BASE_APERTURE: Record<VrmVowel, number> = {
  aa: 0.68, // Open jaw / low central vowel
  ih: 0.50, // Slight horizontal stretch, narrow teeth
  ou: 0.65, // Rounded puckered lips
  ee: 0.58, // Wide horizontal spread
  oh: 0.66, // Tall oval opening
};

// ─── Studio Lexicon of English Interview & Tech Terms ──────────────────────────
// Pre-computed phonetic syllable maps for ultra-crisp articulation of common words.
const DICTIONARY: Record<string, SyllableViseme[]> = {
  // Greetings & Core Pronouns
  hello: [
    { vowel: 'ee', targetWeight: 0.52, relativeDuration: 1.0, stress: 0.9 },
    { vowel: 'oh', targetWeight: 0.66, glideTo: 'ou', glideRatio: 0.45, relativeDuration: 1.3, stress: 1.2 },
  ],
  hi: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.2, stress: 1.2 }],
  welcome: [
    { vowel: 'ou', targetWeight: 0.55, relativeDuration: 1.0, stress: 1.1 },
    { vowel: 'aa', targetWeight: 0.50, bilabialEnd: true, relativeDuration: 1.0, stress: 0.9 },
  ],
  you: [{ vowel: 'ou', targetWeight: 0.68, relativeDuration: 1.0, stress: 1.0 }],
  your: [{ vowel: 'oh', targetWeight: 0.64, glideTo: 'ou', glideRatio: 0.5, relativeDuration: 1.0, stress: 1.0 }],
  i: [{ vowel: 'aa', targetWeight: 0.70, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.1, stress: 1.1 }],
  me: [{ vowel: 'ee', targetWeight: 0.60, bilabialStart: true, relativeDuration: 1.0, stress: 1.0 }],
  my: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.4, bilabialStart: true, relativeDuration: 1.1, stress: 1.1 }],
  myself: [
    { vowel: 'aa', targetWeight: 0.66, glideTo: 'ih', glideRatio: 0.4, bilabialStart: true, relativeDuration: 1.0, stress: 0.9 },
    { vowel: 'ee', targetWeight: 0.58, relativeDuration: 1.2, stress: 1.2 },
  ],
  yourself: [
    { vowel: 'ou', targetWeight: 0.60, relativeDuration: 1.0, stress: 0.9 },
    { vowel: 'ee', targetWeight: 0.58, relativeDuration: 1.2, stress: 1.2 },
  ],
  we: [{ vowel: 'ee', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  they: [{ vowel: 'ee', targetWeight: 0.62, glideTo: 'ih', glideRatio: 0.45, relativeDuration: 1.1, stress: 1.0 }],

  // Interview Conversation
  interview: [
    { vowel: 'ih', targetWeight: 0.52, relativeDuration: 1.0, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.9 },
    { vowel: 'ou', targetWeight: 0.66, relativeDuration: 1.3, stress: 1.1 },
  ],
  interviewer: [
    { vowel: 'ih', targetWeight: 0.52, relativeDuration: 1.0, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.45, relativeDuration: 0.9, stress: 0.9 },
    { vowel: 'ou', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.0 },
    { vowel: 'ee', targetWeight: 0.42, relativeDuration: 0.8, stress: 0.8 },
  ],
  question: [
    { vowel: 'ee', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'aa', targetWeight: 0.46, relativeDuration: 0.9, stress: 0.8 },
  ],
  questions: [
    { vowel: 'ee', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'aa', targetWeight: 0.46, relativeDuration: 0.9, stress: 0.8 },
  ],
  candidate: [
    { vowel: 'aa', targetWeight: 0.66, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ih', targetWeight: 0.45, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'ee', targetWeight: 0.55, relativeDuration: 1.0, stress: 1.0 },
  ],
  experience: [
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'ih', targetWeight: 0.62, relativeDuration: 1.2, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'aa', targetWeight: 0.44, relativeDuration: 0.9, stress: 0.8 },
  ],
  background: [
    { vowel: 'aa', targetWeight: 0.68, bilabialStart: true, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ou', targetWeight: 0.64, relativeDuration: 1.1, stress: 1.0 },
  ],
  project: [
    { vowel: 'oh', targetWeight: 0.66, bilabialStart: true, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.52, relativeDuration: 1.0, stress: 0.9 },
  ],
  challenge: [
    { vowel: 'aa', targetWeight: 0.68, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ih', targetWeight: 0.48, relativeDuration: 1.0, stress: 0.9 },
  ],
  solution: [
    { vowel: 'oh', targetWeight: 0.52, relativeDuration: 1.0, stress: 0.9 },
    { vowel: 'ou', targetWeight: 0.68, relativeDuration: 1.2, stress: 1.2 },
    { vowel: 'aa', targetWeight: 0.44, relativeDuration: 0.9, stress: 0.8 },
  ],
  company: [
    { vowel: 'aa', targetWeight: 0.65, bilabialEnd: true, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'aa', targetWeight: 0.46, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'ee', targetWeight: 0.50, relativeDuration: 1.0, stress: 0.9 },
  ],
  role: [{ vowel: 'oh', targetWeight: 0.66, glideTo: 'ou', glideRatio: 0.5, relativeDuration: 1.2, stress: 1.1 }],
  team: [{ vowel: 'ee', targetWeight: 0.66, bilabialEnd: true, relativeDuration: 1.2, stress: 1.2 }],
  skills: [{ vowel: 'ih', targetWeight: 0.56, relativeDuration: 1.1, stress: 1.1 }],
  strength: [{ vowel: 'ee', targetWeight: 0.60, relativeDuration: 1.2, stress: 1.1 }],
  weakness: [
    { vowel: 'ee', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.46, relativeDuration: 0.9, stress: 0.8 },
  ],
  technical: [
    { vowel: 'ee', targetWeight: 0.60, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ih', targetWeight: 0.44, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'aa', targetWeight: 0.44, relativeDuration: 0.9, stress: 0.8 },
  ],
  technology: [
    { vowel: 'ee', targetWeight: 0.52, relativeDuration: 0.9, stress: 0.9 },
    { vowel: 'oh', targetWeight: 0.66, relativeDuration: 1.2, stress: 1.2 },
    { vowel: 'oh', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.8 },
    { vowel: 'ee', targetWeight: 0.50, relativeDuration: 1.0, stress: 0.9 },
  ],
  kalpira: [
    { vowel: 'aa', targetWeight: 0.68, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ih', targetWeight: 0.54, bilabialStart: true, relativeDuration: 1.0, stress: 1.0 },
    { vowel: 'aa', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.0 },
  ],
  tell: [{ vowel: 'ee', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  about: [
    { vowel: 'aa', targetWeight: 0.45, relativeDuration: 0.8, stress: 0.8 },
    { vowel: 'ou', targetWeight: 0.68, bilabialStart: true, relativeDuration: 1.2, stress: 1.2 },
  ],
  please: [{ vowel: 'ee', targetWeight: 0.66, bilabialStart: true, relativeDuration: 1.2, stress: 1.1 }],
  thank: [{ vowel: 'aa', targetWeight: 0.65, relativeDuration: 1.1, stress: 1.1 }],
  great: [{ vowel: 'ee', targetWeight: 0.64, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.2, stress: 1.2 }],
  good: [{ vowel: 'ou', targetWeight: 0.62, relativeDuration: 1.0, stress: 1.0 }],
  nice: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.1, stress: 1.1 }],
  meet: [{ vowel: 'ee', targetWeight: 0.65, bilabialStart: true, relativeDuration: 1.1, stress: 1.1 }],
  start: [{ vowel: 'aa', targetWeight: 0.70, relativeDuration: 1.2, stress: 1.2 }],
  ready: [
    { vowel: 'ee', targetWeight: 0.62, relativeDuration: 1.0, stress: 1.1 },
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.9 },
  ],
  problem: [
    { vowel: 'oh', targetWeight: 0.66, bilabialStart: true, bilabialEnd: true, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ee', targetWeight: 0.46, bilabialEnd: true, relativeDuration: 0.9, stress: 0.8 },
  ],
  people: [
    { vowel: 'ee', targetWeight: 0.66, bilabialStart: true, bilabialEnd: true, relativeDuration: 1.1, stress: 1.2 },
    { vowel: 'ou', targetWeight: 0.44, relativeDuration: 0.9, stress: 0.8 },
  ],
  make: [{ vowel: 'ee', targetWeight: 0.64, glideTo: 'ih', glideRatio: 0.45, bilabialStart: true, relativeDuration: 1.1, stress: 1.1 }],
  more: [{ vowel: 'oh', targetWeight: 0.66, bilabialStart: true, relativeDuration: 1.1, stress: 1.1 }],
  much: [{ vowel: 'aa', targetWeight: 0.62, bilabialStart: true, relativeDuration: 1.0, stress: 1.0 }],
  many: [
    { vowel: 'ee', targetWeight: 0.60, bilabialStart: true, relativeDuration: 1.0, stress: 1.1 },
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.9, stress: 0.8 },
  ],
  work: [{ vowel: 'oh', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.1 }],
  time: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.45, bilabialEnd: true, relativeDuration: 1.2, stress: 1.2 }],
  like: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.1, stress: 1.1 }],
  how: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ou', glideRatio: 0.4, relativeDuration: 1.1, stress: 1.1 }],
  now: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ou', glideRatio: 0.4, relativeDuration: 1.1, stress: 1.1 }],
  what: [{ vowel: 'aa', targetWeight: 0.64, relativeDuration: 1.0, stress: 1.0 }],
  when: [{ vowel: 'ee', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  where: [{ vowel: 'ee', targetWeight: 0.62, relativeDuration: 1.1, stress: 1.0 }],
  why: [{ vowel: 'aa', targetWeight: 0.68, glideTo: 'ih', glideRatio: 0.4, relativeDuration: 1.2, stress: 1.2 }],
  who: [{ vowel: 'ou', targetWeight: 0.66, relativeDuration: 1.0, stress: 1.0 }],
  can: [{ vowel: 'aa', targetWeight: 0.62, relativeDuration: 1.0, stress: 1.0 }],
  could: [{ vowel: 'ou', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  would: [{ vowel: 'ou', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  should: [{ vowel: 'ou', targetWeight: 0.58, relativeDuration: 1.0, stress: 1.0 }],
  think: [{ vowel: 'ih', targetWeight: 0.55, relativeDuration: 1.0, stress: 1.0 }],
  thought: [{ vowel: 'oh', targetWeight: 0.68, relativeDuration: 1.1, stress: 1.1 }],
  understand: [
    { vowel: 'aa', targetWeight: 0.56, relativeDuration: 0.9, stress: 0.9 },
    { vowel: 'ee', targetWeight: 0.48, relativeDuration: 0.8, stress: 0.8 },
    { vowel: 'aa', targetWeight: 0.68, relativeDuration: 1.3, stress: 1.3 },
  ],
  system: [
    { vowel: 'ih', targetWeight: 0.55, relativeDuration: 1.0, stress: 1.1 },
    { vowel: 'ee', targetWeight: 0.48, bilabialEnd: true, relativeDuration: 0.9, stress: 0.8 },
  ],
  important: [
    { vowel: 'ih', targetWeight: 0.52, bilabialEnd: true, relativeDuration: 0.9, stress: 0.9 },
    { vowel: 'oh', targetWeight: 0.68, relativeDuration: 1.3, stress: 1.3 },
    { vowel: 'aa', targetWeight: 0.44, relativeDuration: 0.8, stress: 0.8 },
  ],
};

/**
 * Advanced English Grapheme-to-Phoneme (G2P) rule-based syllabifier.
 * Decomposes any unmapped English word into natural phonetic syllables.
 */
export function syllabifyWord(rawWord: string): SyllableViseme[] {
  const clean = rawWord.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) {
    return [{ vowel: 'aa', targetWeight: BASE_APERTURE.aa, relativeDuration: 1.0, stress: 1.0 }];
  }

  // Check studio lexicon first
  if (DICTIONARY[clean]) {
    return DICTIONARY[clean];
  }

  // Bilabial boundary detection
  const startsWithBilabial = /^[mbp]/.test(clean);
  const endsWithBilabial = /[mbp]$/.test(clean);

  // Split word into vowel nuclei clusters
  // Note: Handle trailing silent 'e' (e.g. 'make', 'code', 'life')
  let wordForAnalysis = clean;
  const hasSilentTrailingE = clean.length > 3 && clean.endsWith('e') && !/[aeiouy]{2}e$/.test(clean) && !clean.endsWith('ee');
  if (hasSilentTrailingE) {
    wordForAnalysis = clean.slice(0, -1);
  }

  const vowelClusterRegex = /[aeiouy]+/g;
  const matches: { text: string; index: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = vowelClusterRegex.exec(wordForAnalysis)) !== null) {
    matches.push({ text: m[0], index: m.index });
  }

  // Fallback if no vowels found (e.g., abbreviations like 'nth', 'sync')
  if (matches.length === 0) {
    return [{
      vowel: clean.includes('y') ? 'ih' : 'aa',
      targetWeight: 0.55,
      bilabialStart: startsWithBilabial,
      bilabialEnd: endsWithBilabial,
      relativeDuration: 1.0,
      stress: 1.0,
    }];
  }

  const syllables: SyllableViseme[] = [];
  const count = matches.length;

  for (let i = 0; i < count; i++) {
    const cluster = matches[i].text;
    const isFirst = i === 0;
    const isLast = i === count - 1;

    let vowel: VrmVowel = 'aa';
    let glideTo: VrmVowel | undefined;
    let glideRatio: number | undefined;
    let weight = BASE_APERTURE.aa;

    // Digraphs & Diphthong rules
    if (/ee|ea|ey|ie|ei/.test(cluster)) {
      vowel = 'ee';
      weight = BASE_APERTURE.ee;
    } else if (/oo|ou|ew|ue|ui/.test(cluster)) {
      vowel = 'ou';
      weight = BASE_APERTURE.ou;
    } else if (/oa|ow|au|aw/.test(cluster)) {
      vowel = 'oh';
      glideTo = 'ou';
      glideRatio = 0.45;
      weight = BASE_APERTURE.oh;
    } else if (/oi|oy/.test(cluster)) {
      vowel = 'oh';
      glideTo = 'ee';
      glideRatio = 0.4;
      weight = BASE_APERTURE.oh;
    } else if (/ai|ay/.test(cluster)) {
      vowel = 'ee';
      glideTo = 'ih';
      glideRatio = 0.45;
      weight = BASE_APERTURE.ee;
    } else if (hasSilentTrailingE && isLast && cluster.length === 1) {
      // Long vowel due to silent e: 'a_e' -> 'ee'->'ih', 'i_e' -> 'aa'->'ih', 'o_e' -> 'oh'->'ou', 'u_e' -> 'ou'
      switch (cluster) {
        case 'a': vowel = 'ee'; glideTo = 'ih'; glideRatio = 0.45; weight = BASE_APERTURE.ee; break;
        case 'i':
        case 'y': vowel = 'aa'; glideTo = 'ih'; glideRatio = 0.40; weight = BASE_APERTURE.aa; break;
        case 'o': vowel = 'oh'; glideTo = 'ou'; glideRatio = 0.45; weight = BASE_APERTURE.oh; break;
        case 'u': vowel = 'ou'; weight = BASE_APERTURE.ou; break;
        case 'e': vowel = 'ee'; weight = BASE_APERTURE.ee; break;
      }
    } else {
      // Single short vowel
      switch (cluster[0]) {
        case 'a': vowel = 'aa'; weight = BASE_APERTURE.aa; break;
        case 'e': vowel = 'ee'; weight = BASE_APERTURE.ee; break;
        case 'i':
        case 'y': vowel = 'ih'; weight = BASE_APERTURE.ih; break;
        case 'o': vowel = 'oh'; weight = BASE_APERTURE.oh; break;
        case 'u': vowel = 'ou'; weight = BASE_APERTURE.ou; break;
      }
    }

    // Dynamic stress weighting: primary stress on root syllable
    const isStressed = count === 1 ? true : (count === 2 ? isFirst : i === 1);
    const stress = isStressed ? 1.15 : 0.88;

    syllables.push({
      vowel,
      targetWeight: weight,
      glideTo,
      glideRatio,
      bilabialStart: isFirst && startsWithBilabial,
      bilabialEnd: isLast && endsWithBilabial,
      relativeDuration: isStressed ? 1.2 : 0.9,
      stress,
    });
  }

  return syllables;
}

/**
 * Tokenize an utterance string into a sequence of parsed words with syllabic models,
 * character offsets, and calculated time spans.
 */
function parseUtterance(text: string, rate: number = 0.95): ParsedWord[] {
  const words: ParsedWord[] = [];
  // Match words along with any trailing punctuation to measure pauses
  const regex = /([a-zA-Z0-9']+)([.,!?;:]*)/g;
  let match: RegExpExecArray | null;

  let accumulatedTime = 0;
  const speed = Math.max(0.6, Math.min(1.8, rate));

  while ((match = regex.exec(text)) !== null) {
    const rawWord = match[1];
    const punctuation = match[2];
    const charIndex = match.index;
    const syllables = syllabifyWord(rawWord);

    // Natural speech pacing: 120ms to 240ms per syllable scaled by speed
    const baseSyllableDuration = 150 / speed;
    let wordDuration = 0;
    for (const s of syllables) {
      wordDuration += Math.round(s.relativeDuration * baseSyllableDuration);
    }
    wordDuration = Math.max(140, Math.min(650, wordDuration));

    // Measure trailing punctuation pause (e.g. comma = 160ms, period = 320ms)
    let trailingPauseMs = Math.round(45 / speed);
    if (punctuation.includes('.') || punctuation.includes('?') || punctuation.includes('!')) {
      trailingPauseMs = Math.round(320 / speed);
    } else if (punctuation.includes(',') || punctuation.includes(';') || punctuation.includes(':')) {
      trailingPauseMs = Math.round(180 / speed);
    }

    words.push({
      word: rawWord,
      clean: rawWord.toLowerCase(),
      charIndex,
      charLength: rawWord.length,
      syllables,
      estimatedDurationMs: wordDuration,
      estimatedStartMs: accumulatedTime,
      trailingPauseMs,
    });

    accumulatedTime += wordDuration + trailingPauseMs;
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
  /** Reset all lip-sync state immediately */
  reset: () => void;
  /** Retrieve the current target viseme weights for the active frame */
  getTargetWeights: (currentTimeMs?: number) => VisemeWeights;
  /** Retrieve the full physical animation frame (visemes + jaw + head nod + micro-gaze) */
  getLipSyncFrame: (currentTimeMs?: number) => LipSyncFrame;
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
  let utteranceStartTime = 0;
  let hasReceivedBoundary = false;
  let activeWordIndex = -1;
  let activeWordStartTime = 0;
  let activeWordDuration = 300;

  // Eye micro-gaze wandering state
  let nextGazeShiftTime = 0;
  let currentEyeTarget = { x: 0, y: 0 };

  return {
    startUtterance(text: string, rate: number = 0.95) {
      speaking = false;
      hasReceivedBoundary = false;
      activeWordIndex = -1;
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
      return this.getLipSyncFrame(currentTimeMs).weights;
    },

    getLipSyncFrame(currentTimeMs?: number): LipSyncFrame {
      const now = currentTimeMs ?? performance.now();

      // Gaze micro-saccades (wanders slightly every 2.0 to 3.5 seconds)
      if (now > nextGazeShiftTime) {
        nextGazeShiftTime = now + 2000 + Math.random() * 1500;
        currentEyeTarget = {
          x: (Math.random() - 0.5) * 0.04,
          y: (Math.random() - 0.5) * 0.03,
        };
      }

      if (!speaking || words.length === 0) {
        return {
          weights: { ...ZERO_WEIGHTS },
          jawOpen: 0,
          headNodOffset: 0,
          eyeDartOffset: currentEyeTarget,
        };
      }

      // Determine active word and elapsed offset
      let currentWord: ParsedWord | null = null;
      let elapsedInWord = 0;
      let wordDuration = activeWordDuration;

      if (hasReceivedBoundary && activeWordIndex >= 0 && activeWordIndex < words.length) {
        currentWord = words[activeWordIndex];
        elapsedInWord = now - activeWordStartTime;
      } else {
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
        return {
          weights: { ...ZERO_WEIGHTS },
          jawOpen: 0,
          headNodOffset: 0,
          eyeDartOffset: currentEyeTarget,
        };
      }

      // Check if word has finished and we are in trailing pause (mouth closed/resting)
      if (elapsedInWord > wordDuration) {
        return {
          weights: { ...ZERO_WEIGHTS },
          jawOpen: 0,
          headNodOffset: 0,
          eyeDartOffset: currentEyeTarget,
        };
      }

      // ── Sub-Word Syllable Resolution ──────────────────────────────────────────
      const syllables = currentWord.syllables;
      const totalRelDuration = syllables.reduce((acc, s) => acc + s.relativeDuration, 0) || 1;

      // Find which syllable we are currently inside
      let syllableStartTime = 0;
      let activeSyllable = syllables[0];
      let syllableDuration = (activeSyllable.relativeDuration / totalRelDuration) * wordDuration;

      let accumulated = 0;
      for (let i = 0; i < syllables.length; i++) {
        const syl = syllables[i];
        const sylDur = (syl.relativeDuration / totalRelDuration) * wordDuration;
        if (elapsedInWord >= accumulated && elapsedInWord < accumulated + sylDur) {
          activeSyllable = syl;
          syllableStartTime = accumulated;
          syllableDuration = sylDur;
          break;
        }
        accumulated += sylDur;
        if (i === syllables.length - 1) {
          activeSyllable = syl;
          syllableStartTime = accumulated - sylDur;
          syllableDuration = sylDur;
        }
      }

      const elapsedInSyllable = Math.max(0, elapsedInWord - syllableStartTime);
      const sylProgress = Math.min(1.0, Math.max(0, elapsedInSyllable / Math.max(1, syllableDuration)));

      // ── Envelope Calculation with Bilabial M-P-B Snap ─────────────────────────
      let primaryWeight = 0;
      let secondaryWeight = 0;

      // Bilabial start closure: for M, B, P, mouth snaps shut in first 18% of syllable
      if (activeSyllable.bilabialStart && sylProgress < 0.18) {
        primaryWeight = 0.02;
      }
      // Bilabial end closure: lips snap shut at tail of syllable
      else if (activeSyllable.bilabialEnd && sylProgress > 0.82) {
        primaryWeight = 0.02;
      } else {
        // Natural speech curve: smooth attack (30%), hold/apex (40%), release (30%)
        let envelope = 0;
        if (sylProgress < 0.30) {
          const t = sylProgress / 0.30;
          envelope = Math.sin(t * (Math.PI / 2));
        } else if (sylProgress < 0.70) {
          envelope = 1.0;
        } else {
          const t = (sylProgress - 0.70) / 0.30;
          envelope = Math.cos(t * (Math.PI / 2));
        }

        const peakWeight = activeSyllable.targetWeight * activeSyllable.stress;

        // Diphthong Gliding: if syllable has a glide target (e.g. 'oh' -> 'ou', 'aa' -> 'ih')
        if (activeSyllable.glideTo && activeSyllable.glideRatio !== undefined) {
          if (sylProgress < activeSyllable.glideRatio) {
            primaryWeight = envelope * peakWeight;
            secondaryWeight = 0;
          } else {
            // Smooth crossfade across glide
            const glideT = (sylProgress - activeSyllable.glideRatio) / (1 - activeSyllable.glideRatio);
            primaryWeight = envelope * peakWeight * (1 - glideT);
            secondaryWeight = envelope * (BASE_APERTURE[activeSyllable.glideTo] || peakWeight) * glideT;
          }
        } else {
          primaryWeight = envelope * peakWeight;
        }
      }

      // Add subtle organic micro-variance (prevents uncanny robotic stillness)
      const microJitter = 1.0 + Math.sin(now * 0.025) * 0.03;
      primaryWeight = Math.max(0, Math.min(1.0, primaryWeight * microJitter));
      secondaryWeight = Math.max(0, Math.min(1.0, secondaryWeight * microJitter));

      // Construct final 5-viseme blend weights
      const weights: VisemeWeights = { ...ZERO_WEIGHTS };
      weights[activeSyllable.vowel] = primaryWeight;
      if (activeSyllable.glideTo && secondaryWeight > 0.01) {
        weights[activeSyllable.glideTo] = secondaryWeight;
      }

      // Computed jaw deflection (open vowels drop the physical jaw bone)
      const jawFactor = weights.aa * 0.8 + weights.oh * 0.6 + weights.ou * 0.4 + weights.ee * 0.25;
      const jawOpen = Math.min(1.0, jawFactor);

      // Conversational emphasis head nod: forward pitch impulse on stressed syllables
      const headNodOffset = activeSyllable.stress > 1.05
        ? Math.sin(sylProgress * Math.PI) * 0.018 * activeSyllable.stress
        : 0;

      return {
        weights,
        jawOpen,
        headNodOffset,
        eyeDartOffset: currentEyeTarget,
      };
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
