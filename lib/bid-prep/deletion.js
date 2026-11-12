import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { BidPrepDraft } from '../../models/BidPrepDraft.js';

const FUTURE_FIELDS = ['registration_number', 'address', 'authorized_signatory', 'past_projects'];

const COMPANY_PROJECTION = {
    _id: 1,
    email: 1,
    company_name: 1,
    skills: 1,
    techStack: 1,
    registered_capital: 1,
    highest_past_project_value: 1,
    concurrent_project_capacity: 1,
    certifications: 1,
    registration_number: 1,
    address: 1,
    authorized_signatory: 1,
    past_projects: 1,
};

export function mongoId(userId) {
    const value = String(userId || '');
    if (/^[a-f0-9]{24}$/.test(value)) return new mongoose.Types.ObjectId(value);
    return value;
}

export function emptyCompanyUpdate(now = new Date()) {
    return {
        company_name: '',
        skills: [],
        techStack: [],
        registered_capital: null,
        highest_past_project_value: null,
        concurrent_project_capacity: null,
        certifications: [],
        updatedAt: now,
    };
}

export function companyDataIsEmpty(user) {
    if (!user || typeof user !== 'object') return false;
    if (String(user.company_name || '').trim()) return false;
    for (const key of ['skills', 'techStack', 'certifications', 'past_projects']) {
        if (Array.isArray(user[key]) && user[key].length > 0) return false;
    }
    for (const key of ['registered_capital', 'highest_past_project_value', 'concurrent_project_capacity']) {
        if (user[key] != null && user[key] !== '') return false;
    }
    for (const key of ['registration_number', 'address', 'authorized_signatory']) {
        if (String(user[key] || '').trim()) return false;
    }
    return true;
}

export function mongooseRepos() {
    return {
        async findCompany(userId) {
            return User.collection.findOne({ _id: mongoId(userId) }, { projection: COMPANY_PROJECTION });
        },
        async clearCompanyData(userId) {
            await User.findByIdAndUpdate(userId, {
                $set: emptyCompanyUpdate(),
                $unset: Object.fromEntries(FUTURE_FIELDS.map(field => [field, ''])),
            }, { strict: false });
        },
        async deleteDrafts(userId) {
            const result = await BidPrepDraft.deleteMany({ userId: String(userId) });
            return result?.deletedCount || 0;
        },
        async countDrafts(userId) {
            return BidPrepDraft.countDocuments({ userId: String(userId) });
        },
    };
}

export async function deleteDraftsForUser(userId) {
    const repos = mongooseRepos();
    const deleted = await repos.deleteDrafts(userId);
    const remaining = await repos.countDrafts(userId);
    return { deleted, remaining };
}

/**
 * Clears company bid fields and drafts for one user, then reads them back.
 * Success is returned only when that second read shows the data is gone.
 * The account, email and password hash are left in place.
 */
export async function deleteCompanyBidData(userId, repos = mongooseRepos()) {
    const before = await repos.findCompany(userId);
    if (!before) return { ok: false, status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    await repos.clearCompanyData(userId);
    const draftsDeleted = await repos.deleteDrafts(userId);
    const after = await repos.findCompany(userId);
    const remaining = await repos.countDrafts(userId);
    if (!after || !companyDataIsEmpty(after) || remaining !== 0) {
        return { ok: false, status: 500, code: 'DELETE_INCOMPLETE', message: 'Company data could not be deleted.' };
    }
    return { ok: true, status: 200, draftsDeleted };
}
