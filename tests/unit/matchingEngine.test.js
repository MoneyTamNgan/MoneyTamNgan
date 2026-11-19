import { describe, it, expect } from 'vitest';
import { calculateSkillMatchScore, compareSkillMatch } from '@/lib/matchingEngine.js';
import { CONTRACTOR_SKILLS } from '@/types/contractor-profile';

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

    it('matches skill aliases like ERP and iPaaS with parenthetical labels', () => {
        const user = {
            skills: ['Enterprise Resource Planning (ERP)', 'Integration Platforms as a Service (iPaaS)']
        };
        const project = {
            extracted_data: {
                tech_stack: ['ERP', 'ipaas']
            }
        };
        expect(calculateSkillMatchScore(user, project)).toBe(100);
    });

    it('supports project.techStack fallback when extracted_data is absent', () => {
        const user = { skills: ['React', 'Python'] };
        const project = { techStack: ['React', 'Python'] };
        expect(calculateSkillMatchScore(user, project)).toBe(100);
    });

    it('matches 15 of 29 TOR labels with the relevant profile selections', () => {
        const skills = [
            'MS Excel', 'MySQL', 'PostgreSQL', 'SQL Server', 'Multi-Factor Authentication (MFA)',
            'Oracle DBMS (Enterprise)', 'LDAP', 'SQL', 'Metadata Standard', 'RAID 0,1,5',
            'NIST SP 800-115', 'Common Vulnerabilities and Exposures (CVE)', 'API Integration',
            '10GBASE-T Networking', 'DGA Data Governance Framework',
        ];
        const techStack = [
            'Metadata Standard', 'e-GP (Electronic Government Procurement)',
            'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA)',
            'กรอบการกํากับดูแลข้อมูล (Data Governance Framework) ของสํานักงานพัฒนารัฐบาลดิจิทัล (สพร.)',
            'ECC DDR4', 'RAID 0,1,5', 'SAS', 'SATA', 'Solid State Drive (SSD)', '10 Gb Base-T',
            'Open Web Application Security Project (OWASP)', 'NIST SP 800-115',
            'Common Vulnerabilities and Exposures (CVE)', 'CSV', 'Excel', 'AI Assistant', 'PDF',
            'API', 'Microsoft Edge', 'Google Chrome', 'Safari', '2 Factor Authentication',
            'LDAP', 'Relational Database', 'SQL', 'Microsoft SQL Server', 'MySQL', 'PostgreSQL', 'Oracle',
        ];

        expect(CONTRACTOR_SKILLS).toEqual(expect.arrayContaining(skills));
        const comparison = compareSkillMatch(skills, techStack);
        expect(comparison.requirements).toHaveLength(29);
        expect(comparison.matchedCount).toBe(15);
        expect(comparison.score).toBe(52);
        expect(calculateSkillMatchScore({ skills }, { extracted_data: { tech_stack: techStack } })).toBe(52);
    });

    it('keeps the bare Oracle label separate unless the TOR names a database skill', () => {
        const skills = ['Oracle DBMS (Enterprise)'];
        expect(compareSkillMatch(skills, ['Oracle', 'Oracle BI']).matchedCount).toBe(0);
        expect(compareSkillMatch(skills, ['Oracle', 'SQL Server']).requirements[0]).toEqual({
            label: 'Oracle', isMatch: true,
        });
        expect(compareSkillMatch(['Oracle'], ['Oracle', 'SQL Server']).matchedCount).toBe(1);
    });

    it('counts different labels for the same skill once and keeps the first TOR label', () => {
        const comparison = compareSkillMatch(['SQL Server'], ['Microsoft SQL Server', 'SQL Server', 'Firefox']);
        expect(comparison).toEqual({
            requirements: [
                { label: 'Microsoft SQL Server', isMatch: true },
                { label: 'Firefox', isMatch: false },
            ],
            matchedCount: 1,
            score: 50,
        });
    });
});
