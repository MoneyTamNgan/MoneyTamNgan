import 'dotenv/config';
import { extractPdfText } from '../lib/text-extraction.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run extract:text -- path/to/document.pdf [--force-ocr]');
try {
    const result = await extractPdfText(file, {
        forceOcr: process.argv.includes('--force-ocr'),
        onProgress: async p => console.log(`Pages ${p.pagesProcessed}/${p.pageCount}; OCR ${p.ocrPages}`),
    });
    const { pages, ...metadata } = result;
    console.log(JSON.stringify(metadata, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
