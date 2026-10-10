import { createHash } from 'node:crypto';
import Project from '../models/Project.js';

/**
 * TOR version lineage (FR-1.3.1 – FR-1.3.3).
 *
 * e-GP issues a new project_id when an agency cancels and re-announces a
 * tender, so revisions of one procurement live in separate Project records.
 * Records from the same agency whose titles match after normalization form a
 * lineage: they are ordered by announce date, linked V1 → V2 → …, and every
 * record except the newest is marked Superseded.
 */

// Re-announcements land within months. A same-titled tender a year later is
// usually the next fiscal year's contract, not a revision.
export const MAX_REVISION_GAP_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const THAI_DIGITS = /[๐-๙]/g;
// Markers agencies append to re-announced titles. They identify the revision,
// not the procurement, so they are removed before comparison.
const REVISION_MARKERS = [
    /\(?\s*(?:ประกาศ)?ครั้งที่\s*\d+\s*\)?/g,
    /\(\s*(?:ฉบับ)?แก้ไข[^)]*\)/g,
    /\(\s*(?:ประกาศซ้ำ|ใหม่|revised|revision\s*\d*)\s*\)/gi,
];

export function normalizeTitle(title) {
    let value = String(title || '')
        .normalize('NFC')
        .replace(THAI_DIGITS, digit => String(digit.charCodeAt(0) - 0x0E50))
        .toLowerCase();
    for (const marker of REVISION_MARKERS) value = value.replace(marker, ' ');
    return value.replace(/[\s\p{P}\p{S}​-‍﻿]/gu, '');
}

function agencyKey(project) {
    const name = normalizeTitle(project.dept_name);
    if (name) return `dept:${name}`;
    // Feed-discovered tenders learn their agency name only from the invitation PDF.
    if (project.tender?.rss_dept_id) return `rss:${project.tender.rss_dept_id}`;
    return null;
}

/** Identity shared by every revision of one procurement, or null if unknown. */
export function lineageKey(project) {
    const agency = agencyKey(project);
    const title = normalizeTitle(project.project_name);
    if (!agency || !title) return null;
    return createHash('sha256').update(`${agency}|${title}`).digest('hex').slice(0, 32);
}

function announcedAt(project) {
    const value = project.timeline?.announce_date || project.tender?.published_at || project.created_at;
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? null : time;
}

function compareRevisions(a, b) {
    const timeA = announcedAt(a) ?? Infinity;
    const timeB = announcedAt(b) ?? Infinity;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.project_id).localeCompare(String(b.project_id), 'en', { numeric: true });
}

/** Split same-key projects into lineages, oldest first within each. */
export function groupRevisions(projects) {
    const sorted = [...projects].sort(compareRevisions);
    const lineages = [];
    let current = [];
    for (const project of sorted) {
        const previous = current.at(-1);
        const gap = previous && announcedAt(project) !== null && announcedAt(previous) !== null
            ? announcedAt(project) - announcedAt(previous) : 0;
        if (previous && gap > MAX_REVISION_GAP_DAYS * DAY_MS) {
            lineages.push(current);
            current = [];
        }
        current.push(project);
    }
    if (current.length) lineages.push(current);
    return lineages;
}

const STANDALONE = { version: 1, is_latest: true, lineage_id: null, supersedes: null, superseded_by: null };

/** The fields each project should hold once its lineage is linked. */
export function planLineage(lineage) {
    if (lineage.length < 2) {
        return lineage.map(project => ({ project, versionInfo: STANDALONE, status: restoredStatus(project) }));
    }
    const lineageId = lineage[0].project_id;
    return lineage.map((project, index) => {
        const isLatest = index === lineage.length - 1;
        return {
            project,
            versionInfo: {
                version: index + 1,
                is_latest: isLatest,
                lineage_id: lineageId,
                supersedes: index > 0 ? lineage[index - 1].project_id : null,
                superseded_by: isLatest ? null : lineage[index + 1].project_id,
            },
            status: isLatest ? restoredStatus(project) : 'Superseded',
        };
    });
}

// A project that stops being superseded gets back the status it had before.
function restoredStatus(project) {
    if (project.project_status !== 'Superseded') return project.project_status;
    return project.version_info?.status_before_superseded || 'Active';
}

function buildUpdate({ project, versionInfo, status }, key) {
    const current = project.version_info || {};
    const set = {};
    if (project.lineage_key !== key) set.lineage_key = key;
    for (const [field, value] of Object.entries(versionInfo)) {
        if (current[field] !== value) set[`version_info.${field}`] = value;
    }
    if (status !== project.project_status) {
        set.project_status = status;
        if (status === 'Superseded') set['version_info.status_before_superseded'] = project.project_status || 'Active';
    }
    if (!Object.keys(set).length) return null;
    set['version_info.linked_at'] = new Date();
    return { updateMany: { filter: { project_id: project.project_id }, update: { $set: set } } };
}

const LINEAGE_FIELDS = 'project_id project_name dept_name tender.rss_dept_id tender.published_at '
    + 'timeline.announce_date created_at updated_at project_status lineage_key version_info';

// Several records can share a project_id; the most recently updated one wins.
function latestPerProjectId(projects) {
    const byId = new Map();
    for (const project of projects) {
        const existing = byId.get(project.project_id);
        if (!existing || new Date(project.updated_at || 0) > new Date(existing.updated_at || 0)) {
            byId.set(project.project_id, project);
        }
    }
    return [...byId.values()];
}

async function relink(projects, ProjectModel) {
    const groups = new Map();
    for (const project of latestPerProjectId(projects)) {
        const key = lineageKey(project);
        const groupKey = key ?? `standalone:${project.project_id}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { key, projects: [] });
        groups.get(groupKey).projects.push(project);
    }

    const operations = [];
    const stats = { projects: 0, lineages: 0, superseded: 0, updated: 0 };
    for (const { key, projects: members } of groups.values()) {
        const lineages = key ? groupRevisions(members) : members.map(project => [project]);
        for (const lineage of lineages) {
            if (lineage.length > 1) stats.lineages += 1;
            for (const entry of planLineage(lineage)) {
                stats.projects += 1;
                if (entry.status === 'Superseded') stats.superseded += 1;
                const operation = buildUpdate(entry, key);
                if (operation) operations.push(operation);
            }
        }
    }
    if (operations.length) await ProjectModel.bulkWrite(operations, { ordered: false });
    stats.updated = operations.length;
    return stats;
}

/**
 * Re-link the lineages that the given projects belong to, both the lineage
 * they match now and any lineage they left after a title or agency change.
 */
export async function linkProjectRevisions(projectIds, models = {}) {
    const ProjectModel = models.ProjectModel || Project;
    const ids = [...new Set(projectIds)].filter(Boolean);
    if (!ids.length) return { projects: 0, lineages: 0, superseded: 0, updated: 0 };

    const touched = await ProjectModel.find({ project_id: { $in: ids } }).select(LINEAGE_FIELDS).lean();
    const keys = new Set();
    for (const project of touched) {
        if (project.lineage_key) keys.add(project.lineage_key);
        const key = lineageKey(project);
        if (key) keys.add(key);
    }
    const related = keys.size
        ? await ProjectModel.find({ lineage_key: { $in: [...keys] } }).select(LINEAGE_FIELDS).lean()
        : [];
    // Projects that have never been linked have no stored key yet, so also
    // pull in unlinked candidates that compute to one of these keys.
    const unlinked = keys.size
        ? await ProjectModel.find({ lineage_key: { $exists: false }, project_id: { $nin: ids } })
            .select(LINEAGE_FIELDS).lean()
        : [];
    const candidates = unlinked.filter(project => keys.has(lineageKey(project)));
    return relink([...touched, ...related, ...candidates], ProjectModel);
}

/** Recompute every lineage. Used for backfills and after matching rules change. */
export async function linkAllProjectRevisions(models = {}) {
    const ProjectModel = models.ProjectModel || Project;
    const projects = await ProjectModel.find({}).select(LINEAGE_FIELDS).lean();
    return relink(projects, ProjectModel);
}
