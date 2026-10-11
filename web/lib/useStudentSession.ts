"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { get, getDatabase, ref } from "firebase/database";
import { useRouter } from "next/navigation";
import { auth } from "./firebase";
import { codeOf } from "./planApi";
import { loginStudent, type Student } from "./studentApi";

// Which student row the signed-in account is. `next` is where the API says they belong:
// "upload" when nothing is on file yet, "board" otherwise.
export type StudentLink =
  | { status: "checking" }
  | { status: "ready"; student: Student; next: "upload" | "board" }
  | { status: "unlinked" }
  | { status: "error" };

const toStudentId = (value: unknown) => (/^[1-9]\d*$/.test(String(value ?? "")) ? Number(value) : null);

// Development only, so pages can be built before the student accounts are linked. The sign-in
// check still runs first, and both overrides do nothing in production.
//   ?studentId=                   always wins: act as that student for this page load.
//   NEXT_PUBLIC_DEV_STUDENT_ID    fallback: used only when the signed-in email matches no student.
function devStudentOverride(): { query: number | null; fallback: number | null } {
  if (process.env.NODE_ENV !== "development") return { query: null, fallback: null };
  return {
    query: toStudentId(new URLSearchParams(window.location.search).get("studentId")),
    fallback: toStudentId(process.env.NEXT_PUBLIC_DEV_STUDENT_ID),
  };
}

// Session for student pages. Signed-out users go to /login and advisors to /advisor.
// A signed-in student is matched to a student row by email (students.email).
export function useStudentSession() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<StudentLink>({ status: "checking" });

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;

      setUser(currentUser);

      if (!currentUser) {
        setName("");
        setLoading(false);
        router.replace("/login");
        return;
      }

      setLoading(true);
      setLink({ status: "checking" });

      const fallbackName =
        currentUser.displayName ??
        currentUser.email?.split("@")[0] ??
        "Student";

      let profile: Record<string, unknown> | null = null;

      try {
        const db = getDatabase(
          auth.app,
          "https://tasseltrak-69d99-default-rtdb.firebaseio.com"
        );

        const snapshot = await get(
          ref(db, `users/${currentUser.uid}`)
        );

        profile = snapshot.val();
      } catch {
        // the name falls back to the account's own
      }

      if (!active) return;

      if (profile?.role === "advisor") {
        router.replace("/advisor");
        return;
      }

      const profileName = profile?.name ?? profile?.displayName;
      setName(typeof profileName === "string" && profileName ? profileName : fallbackName);
      setLoading(false);

      const dev = devStudentOverride();
      const email = currentUser.email?.trim();
      // Tried in order; a student that is not found moves on to the next.
      const lookups = [
        dev.query !== null ? { studentId: dev.query } : email ? { email } : null,
        dev.query === null && dev.fallback !== null ? { studentId: dev.fallback } : null,
      ].filter((by) => by !== null);

      for (const by of lookups) {
        try {
          const { student, next } = await loginStudent(by);
          if (active) setLink({ status: "ready", student, next });
          return;
        } catch (e) {
          if (codeOf(e) === "student_not_found") continue;
          if (active) setLink({ status: "error" });
          return;
        }
      }
      if (active) setLink({ status: "unlinked" });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    router.replace("/login");
  }, [router]);

  return { user, name, loading, link, signOut };
}
