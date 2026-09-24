// ============================================
// chunking.ts — turning stored text into embeddable units, deterministically
// ============================================
// Pure. No database, no network, no clock.
//
// Two jobs, and the second is the one that matters.
//
// 1. Split text into units small enough to embed. A stored transcript is a JSON
//    array of messages and can be very long; embeddings degrade as input grows, and
//    a single vector for a forty-minute interview retrieves nothing precisely.
//
// 2. Identify a unit by what it says rather than where it lives. `contentHash` is
//    what makes the indexing sweep idempotent: the sweep hashes the source, compares
//    against the hash stored beside the vector, and skips the provider call when they
//    match. Without it, re-indexing the corpus re-bills for every unchanged
//    transcript, and the feature's cost grows with every sweep rather than with the
//    amount of new text.
//
// The hash is taken over NORMALISED text, not raw text. Otherwise a trailing
// newline, a collapsed space or a non-breaking space would read as a content change
// and trigger a re-embed of identical words.

import { createHash } from 'node:crypto';
import { MAX_EMBED_CHARS } from './contract';

/**
 * Code points that occupy no width: the zero-width space, non-joiner and joiner,
 * and the byte-order mark.
 *
 * They survive NFKC, and JavaScript's `\s` does not match them, so text copied out
 * of a viewer that inserts them would hash differently from the same words typed by
 * hand — and the sweep would re-embed identical content on every pass. Listed by
 * code point rather than as a character class so nothing invisible sits in this
 * source file, where it could be lost by an edit no reviewer could see.
 *
 * THEY BECOME A SPACE, NOT NOTHING
 *
 * Deleting them is the obvious move and it is wrong. A zero-width space sits between
 * words in copied prose — that is what it is for — so deleting it welds "pricing" to
 * "objections" and produces a token that appears in no other document, which is the
 * exact instability this hash exists to remove. Replacing it with a space and letting
 * the whitespace collapse below finish the job gives "pricing objections" whether the
 * separator was a space, a non-breaking space or a zero-width one. When such a
 * character already sits between two spaces, the collapse absorbs it.
 *
 * Splitting a word is the harmless error here: both spellings of the same source text
 * receive the same treatment, so they still hash alike. Merging two words is not.
 */
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

function neutraliseZeroWidth(text: string): string {
    let out = '';
    for (const char of text) {
        const code = char.codePointAt(0);
        out += code !== undefined && ZERO_WIDTH.has(code) ? ' ' : char;
    }
    return out;
}

/**
 * Fold the differences that are not differences of meaning: Unicode form, runs of
 * whitespace, leading and trailing space.
 *
 * Case is folded too. "Pricing objections" and "pricing objections" are the same
 * theme, and a corpus extracted from model output contains both spellings of the
 * same sentence depending on which provider wrote it. Display text is kept
 * separately wherever the original wording matters — `ThemeOccurrence."label"`
 * stores what was actually written.
 */
export function normaliseText(text: string): string {
    return neutraliseZeroWidth(text)
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/** A stable identity for a piece of text, over its normalised form. */
export function contentHash(text: string): string {
    return createHash('sha256').update(normaliseText(text), 'utf8').digest('hex');
}

/** True when the text carries nothing worth embedding. */
export function isBlank(text: string): boolean {
    return normaliseText(text).length === 0;
}

/**
 * Split text into units of at most `maxChars`, preferring paragraph and then
 * sentence boundaries.
 *
 * The same input always produces the same units — the split is derived from the
 * text, never from a random or time-dependent choice — because chunk identity feeds
 * the content hash, and a chunker that reshuffled its boundaries between runs would
 * re-embed the whole corpus on every sweep.
 *
 * A paragraph longer than the limit is split at sentence ends; a sentence longer
 * than the limit (a pasted code block, a wall of unpunctuated speech) is cut at the
 * limit. Truncating instead of splitting would silently drop the end of every long
 * answer, which is where a candidate's conclusion tends to be.
 */
export function chunkText(text: string, maxChars: number = MAX_EMBED_CHARS): string[] {
    const trimmed = text.trim();
    if (trimmed.length === 0) return [];
    if (trimmed.length <= maxChars) return [trimmed];

    const paragraphs = trimmed.split(/\n\s*\n/);
    const chunks: string[] = [];
    let current = '';

    const flush = () => {
        const value = current.trim();
        if (value.length > 0) chunks.push(value);
        current = '';
    };

    for (const paragraph of paragraphs) {
        const piece = paragraph.trim();
        if (piece.length === 0) continue;

        // A paragraph that fits joins the open chunk if there is room for it.
        if (current.length > 0 && current.length + piece.length + 2 <= maxChars) {
            current = `${current}\n\n${piece}`;
            continue;
        }

        flush();

        if (piece.length <= maxChars) {
            current = piece;
            continue;
        }

        // Overlong paragraph: split at sentence ends where possible.
        for (const sentence of splitSentences(piece)) {
            if (sentence.length > maxChars) {
                flush();
                for (const cut of hardSplit(sentence, maxChars)) chunks.push(cut);
                continue;
            }
            if (current.length > 0 && current.length + sentence.length + 1 <= maxChars) {
                current = `${current} ${sentence}`;
            } else {
                flush();
                current = sentence;
            }
        }
    }

    flush();
    return chunks;
}

/** Sentence boundaries, keeping the terminator with the sentence it ends. */
function splitSentences(text: string): string[] {
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Last resort for text with no usable boundary: fixed-width cuts. */
function hardSplit(text: string, maxChars: number): string[] {
    const out: string[] = [];
    for (let index = 0; index < text.length; index += maxChars) {
        out.push(text.slice(index, index + maxChars));
    }
    return out;
}

/**
 * The chunks of a stored transcript, in order.
 *
 * A transcript is stored as a list of messages with a role and content. Each
 * message becomes its own unit rather than the whole conversation being
 * concatenated: a search for "where did the candidate admit not knowing" should
 * return the answer, not the interview containing it, and a vector averaged over
 * forty minutes of dialogue points at nothing in particular.
 *
 * Messages that are blank after normalisation are dropped rather than embedded —
 * an empty unit would produce a vector for no content, which is a row that matches
 * nothing and inflates every count that reads the corpus size.
 */
export function chunkTranscript(
    messages: Array<{ role?: unknown; content?: unknown }>,
    maxChars: number = MAX_EMBED_CHARS,
): Array<{ text: string; role: string; index: number }> {
    const out: Array<{ text: string; role: string; index: number }> = [];
    let index = 0;

    for (const message of messages) {
        const content = typeof message?.content === 'string' ? message.content : '';
        if (isBlank(content)) continue;
        const role = typeof message?.role === 'string' ? message.role : 'unknown';

        for (const chunk of chunkText(content, maxChars)) {
            out.push({ text: chunk, role, index });
            index += 1;
        }
    }

    return out;
}
