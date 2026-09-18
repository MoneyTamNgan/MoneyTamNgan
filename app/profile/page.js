"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/ui/AppShell";
import {
  getContractorProfile,
  saveContractorProfile,
  deleteContractorAccount,
} from "@/lib/services/contractor-profile-service";

const skills = ["React", "Node.js", "Python", "PostgreSQL", "Cloud", "TypeScript", "Docker", "UX/UI", "Data analysis", "Security"];
const certifications = ["ISO 27001", "ISO 29110", "CMMI", "Cloud certification"];
const emptyProfile = { company_name: "", skills: [], registered_capital: null, highest_past_project_value: null, concurrent_project_capacity: null, certifications: [], email_notifications_enabled: false, match_score_threshold: 70 };

function toggleItem(items, item) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export default function ProfilePage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [isRemoteSaved, setIsRemoteSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Modal state for delete confirmation
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getContractorProfile().then(({ profile: loadedProfile, isRemote }) => {
      if (isMounted) {
        setProfile(loadedProfile);
        setIsRemoteSaved(isRemote);
        setIsLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  const completeness = useMemo(() => {
    const completed = [
      profile.company_name.trim(),
      profile.skills.length > 0,
      profile.registered_capital !== null,
      profile.highest_past_project_value !== null,
      profile.concurrent_project_capacity !== null,
    ].filter(Boolean).length;
    return completed * 20;
  }, [profile]);

  function updateNumber(field, value) {
    setSaved(false);
    setProfile((current) => ({ ...current, [field]: value === "" ? null : Number(value) }));
  }

  async function handleSaveProfile() {
    setIsSaving(true);
    setSaved(false);
    const { profile: updatedProfile, isRemote } = await saveContractorProfile(profile);
    setProfile(updatedProfile);
    setIsRemoteSaved(isRemote);
    setSaved(true);
    setIsSaving(false);
  }

  async function handleDeleteAccount() {
    setIsDeleting(true);
    const success = await deleteContractorAccount();
    if (success) {
      window.location.href = "/";
    } else {
      alert("เกิดข้อผิดพลาดในการลบบัญชี โปรดลองใหม่อีกครั้ง");
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  }

  const saveStatusMessage = useMemo(() => {
    if (isSaving) return "กำลังบันทึกข้อมูล...";
    if (saved) {
      return isRemoteSaved ? "บันทึกข้อมูลลงในระบบฐานข้อมูลเรียบร้อยแล้ว" : "บันทึกข้อมูลในเบราว์เซอร์เรียบร้อยแล้ว (โปรดเข้าสู่ระบบเพื่อบันทึกลงฐานข้อมูล)";
    }
    return isRemoteSaved ? "ข้อมูลซิงค์กับระบบฐานข้อมูลแล้ว" : "ข้อมูลจะจัดเก็บในเบราว์เซอร์เครื่องนี้ชั่วคราว";
  }, [isSaving, saved, isRemoteSaved]);

  return (
    <AppShell title="โปรไฟล์บริษัท">
      <div className="profile-setup">
        <section className="profile-hero">
          <div>
            <p className="profile-kicker">ข้อมูลบริษัทสำหรับการจับคู่ TOR</p>
            <h1>ตั้งค่าโปรไฟล์และทักษะบริษัท</h1>
            <p>ข้อมูลนี้เป็นข้อมูลที่บริษัทระบุด้วยตนเอง ใช้เพื่อช่วยประเมินความเหมาะสมกับ TOR และไม่ต้องอัปโหลดเอกสารหลักฐาน</p>
          </div>
          <div className="profile-completeness" aria-label={`ความครบถ้วนของโปรไฟล์ ${completeness}%`}>
            <strong>{completeness}%</strong>
            <span>ความครบถ้วนของโปรไฟล์</span>
            <div>
              <i style={{ width: `${completeness}%` }} />
            </div>
          </div>
        </section>

        <section className="profile-card profile-company-card">
          <div className="profile-section-heading">
            <div>
              <p>ข้อมูลพื้นฐาน</p>
              <h2>ข้อมูลการดำเนินงานของบริษัท</h2>
            </div>
            <span>{isLoading ? "กำลังโหลด..." : isRemoteSaved ? "เชื่อมต่อกับฐานข้อมูล" : "ข้อมูลที่ระบุด้วยตนเอง"}</span>
          </div>
          <div className="profile-fields">
            <label>
              ชื่อบริษัท
              <input
                value={profile.company_name}
                onChange={(event) => {
                  setSaved(false);
                  setProfile((current) => ({ ...current, company_name: event.target.value }));
                }}
                placeholder="ชื่อบริษัทของคุณ"
              />
            </label>
            <label>
              ทุนจดทะเบียน (บาท)
              <input
                type="number"
                min="0"
                value={profile.registered_capital ?? ""}
                onChange={(event) => updateNumber("registered_capital", event.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              มูลค่างานสูงสุดที่ผ่านมา (บาท)
              <input
                type="number"
                min="0"
                value={profile.highest_past_project_value ?? ""}
                onChange={(event) => updateNumber("highest_past_project_value", event.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              จำนวนโครงการที่รับพร้อมกันได้
              <input
                type="number"
                min="0"
                value={profile.concurrent_project_capacity ?? ""}
                onChange={(event) => updateNumber("concurrent_project_capacity", event.target.value)}
                placeholder="0"
              />
            </label>
          </div>
        </section>

        <section className="profile-card">
          <div className="profile-section-heading">
            <div>
              <p>ทักษะและเทคโนโลยี</p>
              <h2>เลือกทักษะที่บริษัทมี</h2>
            </div>
            <span>{profile.skills.length} รายการ</span>
          </div>
          <div className="profile-tag-selector">
            {skills.map((skill) => (
              <button
                className={profile.skills.includes(skill) ? "is-selected" : ""}
                type="button"
                key={skill}
                onClick={() => {
                  setSaved(false);
                  setProfile((current) => ({ ...current, skills: toggleItem(current.skills, skill) }));
                }}
                aria-pressed={profile.skills.includes(skill)}
              >
                {skill}
              </button>
            ))}
          </div>
        </section>

        <section className="profile-card">
          <div className="profile-section-heading">
            <div>
              <p>ใบรับรอง (ไม่บังคับ)</p>
              <h2>เลือกใบรับรองที่เกี่ยวข้อง</h2>
            </div>
            <span>{profile.certifications.length} รายการ</span>
          </div>
          <div className="profile-tag-selector">
            {certifications.map((certification) => (
              <button
                className={profile.certifications.includes(certification) ? "is-selected" : ""}
                type="button"
                key={certification}
                onClick={() => {
                  setSaved(false);
                  setProfile((current) => ({ ...current, certifications: toggleItem(current.certifications, certification) }));
                }}
                aria-pressed={profile.certifications.includes(certification)}
              >
                {certification}
              </button>
            ))}
          </div>
        </section>

        <section className="profile-card profile-notification-card">
          <div>
            <p className="profile-kicker">การแจ้งเตือน</p>
            <h2>การแจ้งเตือนทางอีเมล</h2>
            <p>ส่งการแจ้งเตือนทางอีเมลเมื่อพบ TOR ที่มีค่า Match Score มากกว่า {profile.match_score_threshold}%</p>
          </div>
          <div className="profile-notification-controls">
            <label className="profile-switch">
              <input
                type="checkbox"
                checked={profile.email_notifications_enabled}
                onChange={(event) => {
                  setSaved(false);
                  setProfile((current) => ({ ...current, email_notifications_enabled: event.target.checked }));
                }}
              />
              <span />
              <strong>{profile.email_notifications_enabled ? "เปิดใช้งาน" : "ปิดอยู่"}</strong>
            </label>
            <label className="profile-threshold">
              เกณฑ์การแจ้งเตือน
              <select
                value={profile.match_score_threshold}
                onChange={(event) => {
                  setSaved(false);
                  setProfile((current) => ({ ...current, match_score_threshold: Number(event.target.value) }));
                }}
              >
                <option value="70">70%</option>
                <option value="80">80%</option>
                <option value="90">90%</option>
              </select>
            </label>
          </div>
        </section>

        <div className="profile-save-row">
          <p role="status">{saveStatusMessage}</p>
          <button className="profile-save-button" type="button" onClick={handleSaveProfile} disabled={isSaving}>
            {isSaving ? "กำลังบันทึก..." : "บันทึกข้อมูลโปรไฟล์"}
          </button>
        </div>

        {/* Delete Account Danger Zone */}
        <section className="profile-delete-card">
          <div>
            <h2>จัดการบัญชีผู้ใช้</h2>
            <p>เมื่อลบบัญชี ข้อมูลโปรไฟล์และประวัติการตั้งค่าทั้งหมดจะถูกลบออกจากระบบอย่างถาวร</p>
          </div>
          <button
            className="profile-delete-button"
            type="button"
            onClick={() => setShowDeleteModal(true)}
          >
            ลบบัญชีผู้ใช้
          </button>
        </section>

        {/* Warning Confirmation Popup Modal */}
        {showDeleteModal && (
          <div className="profile-modal-backdrop" role="dialog" aria-modal="true">
            <div className="profile-modal-box">
              <div className="profile-modal-icon">⚠️</div>
              <h3>ยืนยันการลบบัญชีผู้ใช้</h3>
              <p>
                คุณแน่ใจหรือไม่ว่าต้องการลบบัญชีผู้ใช้นี้? <br />
                การดำเนินการนี้<strong>ไม่สามารถยกเลิกได้</strong> ข้อมูลโปรไฟล์และการตั้งค่าทั้งหมดจะถูกลบออกจากระบบอย่างถาวร
              </p>
              <div className="profile-modal-actions">
                <button
                  className="profile-cancel-button"
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                >
                  ยกเลิก
                </button>
                <button
                  className="profile-confirm-delete-button"
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                >
                  {isDeleting ? "กำลังลบ..." : "ยืนยันลบบัญชี"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
