
"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";

export default function Dashboard() {
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
