"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigationItems = [
  { href: "/dashboard", label: "หน้าหลัก", icon: "⌂" },
  { href: "/profile", label: "โปรไฟล์", icon: "◉" },
  { href: "/analytics", label: "วิเคราะห์", icon: "⌁" },
  { href: "/admin", label: "ผู้ดูแลระบบ", icon: "⚿", restricted: true },
];

export default function SidebarLayout({ children }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const isHome = pathname === "/dashboard" || pathname.startsWith("/tors/");

  return <div className={`sidebar-layout ${isOpen ? "is-open" : ""}`}>
    <aside className="app-sidebar" aria-label="เมนูหลัก">
      <div className="sidebar-top"><Link className="sidebar-brand" href="/dashboard" aria-label="หน้าหลัก BMA TOR TRACKER"><span className="sidebar-seal">BMA</span><span className="sidebar-brand-copy">BMA TOR<br /><strong>TRACKER</strong></span></Link><button className="sidebar-toggle" type="button" onClick={() => setIsOpen((open) => !open)} aria-label={isOpen ? "ย่อเมนูด้านข้าง" : "ขยายเมนูด้านข้าง"} aria-expanded={isOpen}><span aria-hidden="true">{isOpen ? "‹" : "›"}</span></button></div>
      <section className="sidebar-profile-section" aria-label="ข้อมูลโปรไฟล์"><p className="sidebar-section-label">โปรไฟล์</p><div className="sidebar-profile-preview"><span className="sidebar-profile-photo" aria-hidden="true">พ</span><span className="sidebar-profile-copy"><strong>บริษัทตัวอย่าง</strong><small>ผู้ใช้งานระบบ</small></span></div><Link className="sidebar-profile-editor" href="/profile" title="แก้ไขโปรไฟล์"><span aria-hidden="true">✎</span><strong>แก้ไขโปรไฟล์</strong><i aria-hidden="true">›</i></Link></section>
      <nav className="sidebar-nav">{navigationItems.map((item) => {
        const active = item.href === "/dashboard" ? isHome : pathname === item.href;
        return <Link className={active ? "is-active" : ""} href={item.href} key={item.href} title={item.label}><span className="sidebar-icon" aria-hidden="true">{item.icon}</span><span className="sidebar-label">{item.label}</span>{item.restricted && <span className="sidebar-restricted">ต้องมีสิทธิ์</span>}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><p className="sidebar-version">โหมดข้อมูลตัวอย่าง</p></div>
    </aside>
    <div className="sidebar-page">{children}</div>
  </div>;
}
