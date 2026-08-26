import AppShell from "@/components/ui/AppShell";
import AdminTorConsole from "@/components/ui/AdminTorConsole";
import { listProjectRecords } from "@/lib/services/tor-service";

export default async function AdminPage() {
  const projects = await listProjectRecords();
  return <AppShell title="ผู้ดูแลระบบ"><AdminTorConsole projects={projects} /></AppShell>;
}
