import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

import { ThemeSync } from "@/components/theme-toggle";
import { NO_FLASH_THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Global Content",
  description: "Global Content dashboard.",
};

// Applied before paint to prevent a flash. Light is the guaranteed default;
// dark and Auto are explicit gc-theme choices. Auto is never implied.

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
