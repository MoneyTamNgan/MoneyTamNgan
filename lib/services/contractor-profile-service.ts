import type { ContractorProfileRecord } from "@/types/contractor-profile";
import { DELETE_COMPANY_DATA_CONFIRMATION } from "@/lib/bid-prep/notices";

const storageKey = "moneytamngan.contractor-profile";

export class ProfileSaveError extends Error {
  fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.fields = fields;
  }
}

export function loadLocalContractorProfile(): ContractorProfileRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return null;
    // Bid identity details are read from the authenticated API, never shared browser cache.
    return { ...JSON.parse(stored), registration_number: '', address: '', authorized_signatory: '', past_projects: [] } as ContractorProfileRecord;
  } catch {
    return null;
  }
}

export function saveLocalContractorProfile(profile: ContractorProfileRecord): ContractorProfileRecord {
  const saved = { ...profile, updated_at: new Date().toISOString() };
  if (typeof window !== "undefined") {
    const { registration_number, address, authorized_signatory, past_projects, ...cache } = saved;
    window.localStorage.setItem(storageKey, JSON.stringify(cache));
  }
  return saved;
}

export async function getContractorProfile(): Promise<{ profile: ContractorProfileRecord; isRemote: boolean }> {
  try {
    const res = await fetch("/api/profiles", {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json();
      const data = json.data || json;
      const remoteProfile: ContractorProfileRecord = {
        company_name: data.company_name ?? "",
        registration_number: data.registration_number ?? "",
        address: data.address ?? "",
        authorized_signatory: data.authorized_signatory ?? "",
        past_projects: data.past_projects ?? [],
        skills: data.skills ?? data.techStack ?? [],
        registered_capital: data.registered_capital ?? null,
        highest_past_project_value: data.highest_past_project_value ?? null,
        concurrent_project_capacity: data.concurrent_project_capacity ?? null,
        certifications: data.certifications ?? [],
        email_notifications_enabled: data.email_notifications_enabled ?? false,
        match_score_threshold: data.match_score_threshold ?? 70,
        notification_frequency: data.notification_frequency ?? 'IMMEDIATE',
        updated_at: data.updatedAt ? new Date(data.updatedAt).toISOString() : undefined,
      };
      saveLocalContractorProfile(remoteProfile);
      return { profile: remoteProfile, isRemote: true };
    }
  } catch (error) {
    console.warn("Failed to fetch contractor profile from API, fallback to local storage:", error);
  }

  const local = loadLocalContractorProfile();
  return {
    profile: local || {
      company_name: "",
      registration_number: "", address: "", authorized_signatory: "", past_projects: [],
      skills: [],
      registered_capital: null,
      highest_past_project_value: null,
      concurrent_project_capacity: null,
      certifications: [],
      email_notifications_enabled: false,
      match_score_threshold: 70,
      notification_frequency: 'IMMEDIATE',
    },
    isRemote: false,
  };
}

export async function saveContractorProfile(
  profile: ContractorProfileRecord
): Promise<{ profile: ContractorProfileRecord; isRemote: boolean }> {
  try {
    const res = await fetch("/api/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });

    if (res.ok) {
      const json = await res.json();
      const data = json.data || json;
      const savedRemote: ContractorProfileRecord = {
        company_name: data.company_name ?? profile.company_name,
        registration_number: data.registration_number ?? "",
        address: data.address ?? "",
        authorized_signatory: data.authorized_signatory ?? "",
        past_projects: data.past_projects ?? [],
        skills: data.skills ?? data.techStack ?? profile.skills,
        registered_capital: data.registered_capital ?? null,
        highest_past_project_value: data.highest_past_project_value ?? null,
        concurrent_project_capacity: data.concurrent_project_capacity ?? null,
        certifications: data.certifications ?? profile.certifications,
        email_notifications_enabled: data.email_notifications_enabled ?? profile.email_notifications_enabled,
        match_score_threshold: data.match_score_threshold ?? profile.match_score_threshold,
        notification_frequency: data.notification_frequency ?? profile.notification_frequency ?? 'IMMEDIATE',
        updated_at: data.updatedAt ? new Date(data.updatedAt).toISOString() : undefined,
      };
      saveLocalContractorProfile(savedRemote);
      return { profile: savedRemote, isRemote: true };
    }
    const errorBody = await res.json().catch(() => ({}));
    throw new ProfileSaveError(errorBody.error?.message || (res.status === 401 ? "Please sign in to save your profile." : "Unable to save profile."), errorBody.error?.fields || {});
  } catch (error) {
    if (error instanceof ProfileSaveError) throw error;
    throw new ProfileSaveError("Unable to connect. Your changes have not been saved to the database.");
  }
}

export async function deleteCompanyBidData(): Promise<boolean> {
  try {
    const res = await fetch("/api/bid-prep/data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: DELETE_COMPANY_DATA_CONFIRMATION }),
    });
    if (!res.ok) return false;
    const local = loadLocalContractorProfile();
    if (local) {
      saveLocalContractorProfile({
        ...local,
        company_name: "",
        registration_number: "", address: "", authorized_signatory: "", past_projects: [],
        skills: [],
        registered_capital: null,
        highest_past_project_value: null,
        concurrent_project_capacity: null,
        certifications: [],
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function deleteContractorAccount(): Promise<boolean> {
  try {
    const res = await fetch("/api/profiles", { method: "DELETE" });
    if (res.ok) {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
      return true;
    }
  } catch (error) {
    console.error("Failed to delete account:", error);
  }
  return false;
}
