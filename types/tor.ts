export type TorStatus = "Active" | "Superseded" | "Invalid" | "Cancelled";
export type TorStage = "draft" | "official" | "review" | "closed";

export interface BudgetAnomaly {
  baselinePrice: number;
  deviationMultiplier: number;
  tag: "NONE" | "HIGH_BUDGET_ANOMALY";
}

export interface Tor {
  id: string;
  title: string;
  agency: string;
  budget: number;
  releaseDate: string;
  sourceUrl: string;
  pdfUrl: string | null;
  status: TorStatus;
  isSoftware: boolean | null;
  classificationConfidence: number | null;
  supersededByTorId: string | null;
  matchScore: number | null;
  budgetAnomaly: BudgetAnomaly | null;
  createdAt: string;
  updatedAt: string;
}

export interface TorSummary {
  torId: string;
  executiveSummary: string | null;
  vendorEligibility: string | null;
  requiredTeamExperience: string | null;
  requiredTechStack: string[];
  requiredCertifications: string[];
  generatedAt: string | null;
}

export interface FlaggedClause {
  clauseText: string;
  type: "IRRELEVANT_HARDWARE" | "UNREALISTIC_TENURE" | "VENDOR_LOCK_IN" | "OTHER";
  reasoning: string;
}

export interface AnomalyReport {
  torId: string;
  budgetAnomaly: BudgetAnomaly | null;
  flaggedClauses: FlaggedClause[];
}

export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TorListParams {
  isSoftware?: boolean;
  status?: TorStatus;
  stage?: TorStage;
  biddingStatus?: "open" | "closed" | "unknown";
  agency?: string;
  page?: number;
  pageSize?: number;
}

export interface AnalyticsSearchParams {
  dateFrom?: string;
  dateTo?: string;
  agency?: string;
  budgetMin?: number;
  budgetMax?: number;
  category?: string;
  page?: number;
  pageSize?: number;
}

export interface AnalyticsResult extends PaginatedList<Tor> {
  aggregates: {
    meanBudget: number;
    medianDuration: number | null;
    totalSpend: number;
  };
}

// Live /api/tors response contracts. These remain separate from the existing
// frontend mock types above until the frontend API-wiring task is started.
export type TorClassificationStatus = "pending" | "software" | "not_software" | "uncertain" | "manual_override" | null;

export interface TorApiClassification {
  status: TorClassificationStatus;
  confidence: number | null;
}

export type TorBiddingStatus = "open" | "closed" | "cancelled" | "unknown";

export interface TorApiBidding {
  status: TorBiddingStatus;
  /** Ingestion phase from tender.status, kept separate from status above. */
  phase: string | null;
  opensAt: string | null;
  closesAt: string | null;
  submissionDate: string | null;
  submissionStartTime: string | null;
  submissionEndTime: string | null;
  invitationUrl: string | null;
  method: string | null;
}

export interface TorApiDocument {
  id: string | null;
  type: string;
  filename: string | null;
  /** Public e-GP source link; local and cloud storage paths are never exposed. */
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string | null;
  version: number | null;
  isCurrentPrimary: boolean;
}

export interface TorApiListItem {
  fiscalBudget?: TorApiFiscalBudget | null;
  id: string;
  title: string;
  agency: string;
  budget: number | null;
  projectStatus: string;
  bidding: TorApiBidding;
  announceDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  isSoftware: boolean | null;
  classification: TorApiClassification;
  documentStatus: string | null;
  processingStatus: string | null;
  techStack: string[];
  matchScore?: number | null;
  anomaly: {
    highBudgetFlag: boolean;
    budgetDeviationMultiplier: number;
  };
}

export interface TorApiListResponse {
  status: "success";
  page: number;
  limit: number;
  total: number;
  data: TorApiListItem[];
}

export interface TorApiFacetsResponse {
  status: "success";
  total: number;
  agencies: Array<{ name: string; count: number }>;
}

export type TorApiAnomaly =
  | { type: "high_budget"; budgetDeviationMultiplier: number }
  | {
      type: "flagged_clause";
      clauseText: string;
      reason: string;
      explanation: string;
      highlightReason?: string;
      category?: "unrealistic_tenure" | "excessive_hardware" | "vendor_lock_in";
      severity?: "low" | "medium" | "high";
      page?: number;
      confidence?: number;
    };

export interface TorApiFiscalBudget {
  warnings?: string[];
  year: number | null;
  years: number[];
  status: "found" | "not_found" | "ambiguous";
  method: "none" | "regex" | "llm" | "regex+llm";
  evidence: {
    year: number;
    page: number;
    clause_text: string;
    section: string | null;
    method: "regex" | "llm";
  }[];
}

export interface TorApiDetail {
  id: string;
  title: string;
  agency: { name: string; subName: string | null };
  budget: number | null;
  projectStatus: string;
  bidding: TorApiBidding;
  pdfUrl: string | null;
  documents: { tor: TorApiDocument | null; announcement: TorApiDocument | null };
  createdAt: string | null;
  updatedAt: string | null;
  timeline: {
    announceDate: string | null;
    contractStart: string | null;
    contractEnd: string | null;
    durationDays: number | null;
  };
  classification: TorApiClassification & {
    isSoftware: boolean | null;
    reason: string | null;
  };
  documentStatus: string | null;
  processingStatus: string | null;
  requirements: string[];
  scopeOfWork: string[];
  techStack: string[];
  summary: string | null;
  fiscalBudget: TorApiFiscalBudget | null;
  anomalies: TorApiAnomaly[];
  version: { number: number; isLatest: boolean; supersededBy: string | null };
}

export interface TorApiEvidence {
  value: string;
  page?: number;
}

export interface TorApiSummary {
  id: string;
  documentStatus: string | null;
  processingStatus: string | null;
  summary: string | null;
  fiscalBudget: TorApiFiscalBudget | null;
  requirements: string[];
  scopeOfWork: string[];
  techStack: string[];
  evidence: {
    requirements: TorApiEvidence[];
    scopeOfWork: TorApiEvidence[];
    techStack: TorApiEvidence[];
  };
}

export interface TorApiAnomalyReport {
  id: string;
  highBudgetFlag: boolean;
  budgetDeviationMultiplier: number;
  anomalies: TorApiAnomaly[];
}

export interface TorApiError {
  error: { code: string; message: string };
}
