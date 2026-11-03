import "./globals.css";
import SidebarLayout from "@/components/ui/SidebarLayout";
import { headers } from 'next/headers';

export const metadata = {
  title: "MoneyTamNgan",
  description: "TOR tracking and analysis portal",
};

export default async function RootLayout({ children }) {
  // Nonce-bearing framework scripts require request-time rendering.
  await headers();
  return (
    <html lang="th" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <SidebarLayout>{children}</SidebarLayout>
      </body>
    </html>
  );
}
