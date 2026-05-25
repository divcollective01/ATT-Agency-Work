"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, LineChart, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { COPY } from "@/lib/copy";

const links = [
  { href: "/", label: COPY.nav.leaks, icon: Wallet, code: "01" },
  { href: "/materials", label: COPY.nav.materials, icon: Boxes, code: "02" },
  { href: "/inflation", label: COPY.nav.inflation, icon: Activity, code: "03" },
  { href: "/forecast", label: COPY.nav.forecast, icon: LineChart, code: "04" }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 h-screen w-[280px] shrink-0 border-r border-cocoa-700 bg-cocoa-950/80 backdrop-blur-xl hidden lg:flex flex-col">
      <div className="px-7 pt-8 pb-6">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="size-10 rounded-2xl bg-vibrant flex items-center justify-center text-cocoa-950 shadow-glow">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="font-display text-xl leading-none tracking-tight">{COPY.brand}</p>
            <p className="text-[11px] uppercase tracking-[0.22em] text-cream-mute mt-1">ATT Agency</p>
          </div>
        </Link>
      </div>

      <div className="hairline-divider mx-7" />

      <nav className="px-4 py-6 flex-1 space-y-1">
        {links.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "group flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition-colors",
                active
                  ? "bg-cocoa-800 text-cream"
                  : "text-cream-dim hover:text-cream hover:bg-cocoa-900"
              )}
            >
              <span
                className={cn(
                  "size-9 rounded-xl flex items-center justify-center border border-cocoa-700",
                  active ? "bg-vibrant text-cocoa-950 border-vibrant" : "bg-cocoa-900 text-cream-mute"
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="flex-1">
                <span className="block text-[10px] uppercase tracking-[0.22em] text-cream-mute">
                  Screen {l.code}
                </span>
                <span className="block font-medium">{l.label}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="m-4 rounded-2xl border border-cocoa-700 bg-cocoa-900 p-4">
        <p className="text-[11px] uppercase tracking-[0.2em] text-cream-mute">Live signals</p>
        <p className="font-display text-xl mt-1 leading-tight">
          FRED + Teller
        </p>
        <p className="text-xs text-cream-mute mt-1">
          Macro and bank data feed every screen.
        </p>
      </div>
    </aside>
  );
}
