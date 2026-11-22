"use client";

// กระดิ่งแจ้งเตือนบนแถบหัว: ตัวเลขยังไม่อ่าน (ดึงใหม่ทุก 60 วินาทีเมื่อเปิดจออยู่ และตอนกลับมาที่หน้าจอ)
// เปลี่ยนหน้าในแอปใช้ตัวเลขที่จำไว้ ถ้าเพิ่งดึงไม่เกิน 30 วินาทีจะไม่ดึงซ้ำ
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./AuthProvider";
import { Icon } from "./Icon";
import { sb } from "@/lib/supabase";
import { useI18n } from "@/i18n";

const FRESH_MS = 30000;
const memo: { user: string; n: number; at: number } = { user: "", n: 0, at: 0 };

export function NotificationBell() {
  const { profile, demo } = useApp();
  const [n, setN] = useState(() => (!demo && memo.user === profile.id ? memo.n : 0));
  const { t } = useI18n();

  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setN(demo.PREVIEW_NOTIFICATIONS.filter((x) => !x.read_at).length);
      return;
    }
    let live = true;
    const fetchCount = () =>
      sb()
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .is("read_at", null)
        .then(({ count, error }) => {
          if (error) return;
          memo.user = profile.id;
          memo.n = count ?? 0;
          memo.at = Date.now();
          if (live) setN(memo.n);
        });
    const load = () => {
      if (document.visibilityState !== "visible") return; // ปิดจอ/สลับแอปอยู่ ไม่ต้องดึง
      if (memo.user === profile.id && Date.now() - memo.at < FRESH_MS) return;
      fetchCount();
    };
    load();
    const t = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("wha-notifications-read", fetchCount);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("wha-notifications-read", fetchCount);
    };
  }, [demo, profile.id]);

  return (
    <Link
      href="/notifications"
      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/90 hover:bg-white/10 lg:text-brand lg:hover:bg-brand/5"
      aria-label={n ? t("common.unread", { n }) : t("common.notifications")}
    >
      <Icon name="bell" />
      {n > 0 && (
        <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ring-2 ring-brand lg:ring-paper bg-piping">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
