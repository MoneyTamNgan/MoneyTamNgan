import AppShell from "@/components/ui/AppShell";

export default function ProfilePage() {
  return <AppShell title="โปรไฟล์บริษัท"><section className="page-heading"><div><p className="eyebrow">CONTRACTOR PROFILE</p><h1>ตั้งค่าโปรไฟล์บริษัท</h1><p>ข้อมูลนี้จะใช้ประเมินความเหมาะสมกับ TOR ในอนาคต</p></div></section><form className="profile-form"><label>ชื่อบริษัท<input placeholder="ชื่อบริษัทของคุณ" /></label><label>ทักษะและเทคโนโลยี<textarea placeholder="เช่น React, Node.js, Cloud" rows="4" /></label><label>มูลค่างานที่รองรับ<input type="number" placeholder="0" /></label><button className="primary-button" type="button">บันทึกข้อมูล</button></form></AppShell>;
}
