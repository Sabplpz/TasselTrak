"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Old landing page. Students now land on their board, which sends advisors on to /advisor and
// signed-out visitors to /login.
export default function Dashboard() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/board");
  }, [router]);
  return <p className="p-6 text-body-14 text-ink-secondary">Checking session…</p>;
}
