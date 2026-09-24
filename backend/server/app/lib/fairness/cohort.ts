// ============================================
// cohort.ts — the cohort declaration and its validation
// Feature 4 — Fairness, Bias & Compliance Audit
// ============================================
//
// A cohort is a group a STUDY DECLARED and an interviewer assigned a candidate to. It is
// never inferred, and it is never a protected attribute. This module is where that stops
// being a sentence in a design document and becomes something the code enforces.
//
// WHY THE DENYLIST IS THE MOST IMPORTANT THING IN THIS FILE
//
// The roadmap's definition of done for this feature ends with "zero new PII columns", and
// the schema honours that: there is no column for a gender, a date of birth, a nationality
// or an ethnicity anywhere in the fairness migration, and nothing in this feature infers
// one. But a schema cannot enforce that on its own, because the cohort table is generic —
// `cohortKey` is a string, and a string can hold the word "nationality" as easily as it can
// hold the word "region".
//
// So a study administrator could, without meaning anything sinister, declare a cohort key
// called `gender` and start tagging candidates into it. Every table would still be free of
// PII columns, every check would still pass, and the product would be holding exactly the
// data this feature promised not to hold — special-category personal data, collected for a
// purpose the candidate never agreed to, in the service of an audit that then becomes a
// liability of its own.
//
// `parseCohortDeclaration` therefore REFUSES a declaration naming a protected attribute.
// The refusal is not a warning and the key is not stored: the study runs with that key
// absent and an issue recorded, so the failure is visible and the data is never collected.
// It is a denylist and denylists are incomplete, which is why the reason is stated rather
// than assumed — but the common cases are covered, and a study that hits the list gets a
// message explaining why rather than a silent acceptance.

import { MIN_COHORT_N } from './contract';

/** The largest number of cohort keys one study may declare. */
export const MAX_COHORT_KEYS = 4;

/** The largest number of values one cohort key may declare. */
export const MAX_COHORT_VALUES = 12;

/** Keys are identifiers, not free text: lowercase letters, digits, dash and underscore. */
export const COHORT_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,38}$/;

/**
 * Single tokens that name a protected or special-category attribute.
 *
 * Compared against the tokens of a key, never as substrings — `age` as a substring would
 * reject `language`, `coverage` and `stage`, and a denylist that rejects legitimate
 * vocabulary is a denylist somebody will work around rather than fix.
 */
export const PROTECTED_ATTRIBUTE_TOKENS: readonly string[] = [
    // sex and gender
    'gender', 'sex', 'sexual', 'orientation', 'pregnancy', 'pregnant', 'maternity', 'paternity',
    // race, ethnicity and origin
    'race', 'racial', 'ethnic', 'ethnicity', 'nationality', 'nation', 'origin', 'descent',
    'tribe', 'tribal', 'caste', 'indigenous', 'aboriginal',
    // religion and belief
    'religion', 'religious', 'faith', 'belief', 'creed',
    // age and birth
    'age', 'dob', 'birth', 'birthday', 'birthdate', 'minor',
    // disability and health
    'disability', 'disabled', 'handicap', 'health', 'medical', 'diagnosis', 'condition',
    'medication', 'therapy', 'hiv', 'genetic', 'biometric',
    // family and civil status
    'marital', 'marriage', 'married', 'spouse', 'children', 'dependant', 'dependent',
    // nationality, migration and military
    'immigration', 'immigrant', 'migrant', 'refugee', 'citizenship', 'visa', 'veteran',
    'military', 'reservist',
    // identifiers and appearance
    'surname', 'lastname', 'maiden', 'photo', 'photograph', 'portrait', 'accent', 'dialect',
    'appearance', 'weight', 'height', 'pregnancy_status',
    // financial and legal
    'salary', 'income', 'credit', 'bankruptcy', 'criminal', 'conviction', 'arrest',
];

/**
 * Splits a cohort key into its tokens, so `experienceBand` and `experience_band` both
 * yield `['experience', 'band']` and each token can be compared exactly.
 */
export function splitCohortKeyTokens(key: string): string[] {
    return String(key ?? '')
        // camelCase and PascalCase boundaries first, then any remaining separator.
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0);
}

/**
 * The protected attribute a key names, or null.
 *
 * Returns the offending token rather than a boolean so the refusal message can say which
 * word was the problem, which is the difference between an administrator understanding the
 * refusal and working around it.
 */
export function protectedAttributeIn(key: string): string | null {
    for (const token of splitCohortKeyTokens(key)) {
        if (PROTECTED_ATTRIBUTE_TOKENS.includes(token)) return token;
    }
    return null;
}

// --------------------------------------------
// The declaration
// --------------------------------------------

export interface CohortKeyDeclaration {
    key: string;
    label: string;
    /** Values an interviewer may assign. An undeclared value is refused. */
    values: string[];
    description: string | null;
}

export interface CohortReference {
    key: string;
    value: string;
}

export interface CohortDeclaration {
    cohortKeys: CohortKeyDeclaration[];
    /**
     * The score at or above which an answer counts as selected. Null when the study has
     * declared none — in which case no selection rate can be computed at all, and the run
     * says so rather than inventing a cutoff.
     */
    selectionThreshold: number | null;
    /** The cohort every other cohort is compared against, when the study named one. */
    referenceCohort: CohortReference | null;
    /** A study may raise the minimum cohort size, never lower it below the registry floor. */
    minCohortSize: number;
}

export const EMPTY_DECLARATION: CohortDeclaration = {
    cohortKeys: [],
    selectionThreshold: null,
    referenceCohort: null,
    minCohortSize: MIN_COHORT_N,
};

export interface DeclarationParseResult {
    declaration: CohortDeclaration;
    /**
     * Everything the declaration asked for and did not get, in a sentence a person can act
     * on. Never empty when something was dropped; empty when the declaration was clean.
     */
    issues: string[];
    /** True when the study has declared no cohort keys at all. */
    undeclared: boolean;
}

/**
 * Reads a study's fairness declaration out of its `configJSON`.
 *
 * NEVER THROWS. `configJSON` is free text written by the study author, and a malformed
 * value is a fact about their configuration rather than a reason for an audit route to
 * return a 500. A declaration that cannot be read yields an empty one plus an issue saying
 * why, and the run that follows reports "not computable: the study declares no cohorts"
 * rather than crashing or — much worse — analysing a partially-parsed schema as though it
 * were complete.
 */
export function parseCohortDeclaration(configJSON: string | null | undefined): DeclarationParseResult {
    const issues: string[] = [];
    const declaration: CohortDeclaration = { ...EMPTY_DECLARATION, cohortKeys: [] };

    if (configJSON === null || configJSON === undefined || String(configJSON).trim() === '') {
        return { declaration, issues, undeclared: true };
    }

    let config: any;
    try {
        config = JSON.parse(String(configJSON));
    } catch {
        issues.push('The study configuration is not valid JSON, so no cohort declaration could be read.');
        return { declaration, issues, undeclared: true };
    }

    if (!config || typeof config !== 'object') {
        issues.push('The study configuration is not an object, so no cohort declaration could be read.');
        return { declaration, issues, undeclared: true };
    }

    const fairness = config.fairness;
    if (!fairness || typeof fairness !== 'object') {
        return { declaration, issues, undeclared: true };
    }

    // ── Selection threshold ──────────────────────────────────────────────────
    if (fairness.selectionThreshold !== undefined && fairness.selectionThreshold !== null) {
        const threshold = Number(fairness.selectionThreshold);
        if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
            issues.push(
                `The declared selection cutoff (${JSON.stringify(fairness.selectionThreshold)}) is not a score between 0 and 100, so it was ignored and no selection rate can be computed.`
            );
        } else {
            declaration.selectionThreshold = threshold;
        }
    }

    // ── Cohort keys ──────────────────────────────────────────────────────────
    const rawKeys = fairness.cohortKeys;
    if (Array.isArray(rawKeys)) {
        if (rawKeys.length > MAX_COHORT_KEYS) {
            issues.push(
                `The study declares ${rawKeys.length} cohort keys; only the first ${MAX_COHORT_KEYS} were read. A study with many cohort keys produces many comparisons, and every one of them is a chance of a spurious finding.`
            );
        }

        const seen = new Set<string>();
        for (const raw of rawKeys.slice(0, MAX_COHORT_KEYS)) {
            if (!raw || typeof raw !== 'object') {
                issues.push('A cohort key declaration was not an object and was skipped.');
                continue;
            }

            const key = String(raw.key ?? '').trim();
            if (!COHORT_KEY_PATTERN.test(key)) {
                issues.push(
                    `The cohort key "${key}" is not a valid key. Keys are lowercase letters, digits, dashes and underscores, must start with a letter, and run to 38 characters.`
                );
                continue;
            }
            if (seen.has(key)) {
                issues.push(`The cohort key "${key}" was declared twice; the second declaration was ignored.`);
                continue;
            }

            // THE REFUSAL THIS FILE EXISTS FOR.
            const offending = protectedAttributeIn(key);
            if (offending) {
                issues.push(
                    `The cohort key "${key}" names a protected attribute ("${offending}") and was refused. Kalpira does not collect or infer protected attributes: cohort keys must describe something other than who a candidate is — a region, an institution, a study arm.`
                );
                continue;
            }

            const values: string[] = [];
            const rawValues = Array.isArray(raw.values) ? raw.values : [];
            for (const candidate of rawValues.slice(0, MAX_COHORT_VALUES)) {
                const value = String(candidate ?? '').trim();
                if (value.length === 0 || value.length > 60) {
                    issues.push(`The cohort key "${key}" declares a value that is empty or longer than 60 characters; it was skipped.`);
                    continue;
                }
                if (!values.includes(value)) values.push(value);
            }

            if (values.length < 2) {
                issues.push(
                    `The cohort key "${key}" declares fewer than two values, so it cannot separate anyone into groups and was ignored.`
                );
                continue;
            }

            seen.add(key);
            declaration.cohortKeys.push({
                key,
                label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : key,
                values,
                description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null,
            });
        }
    }

    // ── Reference cohort ─────────────────────────────────────────────────────
    const reference = fairness.referenceCohort;
    if (reference && typeof reference === 'object') {
        const key = String(reference.key ?? '').trim();
        const value = String(reference.value ?? '').trim();
        const declared = declaration.cohortKeys.find((entry) => entry.key === key);
        if (!declared) {
            issues.push(
                `The reference cohort names the key "${key}", which the study does not declare, so it was ignored. A reference cohort is chosen automatically instead.`
            );
        } else if (!declared.values.includes(value)) {
            issues.push(
                `The reference cohort names the value "${value}", which the study does not declare for "${key}", so it was ignored. A reference cohort is chosen automatically instead.`
            );
        } else {
            declaration.referenceCohort = { key, value };
        }
    }

    // ── Minimum cohort size ──────────────────────────────────────────────────
    if (fairness.minCohortSize !== undefined && fairness.minCohortSize !== null) {
        const requested = Number(fairness.minCohortSize);
        if (!Number.isFinite(requested) || requested < MIN_COHORT_N) {
            issues.push(
                `The declared minimum cohort size (${JSON.stringify(fairness.minCohortSize)}) is below the floor of ${MIN_COHORT_N} a rate needs; the floor was used instead.`
            );
        } else {
            declaration.minCohortSize = Math.floor(requested);
        }
    }

    return { declaration, issues, undeclared: declaration.cohortKeys.length === 0 };
}

// --------------------------------------------
// Validating an assignment
// --------------------------------------------

/**
 * The outcome of validating a cohort tag.
 *
 * A string discriminant, not a boolean, because `strict: false` in this backend means a
 * boolean-literal union does not narrow and the refusal branch would be unreachable to the
 * compiler. Same constraint as `Measured<T>` in statistics.ts.
 */
export type AssignmentValidation =
    | { state: 'accepted'; key: string; value: string }
    | { state: 'refused'; reason: string };

/**
 * Checks that a cohort tag names a declared key and a declared value.
 *
 * The second half is what makes the declaration meaningful. Without it a study could
 * declare three experience bands and an interviewer could still tag a candidate
 * `experienceBand: "unsure"`, and the audit would report a cohort of one that no one ever
 * intended to create. An undeclared value is refused rather than stored.
 */
export function validateAssignment(
    declaration: CohortDeclaration,
    key: unknown,
    value: unknown
): AssignmentValidation {
    const cleanKey = String(key ?? '').trim();
    const cleanValue = String(value ?? '').trim();

    if (cleanKey.length === 0) return { state: 'refused', reason: 'No cohort key was given.' };
    if (cleanValue.length === 0) return { state: 'refused', reason: 'No cohort value was given.' };

    const declared = declaration.cohortKeys.find((entry) => entry.key === cleanKey);
    if (!declared) {
        // The protected-attribute case gets its own message, because "you did not declare
        // that key" is true but unhelpful when the reason it was refused is different.
        const offending = protectedAttributeIn(cleanKey);
        if (offending) {
            return {
                state: 'refused',
                reason: `"${cleanKey}" names a protected attribute ("${offending}"). Kalpira does not collect or infer protected attributes.`,
            };
        }
        return {
            state: 'refused',
            reason: `This study does not declare a cohort key called "${cleanKey}". Ask the study owner to add it before tagging candidates.`,
        };
    }

    if (!declared.values.includes(cleanValue)) {
        return {
            state: 'refused',
            reason: `"${cleanValue}" is not one of the values this study declares for "${cleanKey}" (${declared.values.join(', ')}).`,
        };
    }

    return { state: 'accepted', key: cleanKey, value: cleanValue };
}

/** The label for a declared key, falling back to the key itself. */
export function cohortKeyLabel(declaration: CohortDeclaration, key: string): string {
    return declaration.cohortKeys.find((entry) => entry.key === key)?.label ?? key;
}

/** A one-line description of a declaration, for an empty state or a settings panel. */
export function describeDeclaration(declaration: CohortDeclaration): string {
    if (declaration.cohortKeys.length === 0) {
        return 'This study has not declared any cohorts, so no fairness analysis can group its candidates.';
    }
    const keys = declaration.cohortKeys.map((entry) => `${entry.label} (${entry.values.length} values)`);
    const threshold =
        declaration.selectionThreshold === null
            ? 'No selection cutoff is declared, so selection rates cannot be computed.'
            : `A score of ${declaration.selectionThreshold} or above counts as selected.`;
    return `${keys.join(', ')}. ${threshold}`;
}
