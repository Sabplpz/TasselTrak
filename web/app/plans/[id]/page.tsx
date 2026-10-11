"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AdvisorGate } from "@/components/AdvisorGate";
import { PlanCanvas } from "./PlanCanvas";

function PlanRoute() {
  const { id } = useParams<{ id: string }>();
  return <AdvisorGate>{(advisor) => <PlanCanvas key={id} planId={id} advisor={advisor} />}</AdvisorGate>;
}

// The plan id is only known at request time, so the route reads it inside a Suspense boundary.
export default function PlanPage() {
  return (
    <Suspense fallback={<p className="p-6 text-body-14 text-ink-secondary">Loading plan…</p>}>
      <PlanRoute />
    </Suspense>
  );
}
