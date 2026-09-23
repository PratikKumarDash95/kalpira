// ============================================
// stylometryMath.ts — per-answer authenticity statistics
// Feature 3 — Integrity & Authenticity Suite
// ============================================
//
// The pure half of the authenticity layer. Text in, statistics out.
//
// WHAT THIS FILE REFUSES TO DO, AND WHY IT IS THE MOST IMPORTANT PART
//
// The roadmap asked for "burstiness / perplexity — the GPTZero approach". Half of
// that is computable here and half of it is not.
//
// Burstiness is arithmetic: measure how much sentence lengths vary. It is done
// below, and it is honest.
//
// Perplexity is not. A true perplexity is `exp(-mean log P(token | context))`, and
// that probability comes from a language model. There is no way to compute it from
// the text alone. The tempting move is to substitute something easy — a character
// entropy, a word-frequency surprisal against a wordlist — and call it "perplexity"
// in the UI. That substitution would be a number the platform presents as a
// measurement while knowing it measures something else, and it is exactly what the
// project's non-negotiable forbids: never fabricate a measurement.
//
// So this file produces no perplexity. `PERPLEXITY_UNMEASURED_REASON` below is the
// sentence that goes in its place, and `verify-integrity.ts` asserts that no
// function here can return one.
//
// SECOND LIMITATION, STATED PLAINLY
//
// These statistics cannot tell machine-written text from human text. They measure
// uniformity, repetition and register. Uniform, repetitive, formulaic prose is what
// generated answers look like — and also what a rehearsed answer, a nervous answer,
// a second-language answer, and a great many entirely honest answers look like.
// Nothing here identifies an author. It ranks answers by how templated they read,
// which is a reason to look, never a finding.

/** Below this many words, none of these statistics mean anything. */
export const MIN_WORDS_FOR_STYLOMETRY = 40;

/** Sliding window for the length-normalised diversity measure. */
export const MATTR_WINDOW = 50;

/** N-gram size for the repetition measure. */
export const REPETITION_NGRAM = 4;

/** Answers of the candidate's own required before drift can be computed at all. */
export const MIN_BASELINE_ANSWERS = 3;

/**
 * Words an answer needs before its drift figure means anything.
 *
 * HIGHER THAN `MIN_WORDS_FOR_STYLOMETRY`, AND FOR A DIFFERENT REASON.
 *
 * Burstiness and repetition are averages over a text, and an average over forty words
 * is already fairly stable. Drift is a comparison between two frequency
 * DISTRIBUTIONS, and a distribution estimated from forty words is mostly noise: the
 * same person writing two independent answers will produce function-word profiles
 * that differ substantially just from sampling. Measured here, that sampling floor is
 * around 0.3 for a short answer, which would put an honest candidate uncomfortably
 * close to a threshold meant to catch a change of author.
 *
 * So the floor is raised rather than the threshold loosened. Loosening the threshold
 * would have made the signal useless — a real change of author and ordinary sampling
 * noise would overlap — while requiring enough text to estimate a distribution costs
 * nothing but honesty: below this, the answer reports `not measured`, which is true.
 */
export const MIN_WORDS_FOR_DRIFT = 120;

/**
 * The sentence that stands where a perplexity figure would go.
 *
 * Exported so the service layer and the UI quote the same words rather than each
 * inventing a phrasing, and so a verify check can assert it is what gets stored.
 */
export const PERPLEXITY_UNMEASURED_REASON =
    'Perplexity needs a language model and is not computed. It is reported as not measured rather than approximated, because a substitute would be a number presented as a measurement it is not.';

// --------------------------------------------
// Sentence handling
// --------------------------------------------

/**
 * Splits prose into sentences.
 *
 * Deliberately simple: it breaks on terminal punctuation followed by whitespace or
 * end-of-text, and it does not attempt to resolve abbreviations. "Dr. Smith" is
 * therefore two sentences, which slightly changes the sentence count and therefore
 * the burstiness figure.
 *
 * The limitation is accepted rather than fixed because the alternative is an
 * abbreviation dictionary that is wrong in a different way for every domain, and
 * because the statistic that consumes this is a ratio across the whole answer —
 * occasionally splitting one sentence in two moves it very little. Documented rather
 * than hidden, since a reader comparing two burstiness figures deserves to know
 * what produced them.
 */
export function splitSentences(text: string): string[] {
    if (!text) return [];
    return text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}

/** Words, lowercased, with punctuation stripped. Digits are dropped as non-lexical. */
export function tokenize(text: string): string[] {
    if (!text) return [];
    return text
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, ' ')
        .split(/\s+/)
        .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
        .filter((token) => token.length > 0 && !/^\d+$/.test(token));
}

export function countWords(text: string): number {
    return tokenize(text).length;
}

// --------------------------------------------
// Burstiness
// --------------------------------------------

export interface SentenceStats {
    sentenceCount: number;
    meanLength: number;
    /** Coefficient of variation of sentence length. Null when fewer than 2 sentences. */
    burstiness: number | null;
}

/**
 * How much sentence lengths vary.
 *
 * A coefficient of variation, so an answer written in long sentences and one
 * written in short ones are compared fairly — both are "varied" or "uniform"
 * relative to their own average.
 *
 * Null below two sentences, because variation needs something to vary between, and
 * a single sentence would otherwise report a burstiness of zero: the most
 * suspicious possible value, produced by the shortest possible answer.
 */
export function sentenceStats(text: string): SentenceStats {
    const sentences = splitSentences(text);
    const lengths = sentences.map((sentence) => countWords(sentence)).filter((length) => length > 0);

    if (lengths.length < 2) {
        return {
            sentenceCount: sentences.length,
            meanLength: lengths.length === 1 ? lengths[0] : 0,
            burstiness: null,
        };
    }

    const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
    if (mean <= 0) return { sentenceCount: sentences.length, meanLength: 0, burstiness: null };

    const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / (lengths.length - 1);
    return {
        sentenceCount: sentences.length,
        meanLength: mean,
        burstiness: Math.sqrt(variance) / mean,
    };
}

// --------------------------------------------
// Lexical diversity
// --------------------------------------------

/**
 * Moving-average type-token ratio.
 *
 * A raw type-token ratio (unique words ÷ total words) falls as a text gets longer no
 * matter who wrote it, so it would rate a long honest answer as "repetitive" purely
 * for its length. MATTR averages the ratio over a sliding window of fixed size,
 * which removes that dependence — the standard fix, and the reason the registry can
 * give this signal a single threshold that means the same thing for a 60-word answer
 * and a 600-word one.
 *
 * Null when the text is shorter than one window: the measure is undefined there, and
 * reporting 0 would read as maximally repetitive.
 */
export function lexicalDiversity(text: string, window: number = MATTR_WINDOW): number | null {
    const tokens = tokenize(text);
    if (tokens.length < window) return null;

    // One average over the whole text would count a word that appears in every
    // window once per window, which is the point: repetition across the answer
    // lowers the figure.
    const ratios: number[] = [];
    for (let start = 0; start + window <= tokens.length; start += 1) {
        const slice = tokens.slice(start, start + window);
        ratios.push(new Set(slice).size / window);
    }

    if (ratios.length === 0) return null;
    return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

// --------------------------------------------
// Repetition and template structure
// --------------------------------------------

/**
 * Share of word n-grams that occur more than once.
 *
 * Repeated four-word sequences are what boilerplate looks like — a memorised
 * paragraph, a stock answer, a generated one reusing its own scaffolding.
 *
 * Expressed as a share of n-gram POSITIONS, not of distinct n-grams. The distinction
 * matters: counting `sum(count - 1) / distinct` produces figures above 1 for heavily
 * repeated text, which is not a share of anything and would make the registry's
 * threshold unreadable. A position-based share is bounded 0–1 and reads directly as
 * "this fraction of the answer's phrasing appears more than once".
 */
export function repetitionIndex(text: string, n: number = REPETITION_NGRAM): number | null {
    const tokens = tokenize(text);
    if (tokens.length < n * 2) return null;

    const positions: string[] = [];
    const counts = new Map<string, number>();
    for (let i = 0; i + n <= tokens.length; i += 1) {
        const gram = tokens.slice(i, i + n).join(' ');
        positions.push(gram);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    if (positions.length === 0) return null;

    let repeated = 0;
    for (const gram of positions) {
        if ((counts.get(gram) ?? 0) > 1) repeated += 1;
    }
    return repeated / positions.length;
}

/**
 * Connectives that open a sentence in formulaic prose.
 *
 * The list is short on purpose. Every word here is one that a person also uses
 * naturally; what the measure reads is not the presence of any one of them but how
 * often a sentence *starts* with one, which is a shape rather than a habit.
 */
const TEMPLATE_OPENERS = [
    'furthermore',
    'moreover',
    'additionally',
    'in addition',
    'in conclusion',
    'overall',
    'firstly',
    'secondly',
    'thirdly',
    'finally',
    'in summary',
    'to summarize',
    'to sum up',
    'that being said',
    'on the other hand',
    'lastly',
    'ultimately',
];

/**
 * Share of sentences beginning with a stock connective.
 *
 * Null below three sentences: with one or two, "half the sentences opened with
 * furthermore" is not a rate, it is an accident of a short answer.
 */
export function templateLikeStructure(text: string): number | null {
    const sentences = splitSentences(text);
    if (sentences.length < 3) return null;

    const opened = sentences.filter((sentence) => {
        const lower = sentence.toLowerCase();
        return TEMPLATE_OPENERS.some(
            (opener) => lower.startsWith(`${opener} `) || lower.startsWith(`${opener},`)
        );
    }).length;

    return opened / sentences.length;
}

// --------------------------------------------
// Stylometric drift
// --------------------------------------------

/**
 * Function words: the closed-class vocabulary that carries style rather than
 * meaning.
 *
 * Drift is measured on these words specifically, and not on content words, because
 * content changes legitimately and constantly — a candidate asked about databases
 * after being asked about teamwork will use a completely different noun set, and
 * that is the interview working as intended. Function-word frequency is what stays
 * stable across a single person's writing and shifts when the author changes, which
 * is the signal the roadmap is reaching for.
 */
const FUNCTION_WORDS = [
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'because', 'so', 'that', 'which', 'who',
    'whom', 'whose', 'when', 'where', 'while', 'as', 'than', 'then', 'there', 'here',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'this', 'these', 'those',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
    'must', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'about',
    'into', 'over', 'after', 'before', 'between', 'not', 'no', 'very', 'just', 'also',
];

/** Normalised frequency vector over the function-word vocabulary. */
export function functionWordProfile(text: string): Map<string, number> {
    const profile = new Map<string, number>();
    const tokens = tokenize(text);
    if (tokens.length === 0) return profile;

    let functionWordCount = 0;
    for (const token of tokens) {
        if (!FUNCTION_WORDS.includes(token)) continue;
        functionWordCount += 1;
        profile.set(token, (profile.get(token) ?? 0) + 1);
    }
    if (functionWordCount === 0) return profile;

    for (const [word, count] of profile) profile.set(word, count / functionWordCount);
    return profile;
}

/**
 * Total variation distance between two function-word profiles, 0–1.
 *
 * Chosen over a cosine or Euclidean distance because it has a direct reading: it is
 * the share of the vocabulary distribution that would have to move to turn one
 * profile into the other. A figure of 0.5 means half the distribution moved, which
 * a reviewer can hold in their head in a way that "0.83 cosine distance" does not
 * invite.
 */
export function profileDistance(a: Map<string, number>, b: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) return 0;

    const words = new Set([...a.keys(), ...b.keys()]);
    let total = 0;
    for (const word of words) {
        total += Math.abs((a.get(word) ?? 0) - (b.get(word) ?? 0));
    }
    return Math.min(1, total / 2);
}

/**
 * How far this answer sits from the same candidate's own earlier answers.
 *
 * Returns null — not zero — when there is not enough baseline. Zero would mean
 * "this answer reads exactly like your others", which is a confident claim, and
 * with two prior answers the platform has no business making it. The strongest
 * signal in the feature is the one that most needs the discipline of refusing to
 * fire without evidence.
 *
 * The two floors differ deliberately. Each baseline answer only has to be long enough
 * to be worth pooling (`MIN_WORDS_FOR_STYLOMETRY`), because several of them are
 * combined into one distribution; the answer under test has to clear the higher
 * `MIN_WORDS_FOR_DRIFT`, because its profile is the noisy side of the comparison and
 * nothing can average that noise away.
 */
export function stylometricDrift(answer: string, baselineAnswers: readonly string[]): number | null {
    const usableBaseline = baselineAnswers.filter((entry) => countWords(entry) >= MIN_WORDS_FOR_STYLOMETRY);
    if (usableBaseline.length < MIN_BASELINE_ANSWERS) return null;
    if (countWords(answer) < MIN_WORDS_FOR_DRIFT) return null;

    const answerProfile = functionWordProfile(answer);
    if (answerProfile.size === 0) return null;

    // The baseline profile pools every earlier answer, so drift is measured against
    // the candidate's established style rather than against any single answer —
    // which would make one unusually long answer look like a change of author. The
    // pooling is also what keeps the baseline side of the comparison quiet.
    const pooled = usableBaseline.join(' \n ');
    if (countWords(pooled) < MIN_WORDS_FOR_DRIFT) return null;

    const baselineProfile = functionWordProfile(pooled);
    if (baselineProfile.size === 0) return null;

    return profileDistance(answerProfile, baselineProfile);
}

// --------------------------------------------
// The layer's output
// --------------------------------------------

export interface AuthenticityEvidence {
    /** One value per signal this layer can measure. A key absent is not measured. */
    values: Record<string, number | null>;
    wordCount: number;
    sentenceCount: number;
    baselineAnswers: number;
    /** True when at least one signal was computable. */
    measured: boolean;
    /** One sentence naming what was and was not computable. Written for a person. */
    explanation: string;
}

/**
 * Computes every authenticity statistic for one answer.
 *
 * Pure and total. Each figure is independently nullable, because they fail for
 * different reasons: a short answer has no burstiness, a long one still has no
 * drift without a baseline.
 */
export function computeAuthenticity(
    answer: string,
    baselineAnswers: readonly string[] = []
): AuthenticityEvidence {
    const words = countWords(answer);
    const sentences = sentenceStats(answer);
    const usableBaseline = baselineAnswers.filter(
        (entry) => countWords(entry) >= MIN_WORDS_FOR_STYLOMETRY
    ).length;

    const tooShort = words < MIN_WORDS_FOR_STYLOMETRY;

    const values: Record<string, number | null> = {
        stylometricDrift: tooShort ? null : stylometricDrift(answer, baselineAnswers),
        lowBurstiness: sentences.burstiness,
        lowLexicalDiversity: lexicalDiversity(answer),
        highRepetition: repetitionIndex(answer),
        // Reported as not measured, always and deliberately. See the file header.
        perplexity: null,
    };

    const measurable = Object.entries(values).filter(([key]) => key !== 'perplexity');
    const measuredCount = measurable.filter(([, value]) => value !== null).length;
    const measured = measuredCount > 0;

    return {
        values,
        wordCount: words,
        sentenceCount: sentences.sentenceCount,
        baselineAnswers: usableBaseline,
        measured,
        explanation: explain(tooShort, words, usableBaseline, measuredCount, measurable.length),
    };
}

function explain(
    tooShort: boolean,
    words: number,
    baseline: number,
    measuredCount: number,
    considered: number
): string {
    if (tooShort) {
        return `This answer was ${words} words, which is too short for the writing-style measures to mean anything. Nothing was measured from it.`;
    }
    const driftNote =
        baseline >= MIN_BASELINE_ANSWERS
            ? words < MIN_WORDS_FOR_DRIFT
                ? ` Style change could not be computed: it compares word-frequency distributions and needs about ${MIN_WORDS_FOR_DRIFT} words to be stable, and this answer has ${words}.`
                : ''
            : ` Style change could not be computed: it needs at least ${MIN_BASELINE_ANSWERS} earlier answers from the same person and this session has ${baseline}.`;
    return `${measuredCount} of ${considered} writing-style measures were computed for this ${words}-word answer.${driftNote} ${PERPLEXITY_UNMEASURED_REASON}`;
}
