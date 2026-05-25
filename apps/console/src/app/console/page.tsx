import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { ConsoleView } from "./ConsoleView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Crab · Console",
  description: "Customize your FORUM crab, view your wallet, manage claims and bet activity.",
};

export default function ConsolePage() {
  return (
    <IslandLayout>
      <ConsoleView />
      <Footer />
    </IslandLayout>
  );
}
