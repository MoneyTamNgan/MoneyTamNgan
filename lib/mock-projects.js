import { mockTorSummaries, mockTors } from "@/lib/mock-tors";

// Temporary compatibility adapter for the initial scaffold pages. New or
// revised pages should call @/lib/services/tor-service directly.
export const mockProjects = mockTors.map((tor) => {
  const summary = mockTorSummaries[tor.id];
  return {
    project_id: tor.id,
    project_name: tor.title,
    dept_name: tor.agency,
    budget: tor.budget,
    project_status: tor.status,
    is_software: tor.isSoftware ?? false,
    timeline: { announce_date: tor.releaseDate },
    extracted_data: {
      summary: summary?.executiveSummary ?? "ยังไม่มีข้อมูล",
      qualifications: summary?.vendorEligibility ? [summary.vendorEligibility] : ["ยังไม่มีข้อมูล"],
      scope_of_work: ["ยังไม่มีข้อมูล"],
      tech_stack: summary?.requiredTechStack ?? [],
    },
  };
});

export function getMockProject(id) {
  return mockProjects.find((project) => project.project_id === id);
}
