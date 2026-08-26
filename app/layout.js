import "./globals.css";

export const metadata = {
  title: "MoneyTamNgan",
  description: "TOR tracking and analysis portal",
};

export default function RootLayout({ children }) {
  return <html lang="th"><body>{children}</body></html>;
}
