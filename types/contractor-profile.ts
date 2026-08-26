export type ContractorSkill = "React" | "Node.js" | "Python" | "PostgreSQL" | "Cloud" | "TypeScript" | "Docker" | "UX/UI" | "Data analysis" | "Security";
export type ContractorCertification = "ISO 27001" | "ISO 29110" | "CMMI" | "Cloud certification";
export type MatchScoreThreshold = 70 | 80 | 90;

// Mirrors the document that will later be persisted for a contractor in MongoDB.
export interface ContractorProfileRecord {
  company_name: string;
  skills: ContractorSkill[];
  registered_capital: number | null;
  highest_past_project_value: number | null;
  concurrent_project_capacity: number | null;
  certifications: ContractorCertification[];
  email_notifications_enabled: boolean;
  match_score_threshold: MatchScoreThreshold;
  created_at?: string;
  updated_at?: string;
}
