import AppShell from "@/components/ui/AppShell";
import AnalyticsExportButtons from "@/components/ui/AnalyticsExportButtons";
import { listProjectRecords } from "@/lib/services/tor-service";

const statusLabels = { Active: "กำลังใช้งาน", Superseded: "มีฉบับใหม่", Invalid: "ไม่ถูกต้อง", Cancelled: "ยกเลิก" };

function groupTotal(items, key, value = () => 1) {
  return [...items.reduce((groups, item) => groups.set(key(item), (groups.get(key(item)) ?? 0) + value(item)), new Map()).entries()].map(([label, amount]) => ({ label, amount })).sort((first, second) => second.amount - first.amount);
}

function hasExtractedData(project) {
  return Boolean((project.extracted_data.summary && project.extracted_data.summary !== "ยังไม่มีข้อมูล") || project.extracted_data.qualifications.length || project.extracted_data.scope_of_work.length || project.extracted_data.tech_stack.length);
}

function formatMillion(value) {
  return `${(value / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ล้านบาท`;
}

export default async function AnalyticsPage() {
  const projects = await listProjectRecords();
  const totalBudget = projects.reduce((sum, project) => sum + project.budget, 0);
  const agencyBudget = groupTotal(projects, (project) => project.dept_name, (project) => project.budget).slice(0, 7);
  const statusCount = groupTotal(projects, (project) => statusLabels[project.project_status] ?? project.project_status);
  const technologyCount = groupTotal(projects.flatMap((project) => project.extracted_data.tech_stack), (technology) => technology).slice(0, 8);
  const highestAgencyBudget = agencyBudget[0]?.amount ?? 1;
  const highestStatusCount = statusCount[0]?.amount ?? 1;
  const highestTechCount = technologyCount[0]?.amount ?? 1;
  const extractedCount = projects.filter(hasExtractedData).length;
  const anomalyCount = projects.filter((project) => project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length > 0).length;

  return <AppShell title="ข้อมูลวิเคราะห์"><div className="analytics-page"><section className="analytics-hero"><p>ข้อมูลจาก ProjectRecord</p><h1>ภาพรวมข้อมูล TOR</h1><span>สรุปจากข้อมูลโครงการที่จัดเก็บในระบบ ได้แก่ หน่วยงาน งบประมาณ สถานะ ประเภทโครงการ ข้อมูลเอกสาร และข้อสังเกต</span><AnalyticsExportButtons projects={projects} /></section>
    <section className="analytics-metrics" aria-label="สรุปข้อมูลโครงการ"><article><span>โครงการทั้งหมด</span><strong>{projects.length.toLocaleString("th-TH")}</strong></article><article><span>งบประมาณรวม</span><strong>{formatMillion(totalBudget)}</strong></article><article><span>โครงการซอฟต์แวร์ / ไอที</span><strong>{projects.filter((project) => project.is_software).length.toLocaleString("th-TH")}</strong></article><article><span>โครงการที่มีข้อสังเกต</span><strong>{anomalyCount.toLocaleString("th-TH")}</strong></article></section>
    <section className="analytics-grid"><article className="analytics-chart analytics-chart-wide"><div className="analytics-chart-heading"><div><p>งบประมาณตามหน่วยงาน</p><h2>หน่วยงานที่มีงบประมาณโครงการสูงสุด</h2></div><span>หน่วย: บาท</span></div><div className="analytics-bars">{agencyBudget.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} บาท</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} บาท`}><i style={{ width: `${(item.amount / highestAgencyBudget) * 100}%` }} /></div></div>)}</div></article>
      <article className="analytics-chart"><div className="analytics-chart-heading"><div><p>สถานะโครงการ</p><h2>จำนวนโครงการตามสถานะ</h2></div><span>หน่วย: โครงการ</span></div><div className="analytics-bars analytics-status-bars">{statusCount.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} โครงการ</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} โครงการ`}><i style={{ width: `${(item.amount / highestStatusCount) * 100}%` }} /></div></div>)}</div></article>
      <article className="analytics-chart"><div className="analytics-chart-heading"><div><p>เทคโนโลยีจากเอกสาร</p><h2>เทคโนโลยีที่พบมากที่สุด</h2></div><span>หน่วย: โครงการ</span></div><div className="analytics-bars analytics-tech-bars">{technologyCount.length ? technologyCount.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} โครงการ</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} โครงการ`}><i style={{ width: `${(item.amount / highestTechCount) * 100}%` }} /></div></div>) : <p className="analytics-empty">ยังไม่มีข้อมูลเทคโนโลยีที่สกัดจากเอกสาร</p>}</div></article></section>
    <section className="analytics-document-state"><div><span>ข้อมูลเอกสารพร้อมใช้งาน</span><strong>{extractedCount.toLocaleString("th-TH")} / {projects.length.toLocaleString("th-TH")} โครงการ</strong><i><b style={{ width: `${projects.length ? (extractedCount / projects.length) * 100 : 0}%` }} /></i></div><p>สถานะนี้พิจารณาจากข้อมูลสรุป คุณสมบัติ ขอบเขตงาน หรือเทคโนโลยีที่สกัดไว้ใน ProjectRecord</p></section>
  </div></AppShell>;
}
