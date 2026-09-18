import "./globals.css";
import SidebarLayout from "@/components/ui/SidebarLayout";

export const metadata = {
  title: "MoneyTamNgan",
  description: "TOR tracking and analysis portal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <SidebarLayout>{children}</SidebarLayout>
      </body>
    </html>
  );
}
