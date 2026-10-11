import AppShell from "@/components/ui/AppShell";
import AnalyticsExportButtons from "@/components/ui/AnalyticsExportButtons";
import { listLiveProjectRecords } from "@/lib/services/live-project-record";
export const dynamic = 'force-dynamic';

const statusLabels = { Active: "กำลังใช้งาน", Superseded: "มีฉบับใหม่", Invalid: "ไม่ถูกต้อง", Cancelled: "ยกเลิก" };

function formatMillion(value) {
  return `${(value / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ล้านบาท`;
}

async function loadAggregates() {
  await connectDB();
  return computeSpendAggregates(Project, {}, { agencyLimit: 7 });
}

export default async function AnalyticsPage() {
  const projects = await listLiveProjectRecords();
  const totalBudget = projects.reduce((sum, project) => sum + project.budget, 0);
  const agencyBudget = groupTotal(projects, (project) => project.dept_name, (project) => project.budget).slice(0, 7);
  const statusCount = groupTotal(projects, (project) => statusLabels[project.project_status] ?? project.project_status);
  const technologyCount = groupTotal(projects.flatMap((project) => project.extracted_data.tech_stack), (technology) => technology).slice(0, 8);
  const highestAgencyBudget = agencyBudget[0]?.amount ?? 1;
  const highestStatusCount = statusCount[0]?.amount ?? 1;
  const highestTechCount = technologyCount[0]?.amount ?? 1;
  const extractedCount = projects.filter(hasExtractedData).length;
  const anomalyCount = projects.filter((project) => project.anomalies.high_budget_flag || project.anomalies.flagged_clauses.length > 0).length;

  return <AppShell title="ข้อมูลวิเคราะห์"><div className="analytics-page"><section className="analytics-hero"><p>ข้อมูลสาธารณะ · ไม่ต้องเข้าสู่ระบบ</p><h1>ภาพรวมข้อมูล TOR</h1><span>สรุปจากข้อมูลโครงการที่จัดเก็บในระบบ ได้แก่ หน่วยงาน งบประมาณ สถานะ ประเภทโครงการ ข้อมูลเอกสาร และข้อสังเกต</span><AnalyticsExportButtons /></section>
    <section className="analytics-metrics" aria-label="สรุปข้อมูลโครงการ"><article><span>โครงการทั้งหมด</span><strong>{projectCount.toLocaleString("th-TH")}</strong></article><article><span>งบประมาณรวม</span><strong>{formatMillion(aggregates.totalSpend)}</strong><small>เฉลี่ย {formatMillion(aggregates.meanBudget)} ต่อโครงการ</small></article><article><span>โครงการซอฟต์แวร์ / ไอที</span><strong>{aggregates.softwareCount.toLocaleString("th-TH")}</strong></article><article><span>โครงการที่มีข้อสังเกต</span><strong>{anomalyCount.toLocaleString("th-TH")}</strong></article></section>
    <section className="analytics-grid"><article className="analytics-chart analytics-chart-wide"><div className="analytics-chart-heading"><div><p>งบประมาณตามหน่วยงาน</p><h2>หน่วยงานที่มีงบประมาณโครงการสูงสุด</h2></div><span>หน่วย: บาท</span></div><div className="analytics-bars">{agencyBudget.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} บาท · {item.count.toLocaleString("th-TH")} โครงการ · เฉลี่ย {item.mean.toLocaleString("th-TH", { maximumFractionDigits: 0 })} บาท</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} บาท`}><i style={{ width: `${(item.amount / highestAgencyBudget) * 100}%` }} /></div></div>)}</div></article>
      <article className="analytics-chart"><div className="analytics-chart-heading"><div><p>สถานะโครงการ</p><h2>จำนวนโครงการตามสถานะ</h2></div><span>หน่วย: โครงการ</span></div><div className="analytics-bars analytics-status-bars">{statusCount.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} โครงการ</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} โครงการ`}><i style={{ width: `${(item.amount / highestStatusCount) * 100}%` }} /></div></div>)}</div></article>
      <article className="analytics-chart"><div className="analytics-chart-heading"><div><p>เทคโนโลยีจากเอกสาร</p><h2>เทคโนโลยีที่พบมากที่สุด</h2></div><span>หน่วย: โครงการ</span></div><div className="analytics-bars analytics-tech-bars">{technologyCount.length ? technologyCount.map((item) => <div className="analytics-bar-row" key={item.label}><div><strong>{item.label}</strong><span>{item.amount.toLocaleString("th-TH")} โครงการ</span></div><div className="analytics-bar-track" aria-label={`${item.label} ${item.amount.toLocaleString("th-TH")} โครงการ`}><i style={{ width: `${(item.amount / highestTechCount) * 100}%` }} /></div></div>) : <p className="analytics-empty">ยังไม่มีข้อมูลเทคโนโลยีที่สกัดจากเอกสาร</p>}</div></article></section>
    <section className="analytics-document-state"><div><span>ข้อมูลเอกสารพร้อมใช้งาน</span><strong>{extractedCount.toLocaleString("th-TH")} / {projectCount.toLocaleString("th-TH")} โครงการ</strong><i><b style={{ width: `${projectCount ? (extractedCount / projectCount) * 100 : 0}%` }} /></i></div><p>นับโครงการที่ระบบสกัดสรุปจากเอกสาร TOR แล้ว</p></section>
  </div></AppShell>;
}
