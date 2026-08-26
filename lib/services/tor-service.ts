import { mockProjectRecords } from "@/lib/mock-project-records";
import { projectToAnomalyReport, projectToTor, projectToTorSummary } from "@/lib/services/project-mapper";
import type { AnalyticsResult, AnalyticsSearchParams, AnomalyReport, PaginatedList, Tor, TorListParams, TorSummary } from "@/types/tor";

// Development mode is intentionally active until the REST API is implemented.
// New pages must use this service, never import mock data directly.
export const USE_MOCK_TOR_SERVICE = true;
const pause = () => Promise.resolve();

export async function listTors(params: TorListParams = {}): Promise<PaginatedList<Tor>> {
  if (USE_MOCK_TOR_SERVICE) {
    await pause();
    const items = mockProjectRecords.map(projectToTor).filter((tor) => (params.isSoftware === undefined || tor.isSoftware === params.isSoftware) && (!params.status || tor.status === params.status) && (!params.agency || tor.agency === params.agency));
    return { items, total: items.length, page: params.page ?? 1, pageSize: params.pageSize ?? items.length };
  }
  /* PRODUCTION — enable after GET /tors is implemented.
  const query = new URLSearchParams();
  if (params.isSoftware !== undefined) query.set("isSoftware", String(params.isSoftware));
  if (params.status) query.set("status", params.status);
  if (params.agency) query.set("agency", params.agency);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return apiFetch<PaginatedList<Tor>>(`/tors?${query.toString()}`);
  */
  throw new Error("ยังไม่ได้เชื่อมต่อ API รายการ TOR");
}

export async function getTor(id: string): Promise<Tor | null> {
  if (USE_MOCK_TOR_SERVICE) { await pause(); const project = mockProjectRecords.find((item) => item.project_id === id); return project ? projectToTor(project) : null; }
  /* PRODUCTION — enable after GET /tors/{id} is implemented.
  return apiFetch<Tor>(`/tors/${encodeURIComponent(id)}`);
  */
  throw new Error("ยังไม่ได้เชื่อมต่อ API รายละเอียด TOR");
}

export async function getTorSummary(id: string): Promise<TorSummary | null> {
  if (USE_MOCK_TOR_SERVICE) { await pause(); const project = mockProjectRecords.find((item) => item.project_id === id); return project ? projectToTorSummary(project) : null; }
  /* PRODUCTION — planned endpoint; confirm its final 404/null behavior with BE.
  return apiFetch<TorSummary>(`/tors/${encodeURIComponent(id)}/summary`);
  */
  throw new Error("ยังไม่ได้เชื่อมต่อ API สรุปเอกสาร TOR");
}

export async function getTorAnomalies(id: string): Promise<AnomalyReport | null> {
  if (USE_MOCK_TOR_SERVICE) { await pause(); const project = mockProjectRecords.find((item) => item.project_id === id); return project ? projectToAnomalyReport(project) : null; }
  /* PRODUCTION — planned endpoint; enable after anomaly processing is available.
  return apiFetch<AnomalyReport>(`/tors/${encodeURIComponent(id)}/anomalies`);
  */
  throw new Error("ยังไม่ได้เชื่อมต่อ API ความผิดปกติของ TOR");
}

export async function searchAnalytics(params: AnalyticsSearchParams = {}): Promise<AnalyticsResult> {
  if (USE_MOCK_TOR_SERVICE) {
    await pause();
    const items = mockProjectRecords.map(projectToTor).filter((tor) => (!params.agency || tor.agency === params.agency) && (!params.budgetMin || tor.budget >= params.budgetMin) && (!params.budgetMax || tor.budget <= params.budgetMax));
    const totalSpend = items.reduce((total, tor) => total + tor.budget, 0);
    return { items, total: items.length, page: params.page ?? 1, pageSize: params.pageSize ?? items.length, aggregates: { meanBudget: items.length ? totalSpend / items.length : 0, medianDuration: null, totalSpend } };
  }
  /* PRODUCTION — planned public endpoint; enable once rate limiting is in place.
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined) query.set(key, String(value)); });
  return apiFetch<AnalyticsResult>(`/analytics/search?${query.toString()}`);
  */
  throw new Error("ยังไม่ได้เชื่อมต่อ API วิเคราะห์ข้อมูล");
}

/* PRODUCTION — shared HTTP helper. Keep disabled until NEXT_PUBLIC_API_BASE_URL is configured.
async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
*/
