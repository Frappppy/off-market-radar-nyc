import Explorer from "@/components/Explorer";
import HeroStats from "@/components/HeroStats";

// Map-first landing (owner decision): hero + mini explorer + insights.
export default function Overview() {
  return (
    <div className="space-y-4">
      <HeroStats />
      <Explorer compact />
      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["Staten Island price cuts cluster", "Outer-borough houses show the largest drops — longer DOM, motivated sellers before winter."],
          ["Condos move faster than houses", "Median DOM is lower for condos; High scores concentrate in houses and multi-family."],
          ["Small sample, real pipeline", "Demo runs on an 82-record frozen sample; live Neon accumulates the daily time-series behind the trend lines."],
        ].map(([t, b]) => (
          <article key={t} className="panel p-4">
            <h2 className="font-semibold text-zinc-100">{t}</h2>
            <p className="mt-1 text-sm text-zinc-400">{b}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
