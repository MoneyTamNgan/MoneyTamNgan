function toIsoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
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

function toAnomalies(project) {
    const anomalyData = project.anomalies ?? {};
    const anomalies = [];

    if (anomalyData.high_budget_flag) {
        anomalies.push({
            type: 'high_budget',
            budgetDeviationMultiplier: anomalyData.budget_deviation_multiplier ?? 1,
        });
    }

    for (const clause of anomalyData.flagged_clauses ?? []) {
        if (!clause?.clause_text || !clause?.reason) continue;
        anomalies.push({
            type: 'flagged_clause',
            clauseText: clause.clause_text,
            reason: clause.reason,
            ...(typeof clause.page === 'number' ? { page: clause.page } : {}),
        });
    }

    return anomalies;
}

export function toTorListItem(project) {
    return {
        id: project.project_id,
        title: project.project_name,
        agency: project.dept_name,
        budget: project.budget,
        projectStatus: project.project_status,
        announceDate: toIsoDate(project.timeline?.announce_date),
        isSoftware: project.is_software ?? null,
        classification: {
            status: project.classification?.status ?? null,
            confidence: project.classification?.confidence ?? project.classification_confidence ?? null,
        },
        documentStatus: project.document?.status ?? null,
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
        budget: project.budget,
        projectStatus: project.project_status,
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
        },
        documentStatus: project.document?.status ?? null,
        processingStatus: project.processing?.status ?? null,
        requirements: toStringArray(extractedData.qualifications),
        scopeOfWork: toStringArray(extractedData.scope_of_work),
        techStack: toStringArray(extractedData.tech_stack),
        summary: extractedData.summary ?? null,
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
        highBudgetFlag: anomalyData.high_budget_flag ?? false,
        budgetDeviationMultiplier: anomalyData.budget_deviation_multiplier ?? 1,
        anomalies: toAnomalies(project),
    };
}
