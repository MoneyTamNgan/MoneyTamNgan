// Read small metadata projections, never file bytes or the full extracted text.
// A summary is usable only for the current document and extraction version.
export function analyticsArtifactStages() {
    const lookup = (from, localField, as, fields) => ({ $lookup: {
        from, localField, foreignField: '_id', as,
        pipeline: [{ $project: { _id: 1, ...fields } }],
    } });
    return [
        lookup('documents', 'primary_document_id', '_tor', { sha256: 1 }),
        lookup('documents', 'announcement_document_id', '_invitation', {}),
        lookup('extractionruns', 'latest_extraction_run_id', '_run', { document_id: 1 }),
        lookup('documentsummaries', 'latest_summary_id', '_summary', { document_id: 1, document_sha256: 1, extraction_run_id: 1, 'extraction.fiscal_budget': 1 }),
        { $set: {
            _tor: { $ifNull: [{ $arrayElemAt: ['$_tor', 0] }, null] },
            _invitation: { $ifNull: [{ $arrayElemAt: ['$_invitation', 0] }, null] },
            _run: { $ifNull: [{ $arrayElemAt: ['$_run', 0] }, null] },
            _summary: { $ifNull: [{ $arrayElemAt: ['$_summary', 0] }, null] },
        } },
        { $set: { _validSummary: { $and: [
            { $ne: ['$_tor', null] }, { $ne: ['$_run', null] }, { $ne: ['$_summary', null] },
            { $eq: ['$_run.document_id', '$_tor._id'] },
            { $eq: ['$_summary.document_id', '$_tor._id'] },
            { $eq: ['$_summary.extraction_run_id', '$_run._id'] },
            { $or: [
                { $eq: [{ $ifNull: ['$_summary.document_sha256', null] }, null] },
                { $eq: ['$_summary.document_sha256', '$_tor.sha256'] },
            ] },
        ] } } },
        { $set: { _fiscal: { $cond: ['$_validSummary', '$_summary.extraction.fiscal_budget', null] } } },
    ];
}
