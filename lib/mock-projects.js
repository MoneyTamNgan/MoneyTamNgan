export const mockProjects = [
  { project_id: "TOR-2569-001", project_name: "โครงการพัฒนาระบบบริการประชาชนดิจิทัล", dept_name: "สำนักดิจิทัลกรุงเทพมหานคร", budget: 7479600, project_status: "Active", is_software: true, timeline: { announce_date: "2026-08-01" }, extracted_data: { summary: "พัฒนาเว็บไซต์และบริการดิจิทัลเพื่อให้ประชาชนเข้าถึงข้อมูลและบริการของกรุงเทพมหานครได้สะดวกขึ้น", qualifications: ["มีประสบการณ์พัฒนาระบบสารสนเทศ", "มีทีมงานด้านซอฟต์แวร์และความมั่นคงปลอดภัย"], scope_of_work: ["ออกแบบและพัฒนาระบบเว็บ", "จัดทำคู่มือและถ่ายทอดความรู้"], tech_stack: ["React", "Node.js", "Cloud"] } },
  { project_id: "TOR-2569-002", project_name: "ระบบบริหารจัดการจราจรอัจฉริยะ", dept_name: "สำนักการจราจรและขนส่ง", budget: 15000000, project_status: "Active", is_software: true, timeline: { announce_date: "2026-08-12" }, extracted_data: { summary: "ระบบติดตามและวิเคราะห์ข้อมูลจราจรเพื่อสนับสนุนการตัดสินใจของเจ้าหน้าที่", qualifications: ["มีผลงานระบบข้อมูลขนาดใหญ่"], scope_of_work: ["พัฒนาระบบวิเคราะห์ข้อมูล", "ติดตั้งและทดสอบระบบ"], tech_stack: ["Data Analytics", "API", "Cloud"] } },
];

export function getMockProject(id) {
  return mockProjects.find((project) => project.project_id === id);
}
