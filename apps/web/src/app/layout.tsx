import type { Metadata, Viewport } from "next";
import { Geist, Newsreader } from "next/font/google";
import type { ReactNode } from "react";

import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", style: ["normal"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { default: "Reissue Workbench", template: "%s · Reissue" },
  description: "Inspect shipment documents, evidence, corrections and broker packets.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#14191b" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
