"use client";

// กระดิ่งแจ้งเตือนบนแถบหัว: ตัวเลขยังไม่อ่าน (ดึงใหม่ทุก 60 วินาที และตอนกลับมาที่หน้าจอ)
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./AuthProvider";
import { Icon } from "./Icon";
import { sb } from "@/lib/supabase";

export function NotificationBell() {
  const { profile, demo } = useApp();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setN(demo.PREVIEW_NOTIFICATIONS.filter((x) => !x.read_at).length);
      return;
    }
    let live = true;
    const load = () =>
      sb()
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .is("read_at", null)
        .then(({ count }) => live && setN(count ?? 0));
    load();
    const t = setInterval(load, 60000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("wha-notifications-read", load);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("wha-notifications-read", load);
    };
  }, [demo, profile.id]);

  return (
    <Link
      href="/notifications"
      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/90 hover:bg-white/10 lg:text-brand lg:hover:bg-brand/5"
      aria-label={n ? `แจ้งเตือน ยังไม่อ่าน ${n} รายการ` : "แจ้งเตือน"}
    >
      <Icon name="bell" />
      {n > 0 && (
        <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-bad px-1 text-[11px] font-bold text-white ring-2 ring-brand lg:ring-paper">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
