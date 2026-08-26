import AppShell from "@/components/ui/AppShell";
import { mockProjects } from "@/lib/mock-projects";

export default function AnalyticsPage() {
  const totalBudget = mockProjects.reduce((sum, project) => sum + project.budget, 0);
  return <AppShell title="ข้อมูลวิเคราะห์ย้อนหลัง"><section className="page-heading"><div><p className="eyebrow">PUBLIC ANALYTICS</p><h1>ภาพรวมข้อมูล TOR</h1><p>หน้าสรุปนี้จะเชื่อมกับ `/analytics/search` และ `/analytics/export` ในระยะถัดไป</p></div></section><section className="facts-grid"><div><span>จำนวนโครงการ</span><strong>{mockProjects.length}</strong></div><div><span>งบประมาณรวม</span><strong>{totalBudget.toLocaleString("th-TH")} บาท</strong></div><div><span>โครงการซอฟต์แวร์</span><strong>{mockProjects.filter((project) => project.is_software).length}</strong></div></section></AppShell>;
}
