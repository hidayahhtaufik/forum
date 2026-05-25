import { IslandLayout } from "@/components/IslandLayout";
import { PulauMap } from "@/components/scenes/PulauMap";
import { HowItWorks } from "@/components/HowItWorks";
import { Leaderboard } from "@/components/Leaderboard";
import { MarketSection } from "@/components/MarketSection";
import { Agents } from "@/components/Agents";
import { RevenueStats } from "@/components/RevenueStats";
import { Footer } from "@/components/Footer";
import { WavyDivider } from "@/components/WavyDivider";
import { HeroBadges } from "@/components/HeroBadges";
import { BrandStrip } from "@/components/BrandStrip";
import { ArcPropertiesCallout } from "@/components/ArcPropertiesCallout";
import {
  fetchMarkets,
  fetchRecentBets,
  fetchProtocolStats,
  aggregateAgents,
  knownAgent,
} from "@/lib/api";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [markets, recentBets, stats] = await Promise.all([
    fetchMarkets(),
    fetchRecentBets(50),
    fetchProtocolStats(),
  ]);
  const agents = aggregateAgents(recentBets);

  // Build label lookup for ticker rows.
  const agentLabels: Record<string, string> = {};
  for (const a of agents) {
    const known = knownAgent(a.address);
    if (known?.label) agentLabels[a.address.toLowerCase()] = known.label;
  }

  const openMarket = markets.find((m) => m.phase === 0) ?? null;
  const freshness = recentBets[0] ? `last bet ${relativeTime(recentBets[0].createdAt)}` : undefined;

  return (
    <>
      <IslandLayout>
        <PulauMap markets={markets} recentBets={recentBets} />
      </IslandLayout>
      <HeroBadges />
      <WavyDivider fill="var(--color-pastel-mint)" tone={0.45} />
      {stats && <RevenueStats stats={stats} />}
      <BrandStrip />
      <HowItWorks />
      <WavyDivider fill="var(--color-pastel-peach)" tone={0.35} flip />
      <ArcPropertiesCallout />
      <Leaderboard agents={agents} {...(freshness ? { freshness } : {})} />
      <MarketSection market={openMarket} bets={recentBets} />
      <WavyDivider fill="var(--color-pastel-sky)" tone={0.4} />
      <Agents agents={agents} />
      <Footer />
    </>
  );
}
