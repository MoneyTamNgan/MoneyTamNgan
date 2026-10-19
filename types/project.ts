// API and mock records contain ISO 8601 date strings. Mongoose converts raw
// database Date values to this form before they reach this shared type.
type DatabaseDate = string | null;

export interface ProjectEvidence {
  value: string;
  page?: number;
}

export type TorRiskCategory = 'unrealistic_tenure' | 'excessive_hardware' | 'vendor_lock_in' | 'excessive_team_capacity';
export type TorRiskSeverity = 'low' | 'medium' | 'high';

export interface ProjectFlaggedClause {
  clause_text: string;
  reason: string;
  explanation?: string;
  highlight_reason?: string;
  category?: TorRiskCategory;
  severity?: TorRiskSeverity;
  page?: number;
  confidence?: number;
}

// Mirrors the MongoDB Project document used by the TOR API.
export interface ProjectRecord {
  project_id: string;
  project_name: string;
  dept_name: string;
  dept_sub_name?: string;
  budget: number;
  project_status: string;
  is_software: boolean | null;
  flagged_clauses?: ProjectFlaggedClause[];
  flagged_clauses_meta?: {
    summary_id?: string;
    document_id?: string;
    extraction_run_id?: string;
    prompt_version?: string;
    model?: string;
    analysis_status?: 'complete' | 'partial' | 'unreadable';
    skipped_pages?: { page_number: number | null; reason: string }[];
    warnings?: { code: string; page?: number; field?: string }[];
    total_flags?: number;
    truncated?: boolean;
    updated_at?: DatabaseDate;
  };
  timeline: {
    announce_date?: DatabaseDate;
    contract_start?: DatabaseDate;
    contract_end?: DatabaseDate;
    duration_days?: number;
  };
  pdf_url?: string;
  source?: {
    provider?: string;
    fetched_at?: DatabaseDate;
    payload_hash?: string;
  };
  announcement_document_id?: string;
  tender?: {
    invitation_url?: string;
    method?: string;
    published_at?: DatabaseDate;
    rss_dept_id?: string;
    checked_at?: DatabaseDate;
    closes_at?: DatabaseDate;
    error?: string | null;
    reference_price?: number;
    status?: 'open' | 'closed' | 'cancelled' | 'unknown';
    submission_date?: string;
    submission_start_time?: string;
    submission_end_time?: string;
  };
  submission_schedule?: {
    date?: string;
    start_time?: string;
    end_time?: string;
    starts_at?: DatabaseDate;
    ends_at?: DatabaseDate;
    timezone?: string;
  };
  classification?: {
    status?: 'pending' | 'software' | 'not_software' | 'uncertain' | 'manual_override';
    confidence?: number | null;
    method?: string;
    model?: string;
    classified_at?: DatabaseDate;
    reason?: string;
  };
  document?: {
    status?: 'pending' | 'url_found' | 'downloaded' | 'stored' | 'unavailable' | 'invalid' | 'retry_pending' | 'failed';
    source_url?: string;
    filename?: string;
    mime_type?: string;
    page_count?: number;
    error?: string | null;
  };
  processing?: {
    attempts?: number;
    status?: 'metadata_ingested' | 'classification_pending' | 'irrelevant' | 'document_pending' | 'document_downloaded' | 'ai_pending' | 'text_extracted' | 'completed' | 'review_required' | 'retry_pending' | 'failed';
    summary_source?: 'pdf' | 'metadata' | null;
    error?: string | null;
  };
  extracted_data: {
    summary?: string | null;
    qualifications: string[];
    scope_of_work: string[];
    tech_stack: string[];
    evidence?: {
      qualifications: ProjectEvidence[];
      scope_of_work: ProjectEvidence[];
      tech_stack: ProjectEvidence[];
    };
  };
  anomalies: {
    high_budget_flag: boolean;
    budget_deviation_multiplier: number;
    flagged_clauses: ProjectFlaggedClause[];
  };
  version_info: {
    version: number;
    is_latest: boolean;
    superseded_by: string | null;
  };
  created_at?: DatabaseDate;
  updated_at?: DatabaseDate;
}
