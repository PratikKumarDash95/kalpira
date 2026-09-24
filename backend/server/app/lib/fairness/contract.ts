// ============================================
// contract.ts — the fairness flag registry
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// One source of truth for every fairness threshold, every flag this feature may raise,
// the clauses it cites, and the caveats that must travel with its numbers.
//
// THE DIFFERENCE BETWEEN THIS AND THE INTEGRITY REGISTRY
//
// Feature 3's registry protects one candidate from a wrong accusation. This one protects
// a whole group of people from a wrong one, and the asymmetry runs the other way:
//
//   A false integrity flag costs one person a review they should not have had.
//   A false fairness flag costs a study its reputation, and — worse — tells a group of
//   candidates that a process they went through was rigged, on evidence that may be two
//   candidates and a rounding error.
//
// So the thresholds below are deliberately hard to trip, and the refusals are designed
// into the types rather than left to callers. There is no function in this feature that
// returns a ratio it could not compute; there is no flag without a `whatItCannotSay`; and
// there is no verdict anywhere, because a statistical association between a declared
// cohort and a score is not a finding of discrimination and must never be stored as one.
//
// WHAT A COHORT IS ALLOWED TO BE
//
// A cohort is a group the STUDY DECLARED — an institution, a region, an experience band —
// and a person tags each candidate into it. It is never inferred, and it is never a
// protected attribute. See `cohort.ts` for the validation; the point of stating it here is
// that the registry has no flag for "protected class" because the feature has no concept
// of one. This is a design commitment and not a data-protection formality: an inferred
// protected attribute is personal data the candidate never gave, held for a purpose they
// never agreed to, and the surest way not to hold it is to have nowhere to put it.

/** Bumped when a threshold or flag definition changes, and stored on every run. */
export const FAIRNESS_REGISTRY_VERSION = 1;

// --------------------------------------------
// Thresholds
// --------------------------------------------

/**
 * The four-fifths (80%) rule: the point at which US enforcement guidance treats a
 * selection-rate ratio as worth examining.
 *
 * It is a SCREENING device, not a test and not a standard of proof. It has no notion of
 * sample size, which is exactly why every run that reports it also reports a significance
 * test beside it — a ratio below this line computed from six people means very little, and
 * the report must not let a reader forget that.
 */
export const FOUR_FIFTHS_THRESHOLD = 0.8;

/** The significance level for the two-proportion z-test and the chi-square test. */
export const ALPHA = 0.05;

/**
 * Cohen's d at or beyond which a score-distribution gap is worth reporting.
 *
 * 0.5 is the conventional "medium" boundary. It is reported at a lower bar than the
 * selection-rate tests because a mean-score gap is a milder claim than a selection-rate
 * gap: it says two groups scored differently, not that the process filtered one out.
 */
export const LARGE_EFFECT_SIZE = 0.5;

/**
 * The smallest cohort this feature will compute a rate for.
 *
 * Five is not a statistical floor — nothing is reliable at five. It is a FLOOR ON
 * ABSURDITY: below it a ratio is a statement about named individuals rather than about a
 * group, and at three candidates a single person moving is a 33-point swing. A cohort
 * under this size produces "not computed, 3 candidates" and no number at all.
 */
export const MIN_COHORT_N = 5;

/** Smallest number of SCORED answers before a question's cohort gap is examined. */
export const MIN_ITEM_SCORED = 5;

/**
 * The share of a cohort that must have a usable score before its statistics are computed.
 *
 * A cohort of twenty where three have scores is not a cohort of twenty. Below this share
 * the metric is refused with the coverage stated, so the reason a number is missing is
 * always visible on the report.
 */
export const MIN_SCORE_COVERAGE = 0.5;

// --------------------------------------------
// Flags
// --------------------------------------------

export type BiasTargetType = 'cohort' | 'item' | 'dimension' | 'stage';
export type BiasSeverity = 'info' | 'low' | 'medium' | 'high';

export interface BiasFlagDefinition {
    key: string;
    label: string;
    targetType: BiasTargetType;
    severity: BiasSeverity;
    /** The line this flag is raised past. `kind` says which scale it is on. */
    kind: 'ratio' | 'p-value' | 'effect-size';
    threshold: number;
    /**
     * One sentence stating what a flag of this kind CANNOT distinguish. Stored on every
     * flag row, shown beside it, and never empty — asserted here and by verify-fairness.
     *
     * This is the same discipline as the integrity registry's `whatItCannotSay`, applied
     * to a claim about a group. It matters more here, not less: a reader shown "cohort B
     * is selected at 40% of the reference rate" and nothing else has been handed an
     * accusation against everyone in cohort B, made by an algorithm, that they cannot
     * answer because they will never see it.
     */
    whatItCannotSay: string;
    /** What a human should look at. A sentence, never an action the system takes. */
    recommendation: string;
    description: string;
}

/**
 * The registry.
 *
 * Note what is absent: no definition has a `verdict`, a `complianceStatus` or an
 * `action`. A flag says a number crossed a line, states the innocent readings in the same
 * breath, and recommends a human look. That is the strongest claim this feature is willing
 * to make, and the type is the enforcement.
 */
export const BIAS_FLAGS: readonly BiasFlagDefinition[] = [
    {
        key: 'adverseImpactRatio',
        label: 'Selection-rate ratio below four-fifths',
        targetType: 'cohort',
        severity: 'high',
        kind: 'ratio',
        threshold: FOUR_FIFTHS_THRESHOLD,
        whatItCannotSay:
            'It cannot tell a biased process from a cohort that was, in this sample, genuinely weaker on the thing being scored — and it cannot tell either from chance, which is why the significance test is printed beside it. A ratio is a screening figure: the guidance that defines it says so, and it is not a legal finding. It also cannot see anyone who never reached this stage, so it says nothing about who applied.',
        recommendation:
            'Read the ratio together with the p-value and the cohort sizes before drawing any conclusion. If the gap survives that reading, review the questions and dimensions flagged beside this one, and check whether the cohort difference is explained by something the scoring was supposed to measure.',
        description:
            'The share of the cohort at or above the study cutoff, divided by the reference cohort\'s share.',
    },
    {
        key: 'selectionRateSignificantGap',
        label: 'Selection-rate gap distinguishable from chance',
        targetType: 'cohort',
        severity: 'medium',
        kind: 'p-value',
        threshold: ALPHA,
        whatItCannotSay:
            'It cannot say the process caused the gap, that the gap is unfair, or which direction anything ran — only that a gap this size would be unlikely if the two cohorts were drawn from one process. With several cohorts examined at once, one crossing the line by chance is expected, and the report states how many comparisons were made for exactly that reason.',
        recommendation:
            'Treat this as a reason to look at the cohort\'s score distribution and the flagged items, not as a conclusion. Check whether the cohort is large enough for the test to have been stable, and whether the same pattern appears in an earlier run.',
        description:
            'Two-tailed two-proportion z-test comparing the cohort\'s selection rate with the reference cohort\'s.',
    },
    {
        key: 'scoreDistributionGap',
        label: 'Score distribution differs from the reference cohort',
        targetType: 'cohort',
        severity: 'low',
        kind: 'effect-size',
        threshold: LARGE_EFFECT_SIZE,
        whatItCannotSay:
            'It says the two cohorts\' scores sit apart, not that they were treated differently. Two groups scoring differently is the ordinary result of a process that measures something real, and this statistic cannot separate that from a process that measures it unequally. It is also sensitive to a handful of extreme answers in a small cohort.',
        recommendation:
            'Compare the two cohorts\' mean and spread against the dimension-level flags. A gap concentrated in one dimension is worth reading closely; one spread evenly across all five is more often a difference in the sample.',
        description:
            'Cohen\'s d between the cohort\'s mean score and the reference cohort\'s, using the pooled standard deviation.',
    },
    {
        key: 'itemCohortGap',
        label: 'One question separates the cohorts',
        targetType: 'item',
        severity: 'medium',
        kind: 'effect-size',
        threshold: LARGE_EFFECT_SIZE,
        whatItCannotSay:
            'A question that separates cohorts may be measuring something the cohorts genuinely differ on, or it may be written in a way that assumes context one cohort is more likely to have. This statistic cannot distinguish those, and it cannot tell a genuinely harder question from a biased one. Questions are also answered in sequence, so a question that follows a hard one inherits some of its difficulty.',
        recommendation:
            'Read the question with its rubric and check whether answering it well depends on background the study did not intend to measure. If several questions in the same dimension flag together, the dimension flag above is the more useful place to start.',
        description:
            'The standardised gap between the two cohorts\' mean scores on this question.',
    },
    {
        key: 'dimensionCohortGap',
        label: 'One scored dimension separates the cohorts',
        targetType: 'dimension',
        severity: 'medium',
        kind: 'effect-size',
        threshold: LARGE_EFFECT_SIZE,
        whatItCannotSay:
            'A dimension gap is an average over the questions that fed it, so it inherits every caveat attached to them and can be driven by one question. It also cannot tell which of the five dimensions an interview actually exercised: a dimension with few answers behind it will look extreme more easily than one with many.',
        recommendation:
            'Check how many answers fed the dimension before reading the gap as a property of the dimension. If one question carries most of it, the item flag is the more specific finding.',
        description:
            'The standardised gap between the cohorts\' mean scores on this dimension.',
    },
    {
        key: 'cutoffAmplification',
        label: 'The selection cutoff is amplifying a small score difference',
        targetType: 'stage',
        severity: 'info',
        kind: 'ratio',
        threshold: FOUR_FIFTHS_THRESHOLD,
        whatItCannotSay:
            'It cannot say the cutoff is wrong. A cutoff is a study\'s own judgement about who it wants, and a threshold that separates two cohorts sharply may be doing exactly what the study asked for. It also cannot say the small score difference is not real — it says only that the cutoff turns it into a large selection difference, which is a fact about the pipeline rather than about the candidates.',
        recommendation:
            'This is the one finding here whose remedy is usually the cutoff rather than the questions. If the study\'s cutoff was chosen loosely, check what the selection rates would look like at a different one before changing anything about how answers are scored.',
        description:
            'Raised when a cohort breaches four-fifths while its score distribution is close to the reference cohort\'s — a gap created downstream of scoring.',
    },
];

/** Lookup by key. Returns undefined rather than throwing, so callers must handle absence. */
export function biasFlagDefinition(key: string): BiasFlagDefinition | undefined {
    return BIAS_FLAGS.find((definition) => definition.key === key);
}

/** The keys that carry a `severity` above `info`, for a caller that only wants those. */
export function notableFlagKeys(): string[] {
    return BIAS_FLAGS.filter((definition) => definition.severity !== 'info').map((d) => d.key);
}

// --------------------------------------------
// Clause citations
// --------------------------------------------
//
// The report cites three instruments and, for each, states what it is cited FOR and what
// this product does NOT do about it. The second field is the important one.
//
// A compliance report is the single easiest place in a product to tell a comfortable lie
// by omission. "Generated in accordance with NYC Local Law 144" is a sentence a reader
// will take to mean the audit satisfies the law, and this audit does not: the statute
// requires an INDEPENDENT auditor, and a tool auditing itself is not that. The citation
// structure below makes the limitation a required, non-empty field rather than a
// paragraph somebody might drop in a revision, and verify-fairness asserts it stays.

export interface ClauseCitation {
    id: string;
    instrument: string;
    clause: string;
    /** What in this product the clause is cited for. */
    citedFor: string;
    /** Plain statement of the duty. */
    duty: string;
    /** Required and non-empty: what this product does not do about it. */
    doesNotClaim: string;
}

export const CLAUSE_CITATIONS: readonly ClauseCitation[] = [
    {
        id: 'nyc-ll144',
        instrument: 'New York City Local Law 144 of 2021',
        clause: 'Automated employment decision tools — bias audit and publication',
        citedFor:
            'The adverse-impact analysis in this report, and the summary of selection rates and impact ratios by category that accompanies it.',
        duty:
            'Requires an annual bias audit of an automated employment decision tool by an independent auditor, publication of a summary of the audit\'s results, and notice to candidates who are subject to the tool.',
        doesNotClaim:
            'This audit is NOT independent. It was produced by Kalpira, about Kalpira, using Kalpira\'s own scoring records — the statute requires an independent auditor, and this report does not satisfy that requirement. It is also not an annual filing and has not been published in the form the law prescribes. It is the analysis such an audit would begin from.',
    },
    {
        id: 'eu-ai-act-annex-iii',
        instrument: 'EU Artificial Intelligence Act (Regulation (EU) 2024/1689)',
        clause: 'Annex III, point 4 — employment, worker management and access to self-employment',
        citedFor:
            'The decision log that records every AI-scored answer with its model, prompt version and input hash, and the human-review path offered to a candidate.',
        duty:
            'Classifies AI systems used to make or materially influence recruitment and selection decisions as high-risk, bringing duties on risk management, technical documentation, logging of events, transparency, and effective human oversight.',
        doesNotClaim:
            'Nothing here is a conformity assessment, a CE marking, a registration in the EU database, or a declaration of compliance with the Act. This feature produces a log and a review path — two of the inputs a high-risk system\'s provider would need. Whether this system is within the Act\'s scope, and what else it would owe, is a question for the deployer\'s own advisers and not something this report answers.',
    },
    {
        id: 'gdpr-article-22',
        instrument: 'Regulation (EU) 2016/679 (GDPR)',
        clause: 'Article 22 — Automated individual decision-making, including profiling',
        citedFor:
            'The design rationale for the candidate-facing explanation of how a score was produced, and for the request-human-review path beside it.',
        duty:
            'Gives a person the right not to be subject to a decision based SOLELY on automated processing that produces legal effects or similarly significantly affects them, and where such processing is permitted, rights to human intervention, to express a point of view, and to contest the decision.',
        doesNotClaim:
            'Kalpira scores answers; it does not make the hiring decision. Article 22 attaches to decisions made solely by automated means, so this report does not claim the Article applies to this processing, nor that the explanation page discharges an obligation under it. The explanation and the review path are offered because a person is entitled to know how a number about them was produced, whatever the legal characterisation turns out to be.',
    },
];

export function clauseCitation(id: string): ClauseCitation | undefined {
    return CLAUSE_CITATIONS.find((citation) => citation.id === id);
}

// --------------------------------------------
// Caveats
// --------------------------------------------

/**
 * Statements that are true of every run, printed with every report.
 *
 * These are not boilerplate. Each one names a way the numbers above can be read as saying
 * more than they say, and they are assembled by code rather than pasted into a template so
 * that a report cannot be produced without them.
 */
export const BASE_CAVEATS: readonly string[] = [
    'These statistics describe the answers this system scored. They do not describe the hiring decision, because this product does not make one — a human reads the scores.',
    'A selection cutoff is a number the study chose, not a legal standard. Two studies with identical candidates and different cutoffs will produce different selection rates from the same data.',
    'A cohort is a group the study declared and an interviewer assigned. A gap between cohorts is a fact about this sample. It is not evidence of intent, and it is not a legal finding.',
    'Only candidates who completed an interview appear here. People who never started, or who left before answering, are absent — and they are not a random sample of the people who applied.',
    'A statistically significant gap is not proof of unfairness, and its absence is not proof of fairness. The tests below can only detect gaps large enough for the sample to show.',
];

/** Appended to a run whose sample was too thin for the headline numbers. */
export const SMALL_SAMPLE_CAVEAT =
    'This run had too few scored candidates per cohort to compute selection rates. No ratio is reported, because a ratio computed from a handful of people would look like a finding and would not be one.';

/** Appended when some sessions could not be traced to a model decision. */
export const UNVERIFIED_SCORES_CAVEAT =
    'Some answers in this study carry scores that could not be traced to a recorded model decision. They are excluded from the distributions above rather than assumed correct — see the exclusions list for how many.';

/** Appended when any cohort was excluded for incomplete cohort tagging. */
export const INCOMPLETE_TAGGING_CAVEAT =
    'Some candidates in this study have no cohort assignment. They are counted in the exclusions and are in no cohort\'s figures.';

/**
 * What the four-fifths ratio is, stated wherever it is printed.
 *
 * Kept here rather than in the report template so the number and its interpretation cannot
 * be separated by a future edit.
 */
export const FOUR_FIFTHS_EXPLANATION =
    'The four-fifths rule compares each cohort\'s selection rate with a reference cohort\'s. A ratio below 0.8 is a screening signal under US enforcement guidance that a process may warrant examination. It is a rule of thumb with no notion of sample size, which is why a significance test is reported beside every ratio.';
