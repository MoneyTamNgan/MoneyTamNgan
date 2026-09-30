# Thai OCR quality improvements — 2026-09-08

## Implemented

- Preserve the embedded-text-first path. OCR remains the fallback unless explicitly forced.
- Render at 300 DPI by default, reducing DPI only when necessary to respect the 5000-pixel longest-side limit. Configure with `OCR_DPI` (200–600) and `OCR_MAX_DIMENSION` (3500–10000).
- Run Tesseract `tha+eng` with automatic page segmentation (PSM 3), then a second layout (PSM 6) for financial, low-confidence, or unusable text.
- Preserve raw OCR text, both candidates, confidence, selected layout, and warnings in page JSON artifacts.
- Compare Arabic/Thai numerical amounts with parenthesized Thai amount words. Compare amounts across OCR candidates and usable embedded text. Never silently replace a number.
- Require review for recognized financial OCR pages even when both passes agree and confidence is high. This is intentionally conservative, not a calibrated accuracy guarantee.
- Persist page numbers and warning codes in `ocr.review_pages`; OCR review flags prevent a project from being marked `completed`, including when reusing an AI summary.
- Version extraction checkpoints as `thai-text-v2.1-quality`. Old OCR checkpoints and summaries cannot bypass the new quality checks on reprocessing.

## Verification

- 46 automated tests passed, covering currency parsing, the observed numerical error, candidate disagreement, cached-summary review enforcement, processor-version invalidation, and worker persistence through mocked database/Vertex dependencies.
- Production build passed.
- Tested the real four-page `002-annoudoc_0800600020_68019088742.pdf` locally, with and without forced OCR.
- Normal embedded extraction used zero OCR pages and returned no review flags.
- Forced OCR detected `amount_words_mismatch` on page 2: numerical OCR was 50,000,000 while the words were “แปดสิบล้านบาทถ้วน” (80,000,000). Visual inspection of the rendered source confirms 80,000,000. The document now requires review instead of passing solely on confidence.
- This turn did not rerun the live cloud/database workflow or a full 145-page TOR. Worker review behavior was tested with mocks; the real PDF test exercised local Poppler/Tesseract.

## Try it

```sh
npm run extract:text -- path/to/document.pdf
npm run extract:text -- path/to/document.pdf --force-ocr
```

The command prints `artifactPath`, `needsReview`, and `reviewPages`. Open the artifact JSON to inspect `pages[].text`, `raw_text`, `candidates`, and `warnings`. This extraction-only command does not update MongoDB; normal worker processing persists OCR metadata and review status.

## Remaining limitations

The OCR engine still misreads the example digit; the improvement detects and contains that error rather than claiming to correct it. Financial review can produce false positives, and amounts not recognized as financial text can escape these checks. Skewed scans, complex tables, and damaged fonts need a broader labeled Thai PDF evaluation set. Human source verification is still necessary for important amounts. A higher-quality OCR provider should be benchmarked before replacing Tesseract; Vertex summary confidence is not proof of source-text accuracy.

Rendering choices follow [Tesseract's image-quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html). The PDF skill's visual-check workflow was used to verify the disputed amount against the rendered page.
