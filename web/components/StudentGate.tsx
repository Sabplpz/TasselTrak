"use client";

import { useStudentSession } from "@/lib/useStudentSession";
import type { Student } from "@/lib/studentApi";
import { Notice } from "@/components/AdvisorGate";
import { TopBar } from "@/components/TopBar";

export type StudentAccount = { student: Student; name: string; next: "upload" | "board" };

// Renders a student-only page once useStudentSession has matched the account to a student row,
// and the "checking", "not linked" and "error" screens until then.
export function StudentGate({
  children,
}: {
  children: (account: StudentAccount, signOut: () => void) => React.ReactNode;
}) {
  const { user, name, link, signOut } = useStudentSession();

  if (link.status === "checking") {
    return (
      <main className="flex min-h-dvh flex-col bg-surface-canvas text-ink-primary">
        <TopBar surface />
        <p className="p-6 text-body-14 text-ink-secondary">Checking session…</p>
      </main>
    );
  }

  if (link.status === "unlinked") {
    return (
      <Notice title="No student record is linked to this account" onSignOut={signOut}>
        {user?.email ? `${user.email} is not matched to a student yet.` : "This account is not matched to a student yet."}{" "}
        Ask an administrator to add your UCF email to your student record.
      </Notice>
    );
  }

  if (link.status === "error") {
    return (
      <Notice title="We could not load your student record" onSignOut={signOut}>
        Check your connection and reload the page. If it keeps happening, sign out and sign in again.
      </Notice>
    );
  }

  return <>{children({ student: link.student, name: name || link.student.name, next: link.next }, signOut)}</>;
}
