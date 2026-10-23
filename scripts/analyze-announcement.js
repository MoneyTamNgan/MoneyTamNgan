#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { syncProjectAnnouncement } from '../lib/project-announcement.js';
import { analyzeAnnouncement } from '../lib/announcement-analysis.js';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { loadKeywordSets } from '../lib/keywords.js';

try {
    const ids = process.argv.slice(2);
    if (!ids.length || ids.some(id => !/^\d{11}$/.test(id))) throw new Error('Usage: npm run announcement:analyze -- PROJECT_ID [PROJECT_ID]');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    for (const id of ids) {
        try {
            const project = await Project.findOne({ project_id: id }).lean();
            if (!project) throw new Error('Project not found');
            const software = project.classification?.status === 'manual_override' ? project.is_software
                : classifyProjectMetadata(project, await loadKeywordSets()).isSoftware;
            if (software !== true) {
                console.log(JSON.stringify({ projectId: id, status: 'skipped', reason: 'software_not_confirmed' }));
                continue;
            }
            const synced = await syncProjectAnnouncement(project);
            console.log(JSON.stringify({ database: mongoose.connection.db.databaseName,
                ...await analyzeAnnouncement(synced.project) }, null, 2));
        } catch (error) { console.error(JSON.stringify({ projectId: id, error: error.message })); process.exitCode = 1; }
    }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
