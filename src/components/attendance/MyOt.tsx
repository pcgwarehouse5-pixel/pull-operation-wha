"use client";

// OT ของฉันในเดือนที่เลือก (คำนวณจากเวลาจริง แสดงสถานะการอนุมัติ)
import { useEffect, useState } from "react";
import { useApp } from "../AuthProvider";
import { Badge, Card } from "../ui";
import { sb } from "@/lib/supabase";
import { shortDay } from "@/lib/format";
import { monthDates, todayIso } from "@/lib/shifts";
import { APPROVAL, fmtHours, otBuckets, rateLabel, type OtRow } from "@/lib/ot";

export function MyOt({ ym }: { ym: string }) {
  const { profile: me, demo } = useApp();
  const [rows, setRows] = useState<OtRow[] | null>(null);

  useEffect(() => {
    const dates = monthDates(ym);
    const to = dates.at(-1)! < todayIso() ? dates.at(-1)! : todayIso();
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setRows(demo.previewOt(dates[0]).filter((r) => r.user_id === "p1") as OtRow[]);
      return;
    }
    if (dates[0] > to) return setRows([]);
    let live = true;
    sb()
      .rpc("my_ot", { p_from: dates[0], p_to: to })
      .then(({ data }) => live && setRows((data ?? []) as OtRow[]));
    return () => {
      live = false;
    };
  }, [ym, demo, me.id]);

  if (!rows || !rows.length) return null;
  const approved = otBuckets(rows.filter((r) => r.approval === "approved"));
  return (
    <Card className="mt-4 !p-3.5">
      <p className="mb-1 font-bold text-brand">OT ของฉันเดือนนี้</p>
      <p className="mb-2 text-[14px] text-muted">
        อนุมัติแล้ว: {approved.size ? [...approved].map(([r, h]) => `${rateLabel(r)} ${fmtHours(h)} ชม.`).join(" · ") : "ยังไม่มี"}
      </p>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.work_date} className="flex items-center gap-2 py-2 text-[14px]">
            <span className="w-24 shrink-0 font-semibold">{shortDay(r.work_date)}</span>
            <span className="min-w-0 flex-1">
              {Number(r.normal_hours) > 0 && `${rateLabel(Number(r.normal_rate))} ${fmtHours(Number(r.normal_hours))} ชม. `}
              {Number(r.ot_hours) > 0 && `${rateLabel(Number(r.ot_rate))} ${fmtHours(Number(r.ot_hours))} ชม.`}
            </span>
            <Badge tone={APPROVAL[r.approval].tone}>{r.approval === "changed" ? "รออนุมัติ" : APPROVAL[r.approval].label}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
