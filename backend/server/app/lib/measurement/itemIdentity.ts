// ============================================
// itemIdentity.ts — What counts as "the same question"
// Part of the Competency Measurement Engine (Feature 1)
//
// PURE MODULE. No DB, no network.
//
// Why this exists: the Question table stores one AI-generated question per
// response (app/api/sessions/[id]/save-response/route.ts), so a Question row is
// never answered twice and can never accumulate calibration data. The thing that
// genuinely repeats across candidates is the question *text*.
//
// So an "item" is defined as a normalised form of the question text. This module
// is the single definition of that normalisation — if two responses produce the
// same key, they were answers to the same item, and their statistics belong
// together.
//
// The normalisation is deliberately conservative. It collapses differences that
// carry no measurement meaning (case, punctuation, whitespace, numbering) and
// preserves everything that does. It must NOT do fuzzy matching: two questions
// that differ in substance must never share a key, because merging them would
// silently corrupt every parameter fitted from them.
// ============================================

import { createHash } from 'node:crypto';

/**
 * Strips the parts of a question that vary between phrasings of the same item
 * without changing what is being asked:
 *
 *   · surrounding whitespace and line breaks
 *   · leading enumeration ("1.", "Q3)", "- ", "•")
 *   · trailing question marks and stray punctuation runs
 *   · casing
 *   · repeated internal whitespace
 *   · markdown emphasis and code fences
 *
 * Deliberately retained: all words, numbers, and identifiers — including
 * numbers inside a question, since "explain O(n log n)" and "explain O(n²)" are
 * different items that must not be merged.
 */
export function normalizeItemText(text: string): string {
    if (!text) return '';

    let normalized = text.normalize('NFKC');

    // Drop markdown code fences and emphasis markers.
    normalized = normalized.replace(/```[a-zA-Z0-9]*/g, ' ');
    normalized = normalized.replace(/[*_`~]/g, '');

    // Collapse all whitespace (including newlines and tabs) to single spaces.
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // Strip a leading enumerator: "1.", "1)", "Q1.", "Q 1)", "a)", "-", "•", "#2".
    normalized = normalized.replace(/^(?:q(?:uestion)?\s*)?\d+\s*[.):\-]?\s*/i, '');
    normalized = normalized.replace(/^(?:[a-z]\s*[.)]\s*)/i, '');
    normalized = normalized.replace(/^[-•*–—]\s*/, '');

    // Remove trailing punctuation noise ("?", "?!", "…", ":").
    normalized = normalized.replace(/[\s?!.:;,–—]+$/g, '');

    // Lowercase last, so the rules above can use case-sensitivity if needed.
    normalized = normalized.toLowerCase();

    // Re-collapse in case the removals exposed new runs of whitespace.
    return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Derives the stable item key for a question text: a truncated SHA-256 of the
 * normalised form.
 *
 * Truncated to 32 hex characters (128 bits). The collision probability across a
 * realistic bank — millions of items — is negligible, and a shorter key keeps
 * indexes and logs readable.
 *
 * Returns an empty string for text that normalises to nothing, which callers
 * must treat as "unidentifiable" and exclude from calibration rather than
 * lumping every empty question into one bogus item.
 */
export function itemKeyFor(text: string): string {
    const normalized = normalizeItemText(text);
    if (!normalized) return '';

    return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Whether two question texts are the same item. Provided so callers never
 * re-implement the comparison — and so the equality rule has one home.
 */
export function isSameItem(a: string, b: string): boolean {
    const keyA = itemKeyFor(a);
    const keyB = itemKeyFor(b);
    return keyA !== '' && keyA === keyB;
}

/**
 * A readable label for an item, for admin screens where the full question text
 * is too long. Truncates on a word boundary rather than mid-word.
 */
export function itemLabel(text: string, maxLength = 80): string {
    const collapsed = (text || '').replace(/\s+/g, ' ').trim();
    if (collapsed.length <= maxLength) return collapsed;

    const cut = collapsed.slice(0, maxLength - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
