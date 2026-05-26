import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AnonymousAuthProvider } from "@/components/auth/anonymous-auth-provider";
import { Sidebar } from "@/components/sidebar";
import { Ticker } from "@/components/ticker";
import { COPY } from "@/lib/copy";
import { LegalFooter } from "@/components/legal/legal-footer";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter"
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"]
});

export const metadata: Metadata = {
  title: `ATT Profit Shield — ${COPY.tagline}`,
  description:
    "An automated financial cockpit that calls out vendor price creep, macro inflation, and silent margin bleed."
};

export const viewport: Viewport = {
  themeColor: "#15100D"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} dark`}>
      <body className="min-h-screen bg-cocoa-950 text-cream">
        <AnonymousAuthProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 min-w-0 flex flex-col">
              <Ticker />
              <div className="px-6 md:px-10 lg:px-14 pb-24 pt-8">{children}</div>
              <LegalFooter />
            </main>
          </div>
          <Script src="https://cdn.teller.io/connect/connect.js" strategy="lazyOnload" />
        </AnonymousAuthProvider>
      </body>
    </html>
  );
}
