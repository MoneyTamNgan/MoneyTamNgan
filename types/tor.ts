export type TorStatus = "Active" | "Superseded" | "Invalid" | "Cancelled";

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
