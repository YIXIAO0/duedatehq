import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

/**
 * Söhne — Klim Type Foundry. Locked typography per Dify brand skill.
 * Weights map per the brand spec:
 *   Buch (book / regular)  → 400  body, nav, captions, all UI text
 *   Kräftig (semi-bold)    → 600  H1 / hero / major section titles
 *   Halbfett (bold)        → 700  H2 / H3 / plan names / emphasis
 *
 * Using next/font/local lets Next bundle, preload, and self-host the
 * woff2 files — no FOUT, no third-party request, no licensing risk
 * (we own the files locally via Klim license held by Dify/LangGenius).
 */
const sohne = localFont({
  src: [
    { path: "./fonts/soehne-buch.woff2", weight: "400", style: "normal" },
    { path: "./fonts/soehne-kraftig.woff2", weight: "600", style: "normal" },
    { path: "./fonts/soehne-halbfett.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sohne",
  display: "swap",
});

const sohneMono = localFont({
  src: [
    { path: "./fonts/soehne-mono-buch.woff2", weight: "400", style: "normal" },
    { path: "./fonts/soehne-mono-kraftig.woff2", weight: "600", style: "normal" },
    { path: "./fonts/soehne-mono-halbfett.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sohne-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DueDateHQ — Never miss another tax deadline",
  description:
    "Cloud-based tax deadline tracking for independent CPAs and tax pros. Federal + 50-state coverage, auto-updates for IRS disaster extensions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sohne.variable} ${sohneMono.variable} h-full antialiased`}
    >
      {/* Cache Components pattern: ClerkProvider inside body, not wrapping html */}
      <body className="min-h-full flex flex-col">
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
