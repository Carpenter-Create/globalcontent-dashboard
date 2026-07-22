import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Global Content",
  description: "Global Content dashboard.",
};

// Applied before paint to prevent a flash. Light is the guaranteed default;
// dark is purely opt-in (we intentionally do NOT auto-adopt the OS preference).
const NO_FLASH_THEME = `(function(){try{if(localStorage.getItem('gc-theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
