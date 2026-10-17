import 'server-only';

import connectDB from '../db.js';
import { hydrateProjectCompatibility, hydrateProjectsCompatibility } from '../project-compat.js';
import Project from '../../models/Project.js';

function presentationDefaults(project) {
    return { ...project, budget: project.budget ?? 0, timeline: project.timeline || {},
        extracted_data: { qualifications: [], scope_of_work: [], tech_stack: [], ...project.extracted_data },
        anomalies: { high_budget_flag: false, budget_deviation_multiplier: 1,
            flagged_clauses: [], ...project.anomalies },
    };
}

/** Read the normalized MongoDB records and assemble the existing project view. */
export async function getLiveProjectRecord(projectId) {
    const normalizedId = String(projectId || '').trim();
    if (!normalizedId) return null;

    await connectDB();
    const project = await Project.findOne({ project_id: normalizedId }).lean();
    if (!project) return null;
    return presentationDefaults(await hydrateProjectCompatibility(project));
}

export async function listLiveProjectRecords() {
    await connectDB();
    const records = await Project.find({ is_software: true }).sort({ updated_at: -1 }).lean();
    const hydrated = await hydrateProjectsCompatibility(records);
    // Client components require serializable values and complete presentation defaults.
    return JSON.parse(JSON.stringify(hydrated.map(presentationDefaults)));
}
