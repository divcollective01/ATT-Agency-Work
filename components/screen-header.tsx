export function ScreenHeader({
  eyebrow,
  headline,
  sub,
  trailing
}: {
  eyebrow: string;
  headline: string;
  sub?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="pt-6 pb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
      <div className="max-w-3xl">
        <p className="text-[11px] uppercase tracking-[0.28em] text-vibrant">{eyebrow}</p>
        <h1 className="font-display text-display-xl mt-4 leading-[0.96] text-balance">
          {headline}
        </h1>
        {sub && <p className="mt-5 text-cream-dim text-lg max-w-2xl leading-relaxed">{sub}</p>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </header>
  );
}
