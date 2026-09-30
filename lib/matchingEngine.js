/**
 * Calculates skill-only match score between a user profile and a TOR project document.
 * Uses Math.ceil() to round up fractional scores (e.g., 2/3 = 66.67% -> 67%).
 * 
 * @param {Object} user - User document from MongoDB
 * @param {Object} project - Project document from MongoDB
 * @returns {number} Integer match percentage (0 to 100)
 */
export function calculateSkillMatchScore(user, project) {
    const projectSkills = Array.isArray(project?.extracted_data?.tech_stack)
        ? project.extracted_data.tech_stack
        : [];

    // If TOR has no required tech stack extracted, default to 100% (neutral match)
    if (!projectSkills.length) {
        return 100;
    }

    // Combine user's techStack and skills arrays into a single list
    const userSkillsList = [
        ...(Array.isArray(user?.techStack) ? user.techStack : []),
        ...(Array.isArray(user?.skills) ? user.skills : [])
    ];

    // Case-insensitive normalization
    const userSkillSet = new Set(
        userSkillsList.map(s => String(s).toLowerCase().trim()).filter(Boolean)
    );

    const projectSkillSet = new Set(
        projectSkills.map(s => String(s).toLowerCase().trim()).filter(Boolean)
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