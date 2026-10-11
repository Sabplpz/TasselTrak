"use client";

import { useAdvisorSession, type Advisor } from "@/lib/useAdvisorSession";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/Button";

export function Notice({ title, children, onSignOut }: { title: string; children: React.ReactNode; onSignOut: () => void }) {
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

// Renders an advisor-only page once useAdvisorSession has a signed-in advisor, and the
// "checking", "not linked" and "error" screens until then.
export function AdvisorGate({
  children,
}: {
  children: (advisor: Advisor, signOut: () => void) => React.ReactNode;
}) {
  const { session, signOut } = useAdvisorSession();

  if (session.status === "checking") {
    return (
      <main className="flex min-h-dvh flex-col bg-surface-canvas text-ink-primary">
        <TopBar surface />
        <p className="p-6 text-body-14 text-ink-secondary">Checking session…</p>
      </main>
    );
  }

  if (session.status === "unlinked") {
    return (
      <Notice title="No advisor profile is linked to this account" onSignOut={signOut}>
        {session.email ? `${session.email} does not match any advisor.` : "This account has no email address."} Ask
        an administrator to add your UCF email to your advisor profile.
      </Notice>
    );
  }

  if (session.status === "error") {
    return (
      <Notice title="We could not load your advisor profile" onSignOut={signOut}>
        Check your connection and reload the page. If it keeps happening, sign out and sign in again.
      </Notice>
    );
  }

  return <>{children(session.advisor, signOut)}</>;
}
