import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Storage HQ", template: "%s · Storage HQ" },
  description: "Everyday Storage HQ — units, renters, agreements, invoicing and payments for Everyday Storage Aruba.",
  appleWebApp: { capable: true, title: "Storage HQ", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#293221" },
    { media: "(prefers-color-scheme: dark)", color: "#171d14" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("shq_theme")?.value;
  return (
    <html lang="en" data-theme={theme === "light" || theme === "dark" ? theme : undefined} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
