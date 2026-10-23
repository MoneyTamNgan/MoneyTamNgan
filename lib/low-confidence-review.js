import Project from '../models/Project.js';

export const LOW_CONFIDENCE_THRESHOLD = 0.70;
const validScore = value => ({ $cond: [{ $and: [{ $isNumber: value }, { $gte: [value, 0] }, { $lte: [value, 1] }] }, value, null] });

export function lowConfidenceReviewPipeline({ page, pageSize, confidenceType = 'either' }) {
    const c = '$__classificationConfidence', e = '$__extractionConfidence';
    const available = { $filter: { input: [c, e], as: 'score', cond: { $ne: ['$$score', null] } } };
    return [
        { $lookup: { from: 'documents', let: { documentId: '$primary_document_id', projectId: '$project_id' }, pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$documentId'] }, { $eq: ['$project_id', '$$projectId'] }] } } },
            { $project: { source_url: 1, filename: 1, entry_name: 1, sha256: 1, 'archive.mime_type': 1 } },
        ], as: '__documents' } },
        { $lookup: { from: 'extractionruns', let: { runId: '$latest_extraction_run_id', documentId: '$primary_document_id', projectId: '$project_id' }, pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$runId'] }, { $eq: ['$document_id', '$$documentId'] }, { $eq: ['$project_id', '$$projectId'] }] } } },
            { $project: { _id: 1 } },
        ], as: '__runs' } },
        { $set: { __document: { $arrayElemAt: ['$__documents', 0] }, __run: { $arrayElemAt: ['$__runs', 0] } } },
        { $lookup: { from: 'documentsummaries', let: { summaryId: '$latest_summary_id', projectId: '$project_id',
            documentId: '$__document._id', runId: '$__run._id', sha256: '$__document.sha256' }, pipeline: [
            { $match: { $expr: { $and: [
                { $eq: ['$_id', '$$summaryId'] }, { $eq: ['$project_id', '$$projectId'] },
                { $eq: ['$document_id', '$$documentId'] }, { $eq: ['$extraction_run_id', '$$runId'] },
                { $eq: ['$document_sha256', '$$sha256'] },
                { $ne: [{ $ifNull: ['$$documentId', null] }, null] }, { $ne: [{ $ifNull: ['$$runId', null] }, null] },
            ] } } },
            { $project: { confidence: 1, 'extraction.confidence': 1,
                'extraction.project_title': 1, 'extraction.project_name': 1, 'extraction.issuing_agency': 1 } },
        ], as: '__summaries' } },
        { $set: { __summary: { $arrayElemAt: ['$__summaries', 0] } } },
        { $set: {
            __classificationConfidence: validScore({ $ifNull: ['$classification.confidence', '$classification_confidence'] }),
            __extractionConfidence: validScore({ $ifNull: ['$__summary.confidence', { $ifNull: ['$__summary.extraction.confidence',
                { $cond: [{ $and: [{ $not: [{ $ifNull: ['$primary_document_id', false] }] },
                    { $not: [{ $ifNull: ['$latest_summary_id', false] }] }] }, '$processing.confidence', null] } ] }] }),
        } },
        { $set: { __confidenceScore: confidenceType === 'classification' ? c : confidenceType === 'extraction' ? e
            : { $cond: [{ $gt: [{ $size: available }, 0] }, { $min: available }, null] } } },
        { $match: { __confidenceScore: { $gte: 0, $lt: LOW_CONFIDENCE_THRESHOLD } } },
        { $sort: { __confidenceScore: 1, updated_at: -1, _id: 1 } },
        { $facet: {
            items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: {
                _id: 0, project_id: 1, project_name: 1, dept_name: 1, is_software: 1, classification: 1,
                pdf_url: 1, primary_document_id: 1, 'processing.status': 1, updated_at: 1,
                __document: 1, __summary: 1, __confidenceScore: 1, __classificationConfidence: 1, __extractionConfidence: 1,
            } }],
            count: [{ $count: 'total' }],
        } },
    ];
}

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
function httpUrl(value) {
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
    catch { return null; }
}

export function toLowConfidenceReviewItem(project) {
    const extraction = project.__summary?.extraction || {};
    const extractedTitle = text(extraction.project_title) || text(extraction.project_name);
    const extractedAgency = text(extraction.issuing_agency);
    const document = project.__document;
    const url = httpUrl(document?.source_url || (!project.primary_document_id ? project.pdf_url : null));
    const archive = Boolean(document?.archive?.mime_type && document.archive.mime_type !== 'application/pdf')
        || Boolean(url && /\.(?:zip|rar)(?:$|[?#])/i.test(url));
    const status = project.classification?.status || 'pending';
    const classificationTag = project.is_software === true ? 'software' : project.is_software === false ? 'not_software'
        : status === 'uncertain' ? 'uncertain' : 'pending';
    const classification = project.__classificationConfidence ?? null;
    const confidence = project.__extractionConfidence ?? null;
    return {
        projectId: project.project_id, projectTitle: extractedTitle || text(project.project_name),
        titleSource: extractedTitle ? 'extracted' : 'government_metadata',
        issuingAgency: extractedAgency || text(project.dept_name),
        agencySource: extractedAgency ? 'extracted' : 'government_metadata',
        classificationTags: [...new Set([classificationTag, status])],
        isSoftware: project.is_software ?? null, classificationStatus: status,
        confidenceScore: project.__confidenceScore,
        confidenceScores: { classification, extraction: confidence },
        reviewReasons: [classification !== null && classification < LOW_CONFIDENCE_THRESHOLD ? 'low_classification_confidence' : null,
            confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD ? 'low_extraction_confidence' : null].filter(Boolean),
        primaryPdfUrl: archive ? null : url,
        primaryDocumentUrl: url, primaryDocumentType: url ? archive ? 'archive' : 'pdf' : null,
        primaryPdfEntryName: archive ? text(document?.entry_name) || text(document?.filename) : null,
        processingStatus: project.processing?.status || null,
    };
}

export async function listLowConfidenceTors(options, { ProjectModel = Project } = {}) {
    const result = await ProjectModel.aggregate(lowConfidenceReviewPipeline(options))
        .option({ maxTimeMS: 15000, allowDiskUse: true });
    const page = result[0] || { items: [], count: [] };
    const total = page.count[0]?.total || 0;
    return { items: page.items.map(toLowConfidenceReviewItem), total, page: options.page, pageSize: options.pageSize,
        totalPages: Math.ceil(total / options.pageSize), threshold: LOW_CONFIDENCE_THRESHOLD,
        confidenceType: options.confidenceType || 'either' };
}
