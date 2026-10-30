import { calculateSkillMatchScore } from '../matchingEngine.js';

function toIsoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function toBudget(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
    return null;
}

function toEvidence(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item.value === 'string')
        .map((item) => ({
            value: item.value,
            ...(typeof item.page === 'number' ? { page: item.page } : {}),
        }));
}

function toBangkokSubmissionDateTime(date, time) {
    if (typeof date !== 'string' || typeof time !== 'string') return null;
    const match = /^(\d{4}-\d{2}-\d{2})\s*(?:T)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(`${date} ${time}`.trim());
    if (!match) return null;

    const [, day, hour, minute, second = '00'] = match;
    const parsed = new Date(`${day}T${hour.padStart(2, '0')}:${minute}:${second}+07:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toBidding(project) {
    const tender = project.tender ?? {};
    const schedule = project.submission_schedule ?? {};
    const submissionDate = tender.submission_date ?? schedule.date ?? null;
    const submissionStartTime = tender.submission_start_time ?? schedule.start_time ?? null;
    const submissionEndTime = tender.submission_end_time ?? schedule.end_time ?? null;
    const opensAt = toIsoDate(schedule.starts_at)
        ?? toBangkokSubmissionDateTime(submissionDate, submissionStartTime);
    // The extracted submission-session end takes priority: it is the actual
    // deadline, including its Bangkok hour and minute. `closes_at` remains a
    // fallback for older records that do not have a parsed schedule yet.
    const closesAt = toIsoDate(schedule.ends_at)
        ?? toBangkokSubmissionDateTime(submissionDate, submissionEndTime)
        ?? toIsoDate(tender.closes_at);
    const statusValue = typeof tender.status === 'string' ? tender.status.trim().toLowerCase() : null;
    const status = statusValue === 'cancelled'
        ? 'cancelled'
        : closesAt
            ? new Date(closesAt).getTime() > Date.now() ? 'open' : 'closed'
            : 'unknown';

    return {
        status,
        // This is the feed/pipeline phase, not the user-facing open/closed
        // state. The latter must keep being derived from the actual deadline.
        phase: statusValue,
        opensAt,
        closesAt,
        submissionDate,
        submissionStartTime,
        submissionEndTime,
        invitationUrl: tender.invitation_url ?? null,
        method: tender.method ?? null,
    };
}

function toAnomalies(project) {
    const anomalyData = project.anomalies ?? {};
    const anomalies = [];

    if (anomalyData.high_budget_flag) {
        anomalies.push({
            type: 'high_budget',
            tag: 'HIGH_BUDGET_ANOMALY',
            ...toBaselineMetadata(anomalyData),
            budgetDeviationMultiplier: anomalyData.budget_deviation_multiplier ?? 1,
        });
    }

    for (const clause of anomalyData.flagged_clauses ?? project.flagged_clauses ?? []) {
        if (!clause?.clause_text || !clause?.reason) continue;
        anomalies.push({
            type: 'flagged_clause',
            clauseText: clause.clause_text,
            reason: clause.reason,
            explanation: clause.explanation ?? clause.reason,
            ...(typeof clause.highlight_reason === 'string'
                ? { highlightReason: clause.highlight_reason }
                : {}),
            ...(typeof clause.category === 'string' ? { category: clause.category } : {}),
            ...(typeof clause.severity === 'string' ? { severity: clause.severity } : {}),
            ...(typeof clause.confidence === 'number' ? { confidence: clause.confidence } : {}),
            ...(typeof clause.page === 'number' ? { page: clause.page } : {}),
        });
    }

    return anomalies;
}

function toDocument(document) {
    if (!document) return null;
    return {
        id: document.id ?? null,
        type: document.type ?? 'unknown',
        filename: document.filename ?? null,
        sourceUrl: document.sourceUrl ?? null,
        mimeType: document.mimeType ?? null,
        sizeBytes: document.sizeBytes ?? null,
        status: document.status ?? null,
        version: document.version ?? null,
        isCurrentPrimary: document.isCurrentPrimary ?? false,
    };
}

function toBaselineMetadata(anomaly) {
    if (!anomaly.baseline_method) return {};
    return { baselinePrice: anomaly.baseline_price ?? null,
        baselineSampleCount: anomaly.baseline_sample_count ?? 0,
        baselineMethod: anomaly.baseline_method,
        tags: toStringArray(anomaly.tags) };
}

export function toTorListItem(project, user = null) {
    const anomalyData = project.anomalies ?? {};
    const extractedData = project.extracted_data ?? {};
    
    let matchScore = null;
    if (user) {
        matchScore = calculateSkillMatchScore(user, project);
    }

    return {
        id: project.project_id,
        title: project.project_name,
        agency: project.dept_name,
        // Older RSS records can be ingested before the announced budget is
        // available. The reference price is a useful fallback, but an absent
        // amount must remain null rather than crashing the dashboard.
        budget: toBudget(project.budget, project.tender?.reference_price),
        projectStatus: project.project_status,
        bidding: toBidding(project),
        fiscalBudget: extractedData.fiscal_budget ?? null,
        announceDate: toIsoDate(project.timeline?.announce_date),
        contractStart: toIsoDate(project.timeline?.contract_start),
        contractEnd: toIsoDate(project.timeline?.contract_end),
        isSoftware: project.is_software ?? null,
        classification: {
            status: project.classification?.status ?? null,
            confidence: project.classification?.confidence ?? project.classification_confidence ?? null,
        },
        documentStatus: project.document?.status ?? null,
        processingStatus: project.processing?.status ?? null,
        techStack: toStringArray(extractedData.tech_stack),
        matchScore,
        anomaly: {
            ...toBaselineMetadata(anomalyData),
            highBudgetFlag: anomalyData.high_budget_flag ?? false,
            budgetDeviationMultiplier: anomalyData.budget_deviation_multiplier ?? 1,
        },
    };
}


export function toTorDetail(project) {
    const extractedData = project.extracted_data ?? {};

    return {
        id: project.project_id,
        title: project.project_name,
        agency: {
            name: project.dept_name,
            subName: project.dept_sub_name ?? null,
        },
        budget: toBudget(project.budget, project.tender?.reference_price),
        projectStatus: project.project_status,
        bidding: toBidding(project),
        pdfUrl: project.pdf_url ?? null,
        documents: {
            tor: toDocument(project.documents?.tor),
            announcement: toDocument(project.documents?.announcement),
        },
        createdAt: toIsoDate(project.created_at),
        updatedAt: toIsoDate(project.updated_at),
        timeline: {
            announceDate: toIsoDate(project.timeline?.announce_date),
            contractStart: toIsoDate(project.timeline?.contract_start),
            contractEnd: toIsoDate(project.timeline?.contract_end),
            durationDays: project.timeline?.duration_days ?? null,
        },
        classification: {
            isSoftware: project.is_software ?? null,
            status: project.classification?.status ?? null,
            confidence: project.classification?.confidence ?? project.classification_confidence ?? null,
            reason: project.classification?.reason ?? null,
            tags: toStringArray(project.classification?.tags),
            reviewedAt: toIsoDate(project.classification?.reviewed_at),
        },
        documentStatus: project.document?.status ?? null,
        processingStatus: project.processing?.status ?? null,
        requirements: toStringArray(extractedData.qualifications),
        scopeOfWork: toStringArray(extractedData.scope_of_work),
        techStack: toStringArray(extractedData.tech_stack),
        summary: extractedData.summary ?? null,
        fiscalBudget: extractedData.fiscal_budget ?? null,
        anomalies: toAnomalies(project),
        version: {
            number: project.version_info?.version ?? 1,
            isLatest: project.version_info?.is_latest ?? true,
            supersededBy: project.version_info?.superseded_by ?? null,
        },
    };
}

export function toTorSummary(project) {
    const extractedData = project.extracted_data ?? {};
    const evidence = extractedData.evidence ?? {};

    return {
        id: project.project_id,
        documentStatus: project.document?.status ?? null,
        processingStatus: project.processing?.status ?? null,
        summary: extractedData.summary ?? null,
        fiscalBudget: extractedData.fiscal_budget ?? null,
        requirements: toStringArray(extractedData.qualifications),
        scopeOfWork: toStringArray(extractedData.scope_of_work),
        techStack: toStringArray(extractedData.tech_stack),
        evidence: {
            requirements: toEvidence(evidence.qualifications),
            scopeOfWork: toEvidence(evidence.scope_of_work),
            techStack: toEvidence(evidence.tech_stack),
        },
    };
}

export function toTorAnomalyReport(project) {
    const anomalyData = project.anomalies ?? {};

    return {
        id: project.project_id,
        ...toBaselineMetadata(anomalyData),
        highBudgetFlag: anomalyData.high_budget_flag ?? false,
        budgetDeviationMultiplier: anomalyData.budget_deviation_multiplier ?? 1,
        anomalies: toAnomalies(project),
    };
}
