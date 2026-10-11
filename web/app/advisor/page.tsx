"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/Button";
import { AdvisorDashboard, type Advisor } from "./AdvisorDashboard";

// Same Realtime Database the login page reads the role from.
const ROLE_DB_URL = "https://tasseltrak-69d99-default-rtdb.firebaseio.com";

type Gate =
  | { status: "checking" }
  | { status: "ready"; advisor: Advisor }
  | { status: "unlinked"; email: string | null }
  | { status: "error" };

// Development only: ?advisorId= picks the advisor directly, so the page can be built before the
// advisor accounts exist. The sign-in and role checks still run first. Never active in production.
function devAdvisorId(): number | null {
  if (process.env.NODE_ENV !== "development") return null;
  const value = new URLSearchParams(window.location.search).get("advisorId");
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function Notice({ title, children, onSignOut }: { title: string; children: React.ReactNode; onSignOut: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col bg-surface-canvas text-ink-primary">
      <TopBar surface />
      <div className="flex flex-1 items-center justify-center p-6">
        <div
          role="alert"
          className="flex w-full max-w-[440px] flex-col gap-4 rounded-panel border border-border-subtle bg-surface-card p-7 shadow-note"
        >
          <h1 className="text-title-18 text-ink-primary">{title}</h1>
          <p className="text-body-14 text-ink-secondary">{children}</p>
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </main>
  );
}

export default function AdvisorPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const snapshot = await get(ref(getDatabase(auth.app, ROLE_DB_URL), `users/${user.uid}/role`));
        if (cancelled) return;
        if (snapshot.val() !== "advisor") {
          router.replace("/dashboard");
          return;
        }

        const res = await fetch("/api/advisors");
        if (!res.ok) throw new Error(`Request failed (${res.status}).`);
        const { advisors } = (await res.json()) as { advisors: Advisor[] };
        if (cancelled) return;

        const overrideId = devAdvisorId();
        const email = user.email?.trim().toLowerCase();
        const advisor =
          overrideId !== null
            ? advisors.find((a) => a.id === overrideId)
            : advisors.find((a) => !!email && a.email?.trim().toLowerCase() === email);

        setGate(advisor ? { status: "ready", advisor } : { status: "unlinked", email: user.email });
      } catch {
        if (!cancelled) setGate({ status: "error" });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  async function handleSignOut() {
    await signOut(auth);
    router.replace("/login");
  }

  if (gate.status === "checking") {
    return (
      <main className="flex min-h-dvh flex-col bg-surface-canvas text-ink-primary">
        <TopBar surface />
        <p className="p-6 text-body-14 text-ink-secondary">Checking session…</p>
      </main>
    );
  }

  if (gate.status === "unlinked") {
    return (
      <Notice title="No advisor profile is linked to this account" onSignOut={handleSignOut}>
        {gate.email ? `${gate.email} does not match any advisor.` : "This account has no email address."} Ask an
        administrator to add your UCF email to your advisor profile.
      </Notice>
    );
  }

  if (gate.status === "error") {
    return (
      <Notice title="We could not load your advisor profile" onSignOut={handleSignOut}>
        Check your connection and reload the page. If it keeps happening, sign out and sign in again.
      </Notice>
    );
  }

  return <AdvisorDashboard advisor={gate.advisor} onSignOut={handleSignOut} />;
}
