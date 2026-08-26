import { mockProjectRecords } from "@/lib/mock-project-records";

// Temporary compatibility adapter for the initial scaffold pages. New or
// revised pages should call @/lib/services/tor-service directly.
export const mockProjects = mockProjectRecords;

export function getMockProject(id) {
  return mockProjects.find((project) => project.project_id === id);
}
