export type AnalyticsBiddingStatus = 'open' | 'closed' | 'cancelled' | 'unknown';

export interface AnalyticsQuery {
  isSoftware?: boolean;
  agency?: string;
  biddingStatus?: AnalyticsBiddingStatus;
  fiscalYear?: number;
  dateFrom?: string;
  dateTo?: string;
  budgetMin?: number;
  budgetMax?: number;
  page?: number;
  limit?: number;
}

export interface AnalyticsTorItem {
  id: string;
  title: string;
  agency: string;
  budget: number;
  projectStatus: string;
  isSoftware: boolean | null;
  announceDate: string | null;
  bidClosesAt: string | null;
  bidStartsAt: string | null;
  bidSubmissionDate: string | null;
  bidStartTime: string | null;
  bidEndTime: string | null;
  fiscalYear: number | null;
  biddingStatus: AnalyticsBiddingStatus;
  projectLength: number | null;
  documentReadiness: string;
}

interface AnalyticsBreakdown {
  key: string;
  count: number;
  totalBudget: number;
}

export interface AnalyticsResponse {
  status: 'success';
  generatedAt: string;
  filters: Required<Pick<AnalyticsQuery, 'page' | 'limit'>> & Omit<AnalyticsQuery, 'page' | 'limit'>;
  dataQuality: Record<string, string>;
  metrics: {
    totalTors: number;
    totalBudget: number;
    openForBidding: number;
    openBudget: number;
    closingSoon: number;
  };
  charts: {
    fiscalYearTrend: Array<{ fiscalYear: number; count: number; totalBudget: number }>;
    projectLength: Array<{ key: string; label: string; count: number; totalBudget: number }>;
    biddingStatus: AnalyticsBreakdown[];
    closingWindow: Array<{ key: string; label: string; count: number; totalBudget: number }>;
    documentReadiness: Array<{ key: string; label: string; count: number; totalBudget: number }>;
    topAgencies: Array<{ name: string; count: number; totalBudget: number }>;
  };
  facets: {
    agencies: Array<{ name: string; count: number }>;
    fiscalYears: Array<{ year: number; count: number }>;
  };
  page: number;
  limit: number;
  total: number;
  data: AnalyticsTorItem[];
}
