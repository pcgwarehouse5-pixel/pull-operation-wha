"use client";

// การ์ด "ไปช่วยงานคลังอื่น" ในหน้าตารางกะของฉัน: วันที่หัวหน้าจองให้พนักงานไปทำงาน (ไทย/พม่า)
import { useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/i18n";
import { sb } from "@/lib/supabase";
import { todayIso } from "@/lib/shifts";
import { SkillIcon } from "@/components/pull/PullUI";

type Mine = { id: string; work_date: string; shift: "morning" | "night"; skill_name: string; to_code: string };

export function MyPullBookings() {
  const { profile: me, demo, warehouses } = useApp();
  const { t, fmt } = useI18n();
  const [rows, setRows] = useState<Mine[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const today = todayIso();
      if (demo) {
        if (live) setRows(demo.previewMyPullBookings(today));
        return;
      }
      const { data } = await sb()
        .from("pull_bookings")
        .select("id, work_date, shift, skill_name, to_warehouse_id")
        .eq("user_id", me.id)
        .eq("status", "booked")
        .gte("work_date", today)
        .order("work_date")
        .limit(20);
      if (live)
        setRows(
          ((data ?? []) as { id: string; work_date: string; shift: "morning" | "night"; skill_name: string; to_warehouse_id: string }[]).map((b) => ({
            ...b,
            to_code: warehouses.find((w) => w.id === b.to_warehouse_id)?.code ?? "-",
          })),
        );
    })();
    return () => {
      live = false;
    };
  }, [demo, me.id, warehouses]);

  if (!rows.length) return null;
  return (
    <Card className="mb-4 bg-sky">
      <h2 className="flex items-center gap-2 text-lg font-bold text-brand">
        <Icon name="warehouse" size={24} /> {t("pull.my.title")}
      </h2>
      <p className="text-[14px] text-muted">{t("pull.my.hint")}</p>
      <ul className="mt-3 space-y-2">
        {rows.map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line">
            <SkillIcon name={b.skill_name} size={42} />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{fmt.day(b.work_date)} · {t(b.shift === "morning" ? "pull.my.morning" : "pull.my.night")}</span>
              <span className="block truncate text-[14px] text-muted">{b.skill_name}</span>
            </span>
            <span className="shrink-0 rounded-xl bg-brand px-3 py-1.5 text-lg font-bold text-white">{b.to_code}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
