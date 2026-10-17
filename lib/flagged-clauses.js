// A bounded project read cache. Full versioned results remain in documentsummaries.
export const MAX_PROJECT_FLAGS = 100;
export function projectFlaggedClauseFields(summary, document, run, extraction = summary?.extraction || {}) {
    const compact = value => value.normalize('NFKC').replace(/\s/g, '');
    const valid = item => typeof item?.clause_text === 'string'
        && typeof (item.reason || item.explanation) === 'string';
    const risks = (Array.isArray(extraction.risk_findings) ? extraction.risk_findings : []).filter(valid);
    const items = [
        ...(Array.isArray(extraction.flagged_clauses) ? extraction.flagged_clauses : []).filter(valid).filter(item => !risks.some(r => r.page === item.page
            && compact(r.clause_text) === compact(item.clause_text))),
        ...risks.map(finding => ({ ...finding, reason: finding.explanation })),
    ];
    const unique = new Map();
    for (const item of items) {
        if (!item?.clause_text?.trim() || !(item.reason || item.explanation)?.trim()) continue;
        const key = `${item.category || 'other'}|${item.page}|${compact(item.clause_text)}`;
        unique.set(key, { clause_text: item.clause_text.slice(0, 4000),
            reason: (item.reason || item.explanation).slice(0, 2000),
            explanation: (item.explanation || item.reason).slice(0, 2000),
            highlight_reason: item.highlight_reason?.slice(0, 400),
            page: item.page, category: item.category, severity: item.severity, confidence: item.confidence });
    }
    const coverage = extraction.analysis_coverage;
    return {
        flagged_clauses: [...unique.values()].slice(0, MAX_PROJECT_FLAGS),
        flagged_clauses_meta: {
            summary_id: summary?._id, document_id: document?._id, extraction_run_id: run?._id,
            prompt_version: summary?.prompt_version, model: summary?.model,
            analysis_status: coverage?.status || (summary ? 'complete' : 'unreadable'),
            skipped_pages: coverage?.skipped_pages || [],
            warnings: extraction.analysis_warnings || [],
            total_flags: unique.size,
            truncated: unique.size > MAX_PROJECT_FLAGS || items.some(item => item.clause_text.length > 4000
                || (item.reason || item.explanation).length > 2000),
            updated_at: summary?.processed_at || summary?.updated_at || new Date(),
        },
    };
}
