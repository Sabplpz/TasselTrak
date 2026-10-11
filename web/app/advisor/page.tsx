"use client";

import { AdvisorGate } from "@/components/AdvisorGate";
import { AdvisorDashboard } from "./AdvisorDashboard";

export default function AdvisorPage() {
  return <AdvisorGate>{(advisor, signOut) => <AdvisorDashboard advisor={advisor} onSignOut={signOut} />}</AdvisorGate>;
}
