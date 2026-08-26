"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/ui/AppShell";
import { mockProjects } from "@/lib/mock-projects";

export default function DashboardPage() {
  const [query, setQuery] = useState("");
  const [softwareOnly, setSoftwareOnly] = useState(false);
  const projects = useMemo(() => mockProjects.filter((project) => {
    const haystack = `${project.project_name} ${project.dept_name}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (!softwareOnly || project.is_software);
  }), [query, softwareOnly]);

  return <AppShell title="โครงการ TOR">
    <section className="page-heading"><div><p className="eyebrow">PROJECT DISCOVERY</p><h1>ค้นหาโครงการที่ใช่</h1><p>รายการ TOR ที่เตรียมพร้อมสำหรับการเชื่อมต่อกับข้อมูลจริง</p></div><Link className="secondary-button" href="/profile">ตั้งค่าโปรไฟล์บริษัท</Link></section>
    <section className="filter-bar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อโครงการหรือหน่วยงาน" /><label><input type="checkbox" checked={softwareOnly} onChange={(event) => setSoftwareOnly(event.target.checked)} /> เฉพาะโครงการซอฟต์แวร์</label></section>
    <section className="project-grid">{projects.map((project) => <article className="project-card" key={project.project_id}><div className="card-top"><span className={project.is_software ? "tag software" : "tag"}>{project.is_software ? "ซอฟต์แวร์ / ไอที" : "ทั่วไป"}</span><span>{project.project_status}</span></div><h2>{project.project_name}</h2><p>{project.dept_name}</p><dl><div><dt>งบประมาณ</dt><dd>{project.budget.toLocaleString("th-TH")} บาท</dd></div><div><dt>ประกาศ</dt><dd>{project.timeline.announce_date}</dd></div></dl><Link href={`/tors/${project.project_id}`}>ดูภาพรวม →</Link></article>)}</section>
    {projects.length === 0 && <p className="empty-state">ไม่พบโครงการที่ตรงกับการค้นหา</p>}
  </AppShell>;
}
