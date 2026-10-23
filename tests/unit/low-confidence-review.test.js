import { describe, expect, it } from 'vitest';
import { lowConfidenceReviewPipeline, toLowConfidenceReviewItem, listLowConfidenceTors } from '@/lib/low-confidence-review';

describe('low-confidence review', () => {
    it('filters known normalized scores strictly below .70 before pagination/counting', () => {
        const pipeline = lowConfidenceReviewPipeline({ page: 2, pageSize: 5, confidenceType: 'either' });
        const match = pipeline.findIndex(stage => stage.$match?.__confidenceScore);
        const facet = pipeline.findIndex(stage => stage.$facet);
        expect(pipeline[match].$match.__confidenceScore).toEqual({ $gte: 0, $lt: 0.7 });
        expect(match).toBeLessThan(facet);
        expect(pipeline[facet].$facet.items.slice(0, 2)).toEqual([{ $skip: 5 }, { $limit: 5 }]);
        expect(pipeline[facet].$facet.count).toEqual([{ $count: 'total' }]);
    });
    it('joins the current summary through document/run/hash provenance, never an unrelated version', () => {
        const pipeline = lowConfidenceReviewPipeline({ page: 1, pageSize: 10 });
        const summary = pipeline.find(stage => stage.$lookup?.from === 'documentsummaries');
        expect(summary.$lookup.pipeline[0].$match.$expr.$and).toContainEqual({ $eq: ['$document_sha256', '$$sha256'] });
        expect(summary.$lookup.pipeline[0].$match.$expr.$and).toContainEqual({ $eq: ['$extraction_run_id', '$$runId'] });
    });
    it('returns actual title/agency metadata, classification tags, both scores and a direct PDF link', () => {
        const row = toLowConfidenceReviewItem({ project_id: 'p', project_name: 'ชื่อโครงการ', dept_name: 'หน่วยงาน',
            is_software: true, classification: { status: 'software' }, __confidenceScore: 0.65,
            __classificationConfidence: 0.65, __extractionConfidence: 0.9,
            __document: { source_url: 'https://official.example/tor.pdf' } });
        expect(row).toMatchObject({ projectTitle: 'ชื่อโครงการ', issuingAgency: 'หน่วยงาน', titleSource: 'government_metadata',
            classificationTags: ['software'], confidenceScores: { classification: 0.65, extraction: 0.9 },
            primaryPdfUrl: 'https://official.example/tor.pdf', reviewReasons: ['low_classification_confidence'] });
    });
    it('labels existing extracted titles honestly and separates ZIP source links from direct PDFs', () => {
        const row = toLowConfidenceReviewItem({ project_id: 'p', __confidenceScore: 0.6,
            __summary: { extraction: { project_title: 'ชื่อจากเอกสาร', issuing_agency: 'หน่วยงานจากเอกสาร' } },
            __document: { source_url: 'https://official.example/bidding.zip', entry_name: 'tor.pdf' } });
        expect(row.titleSource).toBe('extracted');
        expect(row.agencySource).toBe('extracted');
        expect(row.primaryPdfUrl).toBeNull();
        expect(row.primaryDocumentUrl).toBe('https://official.example/bidding.zip');
        expect(row.primaryPdfEntryName).toBe('tor.pdf');
    });
    it('does not expose stale legacy links for a missing normalized document, or executable URLs', () => {
        expect(toLowConfidenceReviewItem({ primary_document_id: 'missing', pdf_url: 'https://old.example/old.pdf' }).primaryPdfUrl).toBeNull();
        expect(toLowConfidenceReviewItem({ pdf_url: 'javascript:alert(1)' }).primaryPdfUrl).toBeNull();
    });
    it('returns empty out-of-range pages with a consistent total and bounded execution options', async () => {
        let seen;
        const result = await listLowConfidenceTors({ page: 3, pageSize: 5, confidenceType: 'classification' }, {
            ProjectModel: { aggregate: () => ({ option: async options => { seen = options; return [{ items: [], count: [{ total: 7 }] }]; } }) },
        });
        expect(result).toMatchObject({ items: [], total: 7, totalPages: 2, page: 3, pageSize: 5 });
        expect(seen.maxTimeMS).toBe(15000);
    });
});
