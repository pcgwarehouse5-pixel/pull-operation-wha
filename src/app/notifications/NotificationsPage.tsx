"use client";

// รายการแจ้งเตือนของฉัน (เปิดหน้านี้ = อ่านแล้วทั้งหมด)
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Empty, Loading } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { errText, sb } from "@/lib/supabase";
import { thaiDateTime } from "@/lib/format";

type Note = { id: number; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

const ICON: Record<string, IconName> = {
  leave_pending: "leave", leave_result: "leave", correction_pending: "clock", correction_result: "clock",
  schedule: "calendar", missing_in: "pin", missing_out: "pin", auto_check_in: "pin", absent_streak: "users", ot_pending: "ot",
};

export default function NotificationsPage() {
  const { profile: me, demo } = useApp();
  const [rows, setRows] = useState<Note[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (demo) return setRows(demo.PREVIEW_NOTIFICATIONS);
    const { data, error } = await sb().from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(100);
    if (error) setErr(errText(error));
    setRows((data ?? []) as Note[]);
    if ((data ?? []).some((n) => !n.read_at)) {
      await sb().rpc("mark_notifications_read", { p_ids: null });
      window.dispatchEvent(new Event("wha-notifications-read"));
    }
  }, [demo, me.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า
    load();
  }, [load]);

  return (
    <AppShell title="แจ้งเตือน">
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ยังไม่มีแจ้งเตือน</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => {
            const body = (
              <div className={`flex gap-3 rounded-2xl bg-white p-3.5 ring-1 ${n.read_at ? "ring-line" : "ring-brand/40"}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${n.read_at ? "bg-paper text-muted" : "bg-[#eaf0fb] text-brand"}`}>
                  <Icon name={ICON[n.kind] ?? "bell"} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`leading-snug ${n.read_at ? "" : "font-bold"}`}>{n.title}</p>
                  {n.body && <p className="text-[14px] text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-[12px] text-muted">{thaiDateTime(n.created_at)}</p>
                </div>
                {!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-bad" aria-label="ยังไม่อ่าน" />}
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
      <p className="mt-4 px-1 text-[13px] text-muted">แสดง 100 รายการล่าสุด</p>
    </AppShell>
  );
}
