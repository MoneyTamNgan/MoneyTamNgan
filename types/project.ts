// Mirrors models/Project.js on develop-database_setup.
export interface ProjectRecord {
  project_id: string;
  project_name: string;
  dept_name: string;
  dept_sub_name?: string;
  budget: number;
  project_status: string;
  is_software: boolean;
  timeline: {
    announce_date?: string;
    contract_start?: string | null;
    contract_end?: string | null;
    duration_days?: number;
  };
  pdf_url?: string;
  extracted_data: {
    summary?: string;
    qualifications: string[];
    scope_of_work: string[];
    tech_stack: string[];
  };
  anomalies: {
    high_budget_flag: boolean;
    budget_deviation_multiplier: number;
    flagged_clauses: Array<{ clause_text: string; reason: string }>;
  };
  version_info: {
    version: number;
    is_latest: boolean;
    superseded_by: string | null;
  };
  created_at?: string;
  updated_at?: string;
}
