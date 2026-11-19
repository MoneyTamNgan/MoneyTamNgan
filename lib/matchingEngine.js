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
    'microsoft sql server': 'sql server',
    '2 factor authentication': 'multi-factor authentication (mfa)',
    'api': 'api integration',
    '10 gb base-t': '10gbase-t networking',
    'กรอบการกํากับดูแลข้อมูล (data governance framework) ของสํานักงานพัฒนารัฐบาลดิจิทัล (สพร.)': 'dga data governance framework',
};

const ORACLE_DATABASE_SKILL = 'oracle dbms (enterprise)';
const DATABASE_SKILLS = ['relational database', 'sql', 'sql server', 'mysql', 'postgresql', 'mariadb', ORACLE_DATABASE_SKILL];

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

export function compareSkillMatch(userSkills, projectSkills) {
    const projectEntries = projectSkills.map(label => [normalizeSkill(label), label]);
    const projectKeys = new Set(projectEntries.map(([key]) => key));
    // A bare vendor name is ambiguous unless the TOR also names a database skill.
    const oracleIsDatabase = projectKeys.has('oracle') && DATABASE_SKILLS.some(key => projectKeys.has(key));
    const userKeys = new Set(userSkills.map(normalizeSkill));
    if (oracleIsDatabase && userKeys.has('oracle')) userKeys.add(ORACLE_DATABASE_SKILL);

    const requirementsBySkill = new Map();
    for (const [normalizedKey, label] of projectEntries) {
        const key = oracleIsDatabase && normalizedKey === 'oracle' ? ORACLE_DATABASE_SKILL : normalizedKey;
        if (key && !requirementsBySkill.has(key)) {
            requirementsBySkill.set(key, { label, isMatch: userKeys.has(key) });
        }
    }

    const requirements = [...requirementsBySkill.values()];
    const matchedCount = requirements.filter(({ isMatch }) => isMatch).length;
    const score = requirements.length ? Math.ceil((matchedCount / requirements.length) * 100) : 100;
    return { requirements, matchedCount, score };
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

    return compareSkillMatch(userSkillsList, rawProjectSkills).score;
}
