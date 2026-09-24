import { describe, it, expect } from 'vitest';
import { calculateSkillMatchScore } from './matchingEngine.js';

describe('calculateSkillMatchScore', () => {
    it('returns 100% when TOR has no required tech_stack', () => {
        const user = { skills: ['React', 'Node.js'] };
        const project = { extracted_data: { tech_stack: [] } };
        expect(calculateSkillMatchScore(user, project)).toBe(100);
    });

    it('returns 100% when project is missing extracted_data', () => {
        const user = { skills: ['React'] };
        expect(calculateSkillMatchScore(user, null)).toBe(100);
    });

    it('calculates exact match score and rounds UP with Math.ceil', () => {
        const user = { skills: ['React', 'Node.js'], techStack: ['TypeScript'] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'Node.js', 'Python']
            }
        };
        // 2 of 3 matched -> (2/3)*100 = 66.666...% -> Math.ceil -> 67
        expect(calculateSkillMatchScore(user, project)).toBe(67);
    });

    it('handles case insensitivity and whitespace', () => {
        const user = { skills: ['  react ', 'NODE.JS '] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'node.js']
            }
        };
        expect(calculateSkillMatchScore(user, project)).toBe(100);
    });

    it('returns 0 when user has no matching skills', () => {
        const user = { skills: ['Java', 'C++'] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'Node.js']
            }
        };
        expect(calculateSkillMatchScore(user, project)).toBe(0);
    });
});
