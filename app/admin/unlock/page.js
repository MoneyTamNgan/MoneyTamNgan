import AdminUnlockForm from "@/components/ui/AdminUnlockForm";

export const metadata = { title: "ยืนยันรหัสผู้ดูแล" };

export default async function AdminUnlockPage({ searchParams }) {
  const { next } = await searchParams;
  return <AdminUnlockForm next={typeof next === "string" ? next : "/admin"} />;
}
