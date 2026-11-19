export const CONTRACTOR_SKILLS = [
  "React",
  "Node.js",
  "Python",
  "PostgreSQL",
  "Cloud",
  "TypeScript",
  "Docker",
  "UX/UI",
  "Data analysis",
  "Security",
  "Service Virtualization",
  "Integration Platforms as a Service (iPaaS)",
  "MS Project",
  "MS Excel",
  "Utility Platform (UTP)",
  "Enterprise Resource Planning (ERP)",
  "ระบบคอมพิวเตอร์",
  "ASP.NET C#",
  "PHP",
  "Laravel Framework",
  "Oracle DBMS (Enterprise)",
  "SQL Server",
  "Linux OS",
  "Oracle BI",
  "OWASP TOP 10",
  "Single Sign On",
  "API Gateway",
  "LINE Official Account",
  "Digital ID",
  "MySQL",
  "MariaDB",
  "Active Directory (AD)",
  "ThaiD",
  "Multi-Factor Authentication (MFA)",
  "Role-Based Access Control (RBAC)",
  "Webhook",
  "TLS v1.3",
  "AODB (Airport Operational Database)",
  "A-CDM (Airport Collaboration Decision Making)",
  "AMHS (Aeronautical Message Handling System)",
  "FPOS (Flight Permit Online System)",
  "RMS (Resource Management System)",
  "FIDS (Flight Information Display System)",
  "PTS (Passenger Tracking System)",
  "LDAP",
  "SQL",
  "Metadata Standard",
  "RAID 0,1,5",
  "NIST SP 800-115",
  "Common Vulnerabilities and Exposures (CVE)",
  "API Integration",
  "10GBASE-T Networking",
  "DGA Data Governance Framework",
] as const;

export type ContractorSkill = (typeof CONTRACTOR_SKILLS)[number];
export type ContractorCertification = "ISO 27001" | "ISO 29110" | "CMMI" | "Cloud certification";
export type MatchScoreThreshold = 50 | 60 | 70 | 80 | 90;
export type NotificationFrequency = 'IMMEDIATE' | 'DAILY_DIGEST';

export interface PastCompanyProject {
  name: string;
  client: string;
  value: number;
  year: number;
}

// Mirrors the document that will later be persisted for a contractor in MongoDB.
export interface ContractorProfileRecord {
  company_name: string;
  registration_number: string;
  address: string;
  authorized_signatory: string;
  past_projects: PastCompanyProject[];
  skills: ContractorSkill[];
  registered_capital: number | null;
  highest_past_project_value: number | null;
  concurrent_project_capacity: number | null;
  certifications: ContractorCertification[];
  email_notifications_enabled: boolean;
  match_score_threshold: MatchScoreThreshold;
  notification_frequency?: NotificationFrequency;
  created_at?: string;
  updated_at?: string;
}
