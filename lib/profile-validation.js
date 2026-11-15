// Shared by the API and form. Unknown fields are ignored, never persisted.
export const PROFILE_LIMITS = Object.freeze({
    name: 200, company_name: 200, registration_number: 100, address: 2000,
    authorized_signatory: 200, maxProjects: 50, projectText: 200,
    maxListItems: 100, listText: 100, maxMoney: 1e15, maxCapacity: 10000,
    minYear: 2400, maxYear: 2700,
});
export const EMPTY_BID_DETAILS = Object.freeze({ registration_number: '', address: '', authorized_signatory: '', past_projects: [] });

export function validateProfileUpdates(body) {
    const updates = {}, errors = {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { updates, errors: { body: 'Profile must be a JSON object.' } };
    const own = key => Object.prototype.hasOwnProperty.call(body, key);
    const text = (value, max, path, required = false) => {
        if (typeof value !== 'string') { errors[path] = 'Must be text.'; return ''; }
        const trimmed = value.trim();
        if (required && !trimmed) errors[path] = 'This field is required.';
        else if (trimmed.length > max) errors[path] = `Must be at most ${max} characters.`;
        else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) errors[path] = 'Contains unsupported control characters.';
        return trimmed;
    };
    for (const field of ['name', 'company_name', 'registration_number', 'address', 'authorized_signatory']) {
        if (own(field)) updates[field] = text(body[field], PROFILE_LIMITS[field], field);
    }
    for (const field of ['skills', 'techStack', 'certifications']) {
        if (!own(field)) continue;
        if (!Array.isArray(body[field]) || body[field].length > PROFILE_LIMITS.maxListItems) {
            errors[field] = `Must be an array of at most ${PROFILE_LIMITS.maxListItems} text items.`; continue;
        }
        updates[field] = [...new Set(body[field].map((value, i) => text(value, PROFILE_LIMITS.listText, `${field}.${i}`)).filter(Boolean))];
    }
    if (own('skills') && !own('techStack')) updates.techStack = updates.skills;
    if (own('techStack') && !own('skills')) updates.skills = updates.techStack;
    for (const field of ['registered_capital', 'highest_past_project_value', 'concurrent_project_capacity', 'match_score_threshold']) {
        if (!own(field)) continue;
        const value = body[field];
        if (value === null && field !== 'match_score_threshold') { updates[field] = null; continue; }
        const max = field === 'match_score_threshold' ? 100 : field === 'concurrent_project_capacity' ? PROFILE_LIMITS.maxCapacity : PROFILE_LIMITS.maxMoney;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max
            || (field === 'concurrent_project_capacity' && !Number.isInteger(value))) errors[field] = `Must be a ${field === 'concurrent_project_capacity' ? 'whole ' : ''}number between 0 and ${max}.`;
        else updates[field] = value;
    }
    if (own('email_notifications_enabled')) {
        if (typeof body.email_notifications_enabled !== 'boolean') errors.email_notifications_enabled = 'Must be true or false.';
        else updates.email_notifications_enabled = body.email_notifications_enabled;
    }
    if (own('notification_frequency')) {
        if (!['IMMEDIATE', 'DAILY_DIGEST'].includes(body.notification_frequency)) errors.notification_frequency = 'Must be IMMEDIATE or DAILY_DIGEST.';
        else updates.notification_frequency = body.notification_frequency;
    }
    if (own('past_projects')) {
        if (!Array.isArray(body.past_projects) || body.past_projects.length > PROFILE_LIMITS.maxProjects) errors.past_projects = `Must contain at most ${PROFILE_LIMITS.maxProjects} projects.`;
        else updates.past_projects = body.past_projects.map((project, i) => {
            const path = `past_projects.${i}`;
            if (!project || typeof project !== 'object' || Array.isArray(project)) { errors[path] = 'Must be a project object.'; return {}; }
            const item = { name: text(project.name, PROFILE_LIMITS.projectText, `${path}.name`, true),
                client: text(project.client, PROFILE_LIMITS.projectText, `${path}.client`, true) };
            if (typeof project.value !== 'number' || !Number.isFinite(project.value) || project.value < 0 || project.value > PROFILE_LIMITS.maxMoney) errors[`${path}.value`] = `Must be a number between 0 and ${PROFILE_LIMITS.maxMoney}.`;
            else item.value = project.value;
            if (!Number.isInteger(project.year) || project.year < PROFILE_LIMITS.minYear || project.year > PROFILE_LIMITS.maxYear) errors[`${path}.year`] = 'Enter a Buddhist Era year from 2400 to 2700.';
            else item.year = project.year;
            return item;
        });
    }
    return { updates, errors };
}

export function publicContractorProfile(user) {
    return {
        _id: String(user._id), email: user.email, name: user.name || '', company_name: user.company_name || '',
        registration_number: user.registration_number || '', address: user.address || '', authorized_signatory: user.authorized_signatory || '',
        past_projects: (user.past_projects || []).map(({ name, client, value, year }) => ({ name, client, value, year })),
        skills: user.skills?.length ? user.skills : (user.techStack || []),
        techStack: user.techStack?.length ? user.techStack : (user.skills || []),
        registered_capital: user.registered_capital ?? null,
        highest_past_project_value: user.highest_past_project_value ?? null,
        concurrent_project_capacity: user.concurrent_project_capacity ?? null,
        certifications: user.certifications || [], email_notifications_enabled: user.email_notifications_enabled ?? false,
        match_score_threshold: user.match_score_threshold ?? 70, notification_frequency: user.notification_frequency || 'IMMEDIATE',
        updatedAt: user.updatedAt || new Date(),
    };
}
