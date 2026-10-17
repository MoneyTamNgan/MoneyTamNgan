import AppShell from "@/components/ui/AppShell";
import AdminTorConsole from "@/components/ui/AdminTorConsole";
import { listLiveProjectRecords } from "@/lib/services/live-project-record";
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const projects = await listLiveProjectRecords();
  return <AppShell title="ผู้ดูแลระบบ"><AdminTorConsole projects={projects} /></AppShell>;
}
