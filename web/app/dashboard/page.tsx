
"use client";

import { Suspense, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";

// Row shape from GET /api/caseload (fields this page uses)
type CaseloadStudent = {
  student_id: number;
  display_name: string;
  program_name: string | null;
  credits_earned: number;
  open_flags: number;
  risk_level: string | null;
  plan_status: string | null;
};

type CaseloadSummary = {
  total: number;
  needs_attention: number;
  no_plan: number;
  in_review: number;
  approved: number;
};

export default function Dashboard() {
  // useSearchParams needs a Suspense boundary for the production build
  return (
    <Suspense fallback={<p>Checking session...</p>}>
      <DashboardRoute />
    </Suspense>
  );
}

function DashboardRoute() {
  const advisorParam = useSearchParams().get("advisorId");

  // No ?advisorId= -> Firebase-guarded dashboard
  if (advisorParam === null) {
    return <FirebaseDashboard />;
  }

  const advisorId = Number(advisorParam);
  if (!Number.isInteger(advisorId) || advisorId <= 0) {
    return (
      <main style={{ padding: "40px" }}>
        <h1>Welcome to TasselTrak!</h1>
        <p>Invalid advisor id.</p>
        <BackToLoginButton label="Back to login" />
      </main>
    );
  }

  return <AdvisorDashboard key={advisorId} advisorId={advisorId} />;
}

function FirebaseDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.replace("/login");
      } else {
        setUser(currentUser);
      }
      setChecking(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  if (checking || !user) {
    return <p>Checking session...</p>;
  }

  return (
    <main style={{ padding: "40px" }}>
      <h1>Welcome to TasselTrak!</h1>
      <p>Logged in as: {user.email}</p>

      <button onClick={handleLogout}
        style={{
          background: "#ffc900",
          color: "black",
          padding: "12px",
          marginTop: "20px",
          cursor: "pointer"
        }}>
        Log out
      </button>
    </main>
  );
}

// Advisor path: no Firebase session (no auth in the demo), caseload comes from the API
function AdvisorDashboard({ advisorId }: { advisorId: number }) {
  const [students, setStudents] = useState<CaseloadStudent[]>([]);
  const [summary, setSummary] = useState<CaseloadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCaseload() {
      try {
        const res = await fetch(`/api/caseload?advisorId=${advisorId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data?.students)) {
          throw new Error(data?.error ?? `Request failed (${res.status})`);
        }
        if (cancelled) return;
        setStudents(data.students);
        setSummary(data.summary ?? null);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError("Couldn't load the caseload.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCaseload();
    return () => {
      cancelled = true;
    };
  }, [advisorId]);

  return (
    <main style={{ padding: "40px" }}>
      <h1>Welcome to TasselTrak!</h1>
      <p>Viewing caseload for advisor #{advisorId}</p>

      {loading && <p>Loading caseload...</p>}
      {error && <p role="alert">{error}</p>}

      {!loading && !error && (
        <>
          {summary && (
            <p>
              {summary.total} students &middot; {summary.needs_attention} need attention &middot; {summary.no_plan} without a plan &middot; {summary.in_review} in review &middot; {summary.approved} approved
            </p>
          )}

          {students.length === 0 ? (
            <p>No students in this caseload.</p>
          ) : (
            <ul>
              {students.map((s) => (
                <li key={s.student_id}>
                  {s.display_name}
                  {s.program_name ? ` - ${s.program_name}` : ""}
                  {` - ${s.credits_earned} credits`}
                  {` - ${s.open_flags} open ${s.open_flags === 1 ? "flag" : "flags"}`}
                  {s.risk_level ? ` - ${s.risk_level} risk` : ""}
                  {` - plan: ${s.plan_status ? s.plan_status.replace("_", " ") : "none"}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <BackToLoginButton label="Switch advisor" />
    </main>
  );
}

function BackToLoginButton({ label }: { label: string }) {
  const router = useRouter();

  return (
    <button onClick={() => router.replace("/login")}
      style={{
        background: "#ffc900",
        color: "black",
        padding: "12px",
        marginTop: "20px",
        cursor: "pointer"
      }}>
      {label}
    </button>
  );
}
