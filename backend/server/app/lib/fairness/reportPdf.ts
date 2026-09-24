// ============================================
// reportPdf.ts — the compliance report as a PDF (Feature 4)
// ============================================
//
// Renders the SAME assembled `ComplianceReport` the JSON read and the CSV export render,
// by walking `reportBlocks()` — the one function that decides what order a report's parts
// appear in and what it says about itself. Nothing here re-derives a figure or composes a
// sentence of its own. If the PDF ever disagreed with the JSON about what a run found, one
// of them would be a false record of an audit, and this file must not be the one that is.
//
// WHY A REAL PDF LIBRARY, AND WHY THIS ONE
//
// A compliance report is a document someone files, forwards, and is later asked to produce.
// HTML-printed-to-PDF and hand-rolled PDF bytes both fail that use: neither reliably keeps
// text selectable and searchable, and a scanned-looking report cannot be cited. pdf-lib is
// pure JavaScript with no native build step and no runtime file reads — it embeds the
// standard Helvetica family, so the container needs no font shipped alongside it.
//
// THE CONSTRAINT THAT SHAPES THE REST OF THIS FILE
//
// Standard PDF fonts encode WinAnsi, a superset of Latin-1. A cohort label is study-declared
// text: it can contain a character the font cannot draw — a Greek letter, a CJK name, an
// emoji a candidate put in a study title. pdf-lib throws on those, which would turn a
// download into a 500 rather than a report. So every string is passed through `pdfSafe()`:
//
//   · typographic characters with a faithful ASCII equivalent (curly quotes, en dashes,
//     ellipses, arrows) are transliterated — the meaning is preserved exactly;
//   · anything else becomes '?', and the count of those is carried to the end of the
//     document, where the report says so in its own text.
//
// That last part matters more than it looks. Silently replacing a character in a cohort's
// name on a document that exists to be trustworthy is the same class of failure as printing
// a zero for an unmeasured score: the reader cannot tell that anything was lost. The PDF
// states what it could not reproduce, and the JSON and CSV exports of the same run carry
// the original text in full.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { reportBlocks, type ComplianceReport } from './complianceReport';

const PAGE_WIDTH = 595.28;   // A4 portrait, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
/** Space reserved at the bottom of every page for the footer. */
const FOOTER_BAND = 26;
const BOTTOM_LIMIT = MARGIN + FOOTER_BAND;

const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.38, 0.41, 0.46);
const RULE = rgb(0.79, 0.81, 0.84);
const HEADER_FILL = rgb(0.94, 0.95, 0.96);
const BRAND = rgb(0.98, 0.8, 0.08); // brand lemon — used as a FILL only, never as text

// ─── Character safety ───────────────────────────────────────────────────────

/** True when a code point is inside WinAnsi (Latin-1 plus the 0x80–0x9F glyph set). */
function isWinAnsi(codePoint: number): boolean {
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
    if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
    if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
    // The printable slots in 0x80–0x9F, by Unicode code point.
    return [
        0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
        0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
        0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
    ].includes(codePoint);
}

/**
 * Faithful ASCII equivalents for characters the font cannot draw.
 *
 * ONLY characters outside WinAnsi belong here. `pdfSafe` hands anything WinAnsi can encode
 * to the font unchanged, so an entry for one of those can never fire — and a table that
 * documents a substitution which does not happen is its own small lie. Eleven entries were
 * removed for exactly that reason: the curly quotes, the en and em dashes, the ellipsis, the
 * no-break and soft hyphens, and the multiplication and division signs are all WinAnsi. (An
 * entry for '²' went the same way earlier — U+00B2 is WinAnsi, so it could never fire.)
 *
 * What is NOT here matters as much as what is. Because those characters stay as themselves,
 * the page carries the same punctuation as the JSON and the CSV, so a sentence quoted from
 * one export can be found verbatim in the others.
 *
 * Anything that is neither WinAnsi nor listed here is a real loss, and is counted as one.
 *
 * Written as escapes rather than as the characters themselves: a table of near-identical
 * punctuation is not reviewable as literals.
 */
const TRANSLITERATIONS: Record<string, string> = {
    '\u201B':     "'",      // single high-reversed-9 quotation mark
    '\u2212':     '-',      // minus sign, not the hyphen — which is WinAnsi
    '\u2192':     '->',
    '\u2190':     '<-',
    '\u2265':     '>=',
    '\u2264':     '<=',
    '\u2248':     '~',
    '\u2260':     '!=',
    '\u2009':     ' ',      // thin space
    '\u200A':     ' ',      // hair space
    '\u202F':     ' ',      // narrow no-break space
    '\u200B':     '',       // zero-width space - nothing to draw, and nothing lost
    '\u03C7':     'chi',    // chi, as in the chi-square test
};

/** Accumulates how much text the renderer had to alter, so the document can disclose it. */
interface Loss { count: number }

/**
 * Make a string safe for a standard PDF font.
 *
 * Every character survives as itself, as a faithful equivalent, or as '?' — never by being
 * dropped, because a silently shortened cohort name is worse than a visibly incomplete one.
 * Only the '?' case is counted: the equivalents carry the same meaning.
 */
function pdfSafe(value: string, loss: Loss): string {
    let out = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) continue;
        if (character === '\n' || character === '\r') {
            out += ' ';
            continue;
        }
        if (isWinAnsi(codePoint)) {
            out += character;
            continue;
        }
        const equivalent = TRANSLITERATIONS[character];
        if (equivalent !== undefined) {
            out += equivalent;
            continue;
        }
        out += '?';
        loss.count += 1;
    }
    return out;
}

// ─── Layout ─────────────────────────────────────────────────────────────────

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

interface Cursor {
    doc: PDFDocument;
    fonts: Fonts;
    page: PDFPage;
    /** Baseline of the next line, in PDF coordinates. Descends as content is added. */
    y: number;
    loss: Loss;
}

function newPage(cursor: Cursor): void {
    cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursor.y = PAGE_HEIGHT - MARGIN;
}

/** Start a new page unless `needed` points of vertical space remain above the footer. */
function ensureSpace(cursor: Cursor, needed: number): void {
    if (cursor.y - needed < BOTTOM_LIMIT) newPage(cursor);
}

/**
 * Greedy word wrap, with a hard break for a word too long to fit on a line of its own.
 *
 * The hard break is not cosmetic: cohort labels and reason strings are free text, and one
 * unbroken token longer than the column would otherwise be drawn straight off the page edge
 * and be missing from the document entirely.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    let current = '';

    const pushCurrent = () => { lines.push(current); current = ''; };

    for (const word of text.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            current = candidate;
            continue;
        }
        if (current) pushCurrent();

        if (font.widthOfTextAtSize(word, size) <= maxWidth) {
            current = word;
            continue;
        }
        // Longer than a whole line on its own — break it by character.
        let chunk = '';
        for (const character of word) {
            const attempt = chunk + character;
            if (font.widthOfTextAtSize(attempt, size) > maxWidth && chunk) {
                lines.push(chunk);
                chunk = character;
            } else {
                chunk = attempt;
            }
        }
        current = chunk;
    }
    if (current) pushCurrent();
    return lines.length ? lines : [''];
}

/**
 * A paragraph, a note, or one bullet — anything that is a run of wrapped lines.
 *
 * Returns the baseline of the first line drawn, or null when there was nothing to draw.
 * The caller needs it to place a bullet or another marker beside the item's FIRST line
 * rather than beside its last, which is where the cursor has moved to by the time this
 * returns.
 */
function drawLines(
    cursor: Cursor,
    raw: string,
    options: {
        font: PDFFont;
        size: number;
        leading: number;
        color: ReturnType<typeof rgb>;
        indent?: number;
        firstIndent?: number;
        gapBefore?: number;
        gapAfter?: number;
    }
): number | null {
    const indent = options.indent ?? 0;
    const firstIndent = options.firstIndent ?? 0;
    // Wrapped to the NARROWER of the first-line and continuation-line widths. Using the
    // first line's width would let a continuation line run past the right margin.
    const width = CONTENT_WIDTH - Math.max(indent, indent + firstIndent);
    const lines = wrapText(pdfSafe(raw, cursor.loss), options.font, options.size, width);

    if (options.gapBefore) cursor.y -= options.gapBefore;

    let firstBaseline: number | null = null;
    lines.forEach((line, index) => {
        ensureSpace(cursor, options.leading);
        cursor.y -= options.leading;
        if (firstBaseline === null) firstBaseline = cursor.y;
        cursor.page.drawText(line, {
            x: MARGIN + indent + (index === 0 ? firstIndent : 0),
            y: cursor.y,
            size: options.size,
            font: options.font,
            color: options.color,
        });
    });

    if (options.gapAfter) cursor.y -= options.gapAfter;
    return firstBaseline;
}

/** A section heading with a hairline rule under it. */
function drawHeading(cursor: Cursor, raw: string): void {
    const size = 12.5;
    const leading = 16;
    const text = pdfSafe(raw, cursor.loss);
    const lines = wrapText(text, cursor.fonts.bold, size, CONTENT_WIDTH);

    cursor.y -= 16;
    ensureSpace(cursor, leading * lines.length + 10);

    for (const line of lines) {
        cursor.y -= leading;
        cursor.page.drawText(line, {
            x: MARGIN, y: cursor.y, size, font: cursor.fonts.bold, color: INK,
        });
    }
    cursor.y -= 5;
    cursor.page.drawRectangle({
        x: MARGIN, y: cursor.y, width: CONTENT_WIDTH, height: 0.7, color: RULE,
    });
    cursor.y -= 8;
}

/**
 * A table, with wrapped cells and the header row repeated on every page it spans.
 *
 * The repeat is the point. A table that continues onto a second page without its header is
 * a grid of unlabelled numbers, and the reader has no way to know which column was the
 * adverse impact ratio and which was the count of candidates.
 */
function drawTable(
    cursor: Cursor,
    rawRows: string[][],
    widths: number[] | undefined
): void {
    const size = 7;
    const leading = size * 1.3;
    const padding = 3.5;
    const rowGap = 2.5;

    const rows = rawRows.filter((row) => row.length > 0);
    if (rows.length === 0) return;

    const columnCount = Math.max(...rows.map((row) => row.length));
    // A widths array that does not match the column count would silently misdraw every
    // cell, so it is discarded in favour of an even split rather than trusted.
    const fractions = widths && widths.length === columnCount
        ? widths
        : Array.from({ length: columnCount }, () => 1 / columnCount);
    const columnWidths = fractions.map((fraction) => fraction * CONTENT_WIDTH);

    const layoutRow = (row: string[], font: PDFFont) =>
        Array.from({ length: columnCount }, (_, index) =>
            wrapText(
                pdfSafe(row[index] ?? '', cursor.loss),
                font,
                size,
                Math.max(8, columnWidths[index] - padding * 2)
            )
        );

    const heightOf = (cells: string[][]) =>
        Math.max(...cells.map((lines) => lines.length)) * leading + padding * 2;

    const drawRow = (cells: string[][], font: PDFFont, height: number, fill?: boolean) => {
        const top = cursor.y;
        if (fill) {
            cursor.page.drawRectangle({
                x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: HEADER_FILL,
            });
        }
        let x = MARGIN;
        cells.forEach((lines, index) => {
            let lineY = top - padding;
            for (const line of lines) {
                lineY -= leading;
                cursor.page.drawText(line, {
                    x: x + padding, y: lineY, size, font, color: INK,
                });
            }
            x += columnWidths[index];
        });
        // Cell separators and a baseline rule, so columns stay readable across a page break.
        let ruleX = MARGIN;
        for (let index = 0; index < columnCount - 1; index += 1) {
            ruleX += columnWidths[index];
            cursor.page.drawRectangle({
                x: ruleX, y: top - height, width: 0.4, height, color: RULE,
            });
        }
        cursor.page.drawRectangle({
            x: MARGIN, y: top - height, width: CONTENT_WIDTH, height: 0.5, color: RULE,
        });
        cursor.y = top - height - rowGap;
    };

    const headerCells = layoutRow(rows[0], cursor.fonts.bold);
    const headerHeight = heightOf(headerCells);

    cursor.y -= 4;
    ensureSpace(cursor, headerHeight + leading);
    drawRow(headerCells, cursor.fonts.bold, headerHeight, true);

    for (const row of rows.slice(1)) {
        const cells = layoutRow(row, cursor.fonts.regular);
        const height = heightOf(cells);
        if (cursor.y - height < BOTTOM_LIMIT) {
            newPage(cursor);
            // The table is continuing, not starting: the reader is told so, and given the
            // header again, because the page they are holding has no other context.
            drawLines(cursor, 'Table continued from the previous page', {
                font: cursor.fonts.italic, size: 7.5, leading: 10, color: MUTED,
            });
            cursor.y -= 2;
            drawRow(headerCells, cursor.fonts.bold, headerHeight, true);
        }
        drawRow(cells, cursor.fonts.regular, height);
    }
    cursor.y -= 4;
}

// ─── The document ───────────────────────────────────────────────────────────

/**
 * Render a compliance report to PDF bytes.
 *
 * The block list is walked exhaustively: a block kind this renderer does not recognise
 * throws rather than being skipped. Dropping a block would omit a caveat or a disclaimer
 * from the filed document while leaving the document looking complete, which is the failure
 * mode this whole feature exists to refuse.
 */
export async function renderReportPdf(report: ComplianceReport): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const fonts: Fonts = {
        regular: await doc.embedFont(StandardFonts.Helvetica),
        bold: await doc.embedFont(StandardFonts.HelveticaBold),
        italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    };

    const cursor: Cursor = {
        doc, fonts, page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
        y: PAGE_HEIGHT - MARGIN, loss: { count: 0 },
    };

    doc.setTitle(report.title);
    doc.setSubject(`Fairness audit — ${report.studyName}`);
    doc.setProducer('Kalpira');
    // `generatedAt` is an ISO string on this path, but it is also a field a caller could
    // hand to a fixture. An unparseable one would otherwise turn a download into a 500 —
    // and the report, which is the thing being asked for, would not be served at all.
    const generated = new Date(report.generatedAt);
    if (!Number.isNaN(generated.getTime())) doc.setCreationDate(generated);

    for (const block of reportBlocks(report)) {
        switch (block.kind) {
            case 'title': {
                const text = pdfSafe(block.text ?? '', cursor.loss);
                cursor.y -= 8;
                cursor.page.drawText(text, {
                    x: MARGIN, y: cursor.y, size: 19, font: fonts.bold, color: INK,
                });
                // Brand rule: a fill, not text — the brand lemon does not carry text at any
                // size, so it is used here the way the palette allows.
                cursor.page.drawRectangle({
                    x: MARGIN, y: cursor.y - 8, width: 96, height: 2.4, color: BRAND,
                });
                cursor.y -= 22;
                break;
            }
            case 'subtitle':
                drawLines(cursor, block.text ?? '', {
                    font: fonts.bold, size: 10.5, leading: 14, color: INK,
                    gapBefore: 10, gapAfter: 1,
                });
                break;
            case 'heading':
                drawHeading(cursor, block.text ?? '');
                break;
            case 'paragraph':
                drawLines(cursor, block.text ?? '', {
                    font: fonts.regular, size: 9.5, leading: 13, color: INK, gapAfter: 2,
                });
                break;
            case 'note':
                // Indented and oblique: a note is the report talking about its own figures
                // rather than reporting one, and the typography has to keep that apart.
                drawLines(cursor, block.text ?? '', {
                    font: fonts.italic, size: 8.5, leading: 11.5, color: MUTED,
                    indent: 14, firstIndent: -6, gapAfter: 2,
                });
                break;
            case 'bullets': {
                const items = block.items ?? [];
                if (items.length === 0) break;
                for (const item of items) {
                    const firstBaseline = drawLines(cursor, item, {
                        font: fonts.regular, size: 9.5, leading: 13, color: INK,
                        indent: 12, firstIndent: -12, gapAfter: 2,
                    });
                    // The bullet is drawn beside the item's FIRST line, not concatenated into
                    // its text: a wrapped item then hangs under its own first word instead of
                    // under the bullet.
                    if (firstBaseline !== null) {
                        cursor.page.drawText('-', {
                            x: MARGIN + 2, y: firstBaseline,
                            size: 9.5, font: fonts.regular, color: MUTED,
                        });
                    }
                }
                cursor.y -= 4;
                break;
            }
            case 'table':
                drawTable(cursor, block.rows ?? [], block.widths);
                break;
            case 'spacer':
                cursor.y -= 10;
                break;
            default: {
                // A block kind this renderer has not been taught about. Emitting nothing
                // would quietly shorten a compliance document; failing loudly means the
                // block list and the renderers are kept in step.
                const unknown: never = block.kind;
                throw new Error(`reportPdf: unhandled block kind ${String(unknown)}`);
            }
        }
    }

    // ── The footer text, built BEFORE the loss note ──────────────────────────
    // The study name is free text and appears in the footer as well as in the masthead, so
    // it is put through pdfSafe here rather than after the note is drawn. Building it later
    // would mean a character it had to replace went uncounted, and the note would report a
    // partial total on a document whose whole point is that it declares what it lost.
    const footerLabel = pdfSafe(
        `Kalpira fairness audit · ${report.studyName} · generated ${report.generatedAt}`,
        cursor.loss
    );

    // ── What this rendering could not reproduce ──────────────────────────────
    // Drawn only when something was actually replaced, and only at the end: a note that
    // appears on every document regardless would train its readers to ignore it.
    if (cursor.loss.count > 0) {
        cursor.y -= 12;
        drawLines(
            cursor,
            `Note on this rendering: ${cursor.loss.count} character${cursor.loss.count === 1 ? '' : 's'} in the source text could not be represented in this document's fonts and appear above as "?". The text is not otherwise altered. The JSON and CSV exports of this run reproduce every character exactly.`,
            {
                font: fonts.italic, size: 8.5, leading: 11.5, color: MUTED,
                indent: 14, firstIndent: -6,
            }
        );
    }

    // ── Footers ──────────────────────────────────────────────────────────────
    // Added once every page exists, because "Page 2 of 5" cannot be known while page 5 is
    // still being written. Each page carries the study and the generation date as well as
    // its number: pages get separated, and a sheet with only a page number on it cannot be
    // traced back to the report it came from.
    const pages = doc.getPages();
    pages.forEach((page, index) => {
        page.drawRectangle({
            x: MARGIN, y: MARGIN - 14, width: CONTENT_WIDTH, height: 0.5, color: RULE,
        });
        page.drawText(footerLabel, {
            x: MARGIN, y: MARGIN - 26, size: 7, font: fonts.regular, color: MUTED,
        });
        const number = `Page ${index + 1} of ${pages.length}`;
        const numberWidth = fonts.regular.widthOfTextAtSize(number, 7);
        page.drawText(number, {
            x: MARGIN + CONTENT_WIDTH - numberWidth, y: MARGIN - 26,
            size: 7, font: fonts.regular, color: MUTED,
        });
    });

    // `useObjectStreams: false` — the dictionaries stay as plain objects in the file rather
    // than being packed into a compressed object stream. The trade is a slightly larger
    // file for a document whose every byte is legible to `grep` and to any reader that
    // does not implement object streams. For a report that someone may have to audit, diff
    // or reproduce years from now, legibility is worth the bytes.
    return doc.save({ useObjectStreams: false });
}
