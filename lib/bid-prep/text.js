/** Plain-text cleanup for drafts and DOCX export. Markup is never treated as HTML. */

export function sanitizePlainText(value, max) {
    const text = String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .trim();
    return text.slice(0, max);
}

/** Spreadsheet and document consumers must not treat the cell as a formula. */
export function neutralizeFormula(value) {
    const text = String(value ?? '');
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function exportParagraph(value) {
    return xmlEscape(neutralizeFormula(sanitizePlainText(value, 8000)));
}
