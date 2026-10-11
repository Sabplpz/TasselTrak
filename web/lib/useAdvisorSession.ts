"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { getDatabase, ref, get } from "firebase/database";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";

// Same Realtime Database the login page reads the role from.
const ROLE_DB_URL = "https://tasseltrak-69d99-default-rtdb.firebaseio.com";

// Row from GET /api/advisors
export type Advisor = { id: number; name: string; email: string; department: string | null };

export type AdvisorSession =
  | { status: "checking" }
  | { status: "ready"; advisor: Advisor }
  | { status: "unlinked"; email: string | null }
  | { status: "error" };

// Development only: ?advisorId= picks the advisor directly, so pages can be built before the
// advisor accounts exist. The sign-in and role checks still run first. Never active in production.
function devAdvisorId(): number | null {
  if (process.env.NODE_ENV !== "development") return null;
  const value = new URLSearchParams(window.location.search).get("advisorId");
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

// Gate for advisor-only pages. Signed-out users go to /login and non-advisors to /dashboard.
// A signed-in advisor is matched to an advisor row by email.
export function useAdvisorSession() {
  const router = useRouter();
  const [session, setSession] = useState<AdvisorSession>({ status: "checking" });

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

        setSession(advisor ? { status: "ready", advisor } : { status: "unlinked", email: user.email });
      } catch {
        if (!cancelled) setSession({ status: "error" });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    router.replace("/login");
  }, [router]);

  return { session, signOut };
}
