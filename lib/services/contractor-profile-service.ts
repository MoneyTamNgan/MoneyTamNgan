import type { ContractorProfileRecord } from "@/types/contractor-profile";

const storageKey = "moneytamngan.contractor-profile";

export function loadLocalContractorProfile(): ContractorProfileRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as ContractorProfileRecord : null;
  } catch {
    return null;
  }
}

export function saveLocalContractorProfile(profile: ContractorProfileRecord): ContractorProfileRecord {
  const saved = { ...profile, updated_at: new Date().toISOString() };
  window.localStorage.setItem(storageKey, JSON.stringify(saved));
  return saved;
}

/* PRODUCTION — enable after contractor-profile endpoints and MongoDB persistence exist.
export async function getContractorProfile(): Promise<ContractorProfileRecord | null> {
  return apiFetch<ContractorProfileRecord>("/profile");
}

export async function saveContractorProfile(profile: ContractorProfileRecord): Promise<ContractorProfileRecord> {
  return apiFetch<ContractorProfileRecord>("/profile", { method: "PUT", body: JSON.stringify(profile) });
}
*/
