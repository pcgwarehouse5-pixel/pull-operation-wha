"use client";

import { useEffect } from "react";
import { clearAuthStorage } from "@/components/AuthProvider";
import { Loading } from "@/components/ui";
import { sb } from "@/lib/supabase";

export default function LogoutPage() {
  useEffect(() => {
    (async () => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await Promise.race([sb().auth.signOut().catch(() => null), wait(3000)]);
      clearAuthStorage();
      window.location.replace("/login");
    })();
  }, []);
  return <Loading text="กำลังออกจากระบบ..." />;
}
