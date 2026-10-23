export const FISCAL_BACKFILL_VERSION = 'fiscal-backfill-context-v2';
export const FISCAL_SOURCE_POINTERS = ['primary_document_id', 'latest_extraction_run_id', 'latest_summary_id',
    'announcement_document_id', 'announcement_extraction_run_id', 'announcement_summary_id'];
export const fiscalSourceSnapshot = project => Object.fromEntries(FISCAL_SOURCE_POINTERS.map(key => [key, String(project[key] || '')]));
export function fiscalCacheIsCurrent(project) {
    return project.fiscal_budget_meta?.parser_version === FISCAL_BACKFILL_VERSION
        && FISCAL_SOURCE_POINTERS.every(key => project.fiscal_budget_meta.source_snapshot?.[key] === String(project[key] || ''));
}
