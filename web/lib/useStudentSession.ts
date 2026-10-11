"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { get, getDatabase, ref } from "firebase/database";
import { auth } from "./firebase";

export function useStudentSession() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;

      setUser(currentUser);

      if (!currentUser) {
        setName("");
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const db = getDatabase(
          auth.app,
          "https://tasseltrak-69d99-default-rtdb.firebaseio.com"
        );

        const snapshot = await get(
          ref(db, `users/${currentUser.uid}`)
        );

        const profile = snapshot.val();

        const accountName =
          profile?.name ??
          profile?.displayName ??
          currentUser.displayName ??
          currentUser.email?.split("@")[0] ??
          "Student";

        if (active) setName(accountName);
      } catch {
        if (active) {
          setName(
            currentUser.displayName ??
            currentUser.email?.split("@")[0] ??
            "Student"
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { user, name, loading };
}