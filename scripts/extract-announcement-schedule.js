import 'dotenv/config';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import { hashFile } from '../lib/document-storage.js';
import { extractAnnouncementSchedule } from '../lib/tender-acquisition.js';
import { announcementScheduleFields } from '../lib/announcement-schedule.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { tenderStatus } from '../lib/egp-rss.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const i = arg.indexOf('=');
    return i === -1 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, i), arg.slice(i + 1)];
}));

try {
    if (!args.file) throw new Error('Usage: npm run schedule:extract -- --file=/path/announcement.pdf [--project-id=ID --write]');
    const extracted = await extractAnnouncementSchedule(args.file);
    console.log(JSON.stringify({ ...extracted.schedule, extraction_method: extracted.method, error: extracted.error }, null, 2));
    if (args.write) {
        if (!args['project-id']) throw new Error('--project-id is required with --write');
        if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required with --write');
        await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
        const project = await Project.findOne({ project_id: args['project-id'] }).lean();
        if (!project?.announcement_document_id) throw new Error('Project must already have an announcement_document_id');
        const document = await Document.findById(project.announcement_document_id).lean();
        const { sha256 } = await hashFile(args.file);
        if (!document || document.project_id !== project.project_id || document.sha256 !== sha256) {
            throw new Error('PDF must match the linked announcement document SHA-256; no database update made');
        }
        const fields = announcementScheduleFields(extracted.schedule, {
                documentId: document._id, sourceUrl: document.source_url,
                method: extracted.method, error: extracted.error,
            });
        fields['tender.status'] = tenderStatus({ hasDraft: Boolean(project.tender?.draft_url),
            hasInvitation: Boolean(document.source_url), closesAt: fields['tender.closes_at'] });
        await Project.updateOne({ _id: project._id, announcement_document_id: document._id },
            { $set: fields }, { runValidators: true });
        console.log(`Stored at ${mongoose.connection.name}.projects { project_id: "${project.project_id}" }`);
    }
} catch (e) {
    console.error(e.message);
    process.exitCode = 1;
} finally {
    await mongoose.disconnect();
}
