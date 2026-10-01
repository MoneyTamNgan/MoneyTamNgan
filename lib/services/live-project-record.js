import 'server-only';

import connectDB from '../db.js';
import { hydrateProjectCompatibility } from '../project-compat.js';
import Project from '../../models/Project.js';

/** Read the normalized MongoDB records and assemble the existing project view. */
export async function getLiveProjectRecord(projectId) {
    const normalizedId = String(projectId || '').trim();
    if (!normalizedId) return null;

    await connectDB();
    const project = await Project.findOne({ project_id: normalizedId }).lean();
    if (!project) return null;
    return hydrateProjectCompatibility(project);
}
