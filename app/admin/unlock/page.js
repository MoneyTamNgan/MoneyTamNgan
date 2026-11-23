import AppShell from "@/components/ui/AppShell";
import AdminUnlockForm from "@/components/ui/AdminUnlockForm";

export default async function AdminUnlockPage({ searchParams }) {
  const { next } = await searchParams;
  return <AppShell title="ผู้ดูแลระบบ"><div className="bid-workspace"><AdminUnlockForm next={typeof next === "string" ? next : "/admin"} /></div></AppShell>;
}
