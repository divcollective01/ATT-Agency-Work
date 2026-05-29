"use client";

import { useEffect, useState } from "react";

type ModalKey = "terms" | "privacy" | null;

const TERMS_BODY = `Last updated May 11, 2026. These terms govern your use of Profit Shield and the relationship between you and ATT Agency. They are written in plain English on purpose. For any questions, contact us at contact@attagency.co.

1. Who we are: ATT Agency is a creative studio operating as a registered limited liability company (LLC). Founded by Saras Totey, Ryder Thompson, and Sunny Avula. "ATT," "we," "our," and "us" refer to ATT Agency.

2. Using this site: You may browse and execute pricing calculations for lawful corporate purposes. You may not target unauthorized server requests, harvest system content at scale, or deploy malicious scripts to disrupt performance. Access can be restricted at any time.

3. Third-party integrations: This application accesses data streams through third-party integrations, specifically Teller.io for bank transaction mapping and the St. Louis Fed (FRED) API for wholesale PPI/CPI statistics. We hold no liability for operational latency, parsing discrepancies, or uptime drops from these external providers.

4. Projections & Disclaimers: Financial forecasts are linear models built on user-provided costs and macro indexes. They represent tracking tools and do not constitute formal banking, accounting, tax, or wealth management advisory.

5. Liability: Provided "as is". ATT Agency, its founders, and contractors will not be liable for direct or indirect losses (including margin decay, volume spikes, or inventory pricing errors). Total claim liability is strictly capped at one hundred US dollars ($100).

6. Jurisdiction: Governed by the laws of the State of Colorado. Disputes resolved exclusively in the state or federal courts in Boulder County, Colorado.`;

const PRIVACY_BODY = `Last updated May 11, 2026. We collect as little as possible, we never sell it, and we keep it only as long as we need to. Here is exactly what happens to information feeding this margin cockpit.

1. Data Controller: ATT Agency is the controller of personal information. Reach us at contact@attagency.co.

2. Data Streams:
   a. User Inputs: Material labels, custom volatility percentages, units, and inventory cost bases.
   b. Banking Telemetry: Financial trails (accounts, transactions, ledger values) are retrieved directly via Teller.io API proxies when a connection is established.
   c. System Operation: Cloudflare Pages automatically records baseline security and request headers (IP address, timestamp, request strings). We deploy zero analytics trackers, pixels, or profiling cookies.

3. Purpose & Sharing: Used solely to calculate price drift adjustments and isolate spending leakage. We do not sell your records, pass profiles to brokers, or use data feeds to train external AI systems.

4. Security: Component state data is ring-fenced inside the relational layout database using strict Supabase Row Level Security (RLS) bound to anonymous user profiles. Transmissions are encrypted via standard HTTPS layers.`;

export function LegalFooter() {
  const [open, setOpen] = useState<ModalKey>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <footer className="mt-auto border-t border-[#27272A] bg-[#09090B]">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-6 py-6 text-sm text-[#A1A1AA] md:flex-row md:items-center md:justify-between md:px-10 lg:px-14">
          <p className="leading-relaxed">
            An ATT AGENCY product developed by Saras Totey, Ryder Thompson, and Sunny Avula.
          </p>
          <nav className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setOpen("terms")}
              className="rounded-md px-2 py-1 text-[#F4F4F5] underline-offset-4 transition hover:underline hover:text-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => setOpen("privacy")}
              className="rounded-md px-2 py-1 text-[#F4F4F5] underline-offset-4 transition hover:underline hover:text-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            >
              Privacy
            </button>
          </nav>
        </div>
      </footer>

      {open && (
        <LegalModal
          title={open === "terms" ? "Terms & Conditions" : "Privacy Policy"}
          body={open === "terms" ? TERMS_BODY : PRIVACY_BODY}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function LegalModal({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[#09090B]/70 backdrop-blur-sm"
      />

      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#27272A] bg-[#141417] shadow-card">
        <header className="flex items-center justify-between border-b border-[#27272A] px-6 py-4">
          <h2 className="font-display text-xl text-[#F4F4F5]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[#A1A1AA] transition hover:bg-[#1A1A1D] hover:text-[#F4F4F5] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          >
            Close
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5 text-sm leading-relaxed text-[#D4D4D8] whitespace-pre-wrap">
          {body}
        </div>
      </div>
    </div>
  );
}
