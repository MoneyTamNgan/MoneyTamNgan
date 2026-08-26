import AppShell from "@/components/ui/AppShell";

export default function AdminPage() {
  return <AppShell title="ผู้ดูแลระบบ"><section className="page-heading"><div><p className="eyebrow">ADMIN CONSOLE</p><h1>จัดการข้อมูล TOR</h1><p>โครงหน้าสำหรับการนำเข้าข้อมูล ตรวจสอบการจัดหมวดหมู่ และติดตามงานประมวลผล</p></div></section><section className="two-column"><article className="content-card"><h2>นำเข้าข้อมูล</h2><p>เชื่อมต่อกับ `POST /admin/ingestion/runs` เมื่อ backend พร้อมใช้งาน</p><button className="secondary-button" type="button">เริ่มนำเข้า</button></article><article className="content-card"><h2>คิวตรวจสอบ</h2><p>เชื่อมต่อกับ `GET /admin/classification/queue` สำหรับตรวจทานการจัดประเภท TOR</p><button className="secondary-button" type="button">ดูคิว</button></article></section></AppShell>;
}
