// ============================================
// lexicalMath.ts — delivery signals from the transcript's wording
// Feature 2 — Multimodal Delivery Analysis
// ============================================
//
// Filler words and hedges are the two things an interviewer hears instantly and a
// transcript hides. This file counts them.
//
// WHY THE WORD LISTS ARE SMALL ON PURPOSE
//
// The tempting version of this file has forty entries, including "like",
// "actually", "literally", "I think" and "just". That version is wrong, and it is
// wrong in a way that would hurt real candidates, so the reasoning is written out
// rather than left implicit:
//
//   · "like" — "I like distributed systems", "it's like a queue". Genuinely a
//     filler in "it was, like, fine", but the transcript has no intonation and no
//     commas from the recogniser, so the ambiguity cannot be resolved. Excluded
//     from the filler rate. It is counted separately as an observation with no
//     score impact, because telling a candidate to stop saying "like" when they
//     used it correctly is worse than not telling them.
//
//   · "actually" / "literally" / "basically" — discourse markers as often as they
//     are fillers, and "basically" is a legitimate way to introduce a summary.
//     "basically" is kept: in interview answers it is a filler far more often than
//     not, and it is a documented, defensible choice. "actually" and "literally"
//     are excluded as too context-dependent.
//
//   · "I think" — epistemic marking, which is *good* engineering communication.
//     "I think we should shard by tenant, though I'd want to check the write
//     pattern" is a strong answer. Excluded. Its unhedged cousin "I guess" is
//     kept, because that one signals a lack of conviction rather than calibration.
//
// The result is a rate that under-counts rather than over-counts. That direction
// is deliberate: a candidate should never be marked down for a word they used
// correctly, and the cost of missing a filler is one metric moving slightly less.
//
// This file is pure: text in, numbers out. No DB, no provider, no DOM.

/** Words and phrases that are fillers in essentially every context. */
const FILLER_PATTERNS: readonly RegExp[] = [
    /\bum+\b/g,
    /\buh+\b/g,
    /\ber+\b/g,
    /\bah+\b/g,
    /\bhmm+\b/g,
    /\bmmm+\b/g,
    /\byou know\b/g,
    /\bbasically\b/g,
    /\bkind of\b/g,
];

/**
 * Phrases that weaken a claim the speaker probably knows.
 *
 * "kind of" appears in both lists on purpose: it is a filler *and* a hedge, and it
 * is honest for both metrics to see it. Each metric is reported separately and
 * each has its own cap, so the double count cannot compound into a large penalty.
 */
const HEDGE_PATTERNS: readonly RegExp[] = [
    /\bkind of\b/g,
    /\bsort of\b/g,
    /\bi guess\b/g,
    /\bmaybe\b/g,
    /\bprobably\b/g,
    /\bpossibly\b/g,
    /\bsomewhat\b/g,
    /\bi'?m not sure\b/g,
    /\bnot really sure\b/g,
    /\bi suppose\b/g,
];

/**
 * Words counted for information only. They never move a score, and the UI shows
 * them as observations with the reason they are not scored.
 */
const OBSERVATION_PATTERNS: readonly RegExp[] = [/\blike\b/g, /\bactually\b/g, /\bliterally\b/g];

export interface LexicalMetrics {
    /** Words counted in the answer. */
    wordCount: number;
    /** Unambiguous fillers. */
    fillerCount: number;
    /** Fillers per 100 words. 0 when there are no words. */
    fillerRate: number;
    /** Hedging phrases. */
    hedgeCount: number;
    /** Hedges per 100 words. 0 when there are no words. */
    hedgeRate: number;
    /** "like", "actually", "literally" — observed and displayed, never scored. */
    observations: Record<string, number>;
    /** Counts per filler, so the candidate can be shown which one they lean on. */
    fillerBreakdown: Record<string, number>;
    /** Counts per hedge. */
    hedgeBreakdown: Record<string, number>;
}

/**
 * Counts words the way a person would.
 *
 * Splits on whitespace after replacing anything that is not a letter, digit,
 * apostrophe or hyphen with a space. This is not a linguistic tokeniser and does
 * not try to be: it needs to agree with a human's rough word count, and it does.
 * Numbers count as words — "three replicas" is two words.
 *
 * Filler sounds are counted as words too, which is the right call: "um" occupies
 * the same time a word would, so including it makes the speaking rate honest.
 */
export function countWords(text: string): number {
    const cleaned = (text || '')
        .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
        .trim();
    if (!cleaned) return 0;
    return cleaned.split(/\s+/).filter(Boolean).length;
}

/** Counts matches of every pattern, returning a per-pattern breakdown. */
function countPatterns(text: string, patterns: readonly RegExp[], labels: readonly string[]) {
    let total = 0;
    const breakdown: Record<string, number> = {};
    patterns.forEach((pattern, index) => {
        // Each pattern is /g and stateless across calls only because we never use
        // lastIndex — re-creating the regex avoids the classic /g statefulness bug.
        const matches = text.match(new RegExp(pattern.source, 'g'));
        const count = matches ? matches.length : 0;
        if (count > 0) {
            breakdown[labels[index]] = count;
            total += count;
        }
    });
    return { total, breakdown };
}

const FILLER_LABELS = [
    'um', 'uh', 'er', 'ah', 'hmm', 'mmm', 'you know', 'basically', 'kind of',
];
const HEDGE_LABELS = [
    'kind of', 'sort of', 'I guess', 'maybe', 'probably', 'possibly', 'somewhat',
    "I'm not sure", 'not really sure', 'I suppose',
];
const OBSERVATION_LABELS = ['like', 'actually', 'literally'];

/**
 * Computes lexical delivery metrics for one answer.
 *
 * The transcript is lower-cased before matching, so "Um," and "um" are one thing.
 * Contractions are matched both ways ("i'm not sure" and "im not sure") because
 * recognisers disagree about apostrophes.
 */
export function computeLexicalMetrics(transcript: string): LexicalMetrics {
    const raw = transcript || '';
    const text = raw.toLowerCase().replace(/[‘’]/g, "'");

    const wordCount = countWords(raw);
    const fillers = countPatterns(text, FILLER_PATTERNS, FILLER_LABELS);
    const hedges = countPatterns(text, HEDGE_PATTERNS, HEDGE_LABELS);
    const observations = countPatterns(text, OBSERVATION_PATTERNS, OBSERVATION_LABELS);

    const per100 = (count: number) => (wordCount > 0 ? (count / wordCount) * 100 : 0);

    return {
        wordCount,
        fillerCount: fillers.total,
        fillerRate: per100(fillers.total),
        hedgeCount: hedges.total,
        hedgeRate: per100(hedges.total),
        observations: observations.breakdown,
        fillerBreakdown: fillers.breakdown,
        hedgeBreakdown: hedges.breakdown,
    };
}

/**
 * The filler and hedge word lists, for the UI to explain what was counted.
 *
 * Exported so the candidate's screen can say *which* words were looked for. A
 * metric that says "you used 6 fillers" without saying what counts as a filler is
 * not something a person can act on.
 */
export const LEXICAL_DISCLOSURE = {
    fillers: [...FILLER_LABELS],
    hedges: [...HEDGE_LABELS],
    observedOnly: [...OBSERVATION_LABELS],
    excluded: [
        { word: 'like', reason: 'counted as an observation — it is a filler and a verb, and the transcript cannot tell them apart' },
        { word: 'I mean', reason: 'excluded — "I mean the median, not the mean" is a clarification, and the recogniser gives no commas to tell them apart' },
        { word: 'I think', reason: 'excluded — marking a claim as your own view is good calibration, not hedging' },
        { word: 'actually / literally', reason: 'excluded — as often a discourse marker as a filler' },
    ],
} as const;
