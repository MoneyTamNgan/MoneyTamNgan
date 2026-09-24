import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateSkillMatchScore } from './matchingEngine.js';

describe('calculateSkillMatchScore', () => {
    it('returns 100% when TOR has no required tech_stack', () => {
        const user = { skills: ['React', 'Node.js'] };
        const project = { extracted_data: { tech_stack: [] } };
        assert.strictEqual(calculateSkillMatchScore(user, project), 100);
    });

    it('returns 100% when project is missing extracted_data', () => {
        const user = { skills: ['React'] };
        assert.strictEqual(calculateSkillMatchScore(user, null), 100);
    });

    it('calculates exact match score and rounds UP with Math.ceil', () => {
        const user = { skills: ['React', 'Node.js'], techStack: ['TypeScript'] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'Node.js', 'Python']
            }
        };
        // 2 of 3 matched -> (2/3)*100 = 66.666...% -> Math.ceil -> 67
        assert.strictEqual(calculateSkillMatchScore(user, project), 67);
    });

    it('handles case insensitivity and whitespace', () => {
        const user = { skills: ['  react ', 'NODE.JS '] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'node.js']
            }
        };
        assert.strictEqual(calculateSkillMatchScore(user, project), 100);
    });

    it('returns 0 when user has no matching skills', () => {
        const user = { skills: ['Java', 'C++'] };
        const project = {
            extracted_data: {
                tech_stack: ['React', 'Node.js']
            }
        };
        assert.strictEqual(calculateSkillMatchScore(user, project), 0);
    });
});
