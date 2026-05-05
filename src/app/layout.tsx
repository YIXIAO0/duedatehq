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

/**
 * SEO foundation. `metadataBase` lets relative URLs in OG / Twitter
 * resolve correctly across preview deploys. The title `template` lets
 * per-page metadata set just `%s` and have " · DueDateHQ" appended
 * automatically; the landing page opts out via `title.absolute`.
 */
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "DueDateHQ — Tax Deadline Tool for Small CPAs",
    template: "%s · DueDateHQ",
  },
  description:
    "DueDateHQ is the modern tax deadline tracker built for independent CPAs and small accounting firms. Federal + 50-state coverage, automatic IRS disaster-relief updates, and per-client deadline workflows.",
  keywords: [
    "tax deadline tool",
    "tax deadline tool for small CPAs",
    "CPA deadline tool",
    "tax deadline tracker",
    "CPA deadline tracker",
    "tax filing deadline software",
    "IRS deadline tracker for accountants",
    "tax deadline management",
    "small accounting firm software",
    "CPA practice management",
    "tax due date tracker",
    "tax workflow software",
    "IRS deadline reminder",
    "PTE election tracker",
    "state tax deadlines",
  ],
  applicationName: "DueDateHQ",
  authors: [{ name: "DueDateHQ" }],
  creator: "DueDateHQ",
  publisher: "DueDateHQ",
  category: "Business Software",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "DueDateHQ",
    title: "DueDateHQ — Tax Deadline Tool for Small CPAs",
    description:
      "Modern tax deadline tracker for independent CPAs. Federal + 50-state coverage, automatic IRS disaster-relief updates, per-client deadline workflows.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "DueDateHQ — Tax Deadline Tool for Small CPAs",
    description:
      "Tax deadline tracker for independent CPAs. Federal + 50-state, IRS auto-updates.",
  },
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
