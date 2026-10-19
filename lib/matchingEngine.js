export const SKILL_ALIASES = {
    'service virtualization': 'service virtualization',
    'ipaas': 'ipaas',
    'integration platforms as a service': 'ipaas',
    'ms project': 'ms project',
    'microsoft project': 'ms project',
    'ms excel': 'ms excel',
    'microsoft excel': 'ms excel',
    'excel': 'ms excel',
    'utp': 'utility platform',
    'utility platform': 'utility platform',
    'erp': 'erp',
    'enterprise resource planning': 'erp',
    'ระบบคอมพิวเตอร์': 'computer system',
    'computer system': 'computer system',
};

/**
 * Normalizes a skill string taking aliases and parenthetical annotations into account.
 * E.g., "Enterprise Resource Planning (ERP)" -> "erp"
 *       "MS Excel" -> "ms excel"
 *       "React" -> "react"
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSkill(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const lower = raw.toLowerCase().trim();
    if (SKILL_ALIASES[lower]) return SKILL_ALIASES[lower];

    // Check inside parentheses if any, e.g. "Integration Platforms as a Service (iPaaS)"
    const parenMatch = lower.match(/\(([^)]+)\)/);
    if (parenMatch && SKILL_ALIASES[parenMatch[1].trim()]) {
        return SKILL_ALIASES[parenMatch[1].trim()];
    }

    const cleanWithoutParen = lower.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
    if (SKILL_ALIASES[cleanWithoutParen]) {
        return SKILL_ALIASES[cleanWithoutParen];
    }

    return lower;
}

/**
 * Calculates skill-only match score between a user profile and a TOR project document.
 * Uses Math.ceil() to round up fractional scores (e.g., 2/3 = 66.67% -> 67%).
 * 
 * @param {Object} user - User document from MongoDB or contractor profile
 * @param {Object} project - Project document from MongoDB or TOR object
 * @returns {number} Integer match percentage (0 to 100)
 */
export function calculateSkillMatchScore(user, project) {
    const rawProjectSkills = Array.isArray(project?.extracted_data?.tech_stack)
        ? project.extracted_data.tech_stack
        : Array.isArray(project?.techStack)
        ? project.techStack
        : [];

    // If TOR has no required tech stack extracted, default to 100% (neutral match)
    if (!rawProjectSkills.length) {
        return 100;
    }

    // Combine user's techStack and skills arrays into a single list
    const userSkillsList = [
        ...(Array.isArray(user?.techStack) ? user.techStack : []),
        ...(Array.isArray(user?.skills) ? user.skills : [])
    ];

    // Normalize user and project skills
    const userSkillSet = new Set(
        userSkillsList.map(s => normalizeSkill(s)).filter(Boolean)
    );

    const projectSkillSet = new Set(
        rawProjectSkills.map(s => normalizeSkill(s)).filter(Boolean)
    );

    if (projectSkillSet.size === 0) {
        return 100;
    }

    // Count overlapping skills
    let matchedCount = 0;
    projectSkillSet.forEach(requiredSkill => {
        if (userSkillSet.has(requiredSkill)) {
            matchedCount++;
        }
    });

    // Calculate percentage and round UP
    const percentage = (matchedCount / projectSkillSet.size) * 100;
    return Math.ceil(percentage);
}