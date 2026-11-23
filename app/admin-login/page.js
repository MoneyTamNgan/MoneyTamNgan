import AdminLoginForm from "@/components/ui/AdminLoginForm";

export const metadata = { title: "เข้าสู่ระบบผู้ดูแลระบบ" };

export default async function AdminLoginPage({ searchParams }) {
  const { next } = await searchParams;
  return <AdminLoginForm next={typeof next === "string" ? next : "/admin"} />;
}
