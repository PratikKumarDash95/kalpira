// Shared helpers for collecting/importing interview candidates.
// Used by both the interviewer Dashboard "Assign" modal and the Setup "Launch" step
// so the multi-candidate + Excel/CSV import behavior stays identical in both places.
import JSZip from 'jszip';

export interface AssignmentCandidate {
    id: string;
    name: string;
    email: string;
    source: 'manual' | 'file';
}

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createCandidate = (source: AssignmentCandidate['source'] = 'manual'): AssignmentCandidate => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    email: '',
    source,
});

const normalizeCell = (value: string) => value.replace(/\s+/g, ' ').trim();

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

const columnIndexFromRef = (cellRef: string, fallback: number) => {
    const letters = cellRef.replace(/[0-9]/g, '').toUpperCase();
    if (!letters) return fallback;
    return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const detectDelimiter = (firstLine: string): string => {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuote = false;
    for (const ch of firstLine) {
        if (ch === '"') inQuote = !inQuote;
        else if (!inQuote && (ch === ',' || ch === ';' || ch === '\t')) {
            counts[ch as ',' | ';' | '\t'] += 1;
        }
    }
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as string) || ',';
};

export const parseCsvRows = (rawText: string): string[][] => {
    // Strip UTF-8 BOM, normalize trailing whitespace
    const text = rawText.replace(/^﻿/, '');
    const firstLineEnd = text.search(/[\r\n]/);
    const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const delimiter = detectDelimiter(firstLine);

    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (char === '"' && quoted && next === '"') {
            cell += '"';
            index += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === delimiter && !quoted) {
            row.push(normalizeCell(cell));
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(normalizeCell(cell));
            if (row.some(Boolean)) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    // Flush any final cell (even if unterminated quote — better than dropping it silently)
    if (cell.length > 0 || row.length > 0) {
        row.push(normalizeCell(cell));
        if (row.some(Boolean)) rows.push(row);
    }
    return rows;
};

export const parseXlsxRows = async (file: File): Promise<string[][]> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const sharedStrings = sharedXml
        ? Array.from(parseXml(sharedXml).getElementsByTagName('si')).map(item =>
            normalizeCell(Array.from(item.getElementsByTagName('t')).map(node => node.textContent || '').join(''))
        )
        : [];

    const sheetPath = zip.file('xl/worksheets/sheet1.xml')
        ? 'xl/worksheets/sheet1.xml'
        : Object.keys(zip.files).find(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));

    if (!sheetPath) return [];

    const sheetXml = await zip.file(sheetPath)?.async('string');
    if (!sheetXml) return [];

    const sheet = parseXml(sheetXml);
    return Array.from(sheet.getElementsByTagName('row')).map(rowNode => {
        const row: string[] = [];

        Array.from(rowNode.getElementsByTagName('c')).forEach((cellNode, fallbackIndex) => {
            const ref = cellNode.getAttribute('r') || '';
            const type = cellNode.getAttribute('t');
            const index = columnIndexFromRef(ref, fallbackIndex);
            const valueNode = cellNode.getElementsByTagName('v')[0];
            const inlineNode = cellNode.getElementsByTagName('t')[0];
            const rawValue = valueNode?.textContent || inlineNode?.textContent || '';
            const value = type === 's' ? sharedStrings[Number(rawValue)] || '' : rawValue;
            if (index >= 0) row[index] = normalizeCell(value);
        });

        return row.map(cell => cell || '');
    }).filter(row => row.some(Boolean));
};

export const candidatesFromRows = (rows: string[][]): AssignmentCandidate[] => {
    if (!rows.length) return [];

    const header = rows[0].map(cell => cell.toLowerCase());
    const headerHasLabels = header.some(cell => cell.includes('name') || cell.includes('email') || cell.includes('mail'));
    const nameIndex = header.findIndex(cell => cell.includes('name') || cell.includes('candidate'));
    const emailIndex = header.findIndex(cell => cell.includes('email') || cell.includes('mail'));
    const dataRows = headerHasLabels ? rows.slice(1) : rows;

    return dataRows.flatMap(row => {
        const detectedEmailIndex = emailIndex >= 0 ? emailIndex : row.findIndex(cell => emailPattern.test(cell.toLowerCase()));
        if (detectedEmailIndex < 0) return [];

        const detectedNameIndex = nameIndex >= 0
            ? nameIndex
            : row.findIndex((cell, index) => index !== detectedEmailIndex && cell && !emailPattern.test(cell.toLowerCase()));

        const name = normalizeCell(row[detectedNameIndex] || '');
        const email = normalizeCell(row[detectedEmailIndex] || '').toLowerCase();

        if (!name || !emailPattern.test(email)) return [];
        return [{ ...createCandidate('file'), name, email }];
    });
};
