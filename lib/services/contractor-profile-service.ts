import type { ContractorProfileRecord } from "@/types/contractor-profile";

const storageKey = "moneytamngan.contractor-profile";

export function loadLocalContractorProfile(): ContractorProfileRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as ContractorProfileRecord) : null;
  } catch {
    return null;
  }
}

export function saveLocalContractorProfile(profile: ContractorProfileRecord): ContractorProfileRecord {
  const saved = { ...profile, updated_at: new Date().toISOString() };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey, JSON.stringify(saved));
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
        skills: data.skills ?? data.techStack ?? [],
        registered_capital: data.registered_capital ?? null,
        highest_past_project_value: data.highest_past_project_value ?? null,
        concurrent_project_capacity: data.concurrent_project_capacity ?? null,
        certifications: data.certifications ?? [],
        email_notifications_enabled: data.email_notifications_enabled ?? false,
        match_score_threshold: data.match_score_threshold ?? 70,
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
      skills: [],
      registered_capital: null,
      highest_past_project_value: null,
      concurrent_project_capacity: null,
      certifications: [],
      email_notifications_enabled: false,
      match_score_threshold: 70,
    },
    isRemote: false,
  };
}

export async function saveContractorProfile(
  profile: ContractorProfileRecord
): Promise<{ profile: ContractorProfileRecord; isRemote: boolean }> {
  // Always save locally first for fast UI feedback & offline backup
  saveLocalContractorProfile(profile);

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
        skills: data.skills ?? data.techStack ?? profile.skills,
        registered_capital: data.registered_capital ?? profile.registered_capital,
        highest_past_project_value: data.highest_past_project_value ?? profile.highest_past_project_value,
        concurrent_project_capacity: data.concurrent_project_capacity ?? profile.concurrent_project_capacity,
        certifications: data.certifications ?? profile.certifications,
        email_notifications_enabled: data.email_notifications_enabled ?? profile.email_notifications_enabled,
        match_score_threshold: data.match_score_threshold ?? profile.match_score_threshold,
        updated_at: data.updatedAt ? new Date(data.updatedAt).toISOString() : undefined,
      };
      saveLocalContractorProfile(savedRemote);
      return { profile: savedRemote, isRemote: true };
    }
  } catch (error) {
    console.warn("Failed to save profile to API:", error);
  }

  return { profile, isRemote: false };
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
