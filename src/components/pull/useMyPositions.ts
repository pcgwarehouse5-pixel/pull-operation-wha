"use client";

// โหลดตำแหน่งงานที่หัวหน้าจัดให้ฉัน (เมื่อวาน ถึง วันนี้ + days) พร้อมเวลากะของแต่ละวัน
// ใช้ร่วมกัน: หน้า "ตำแหน่งงานวันนี้" / การ์ดบนหน้าหลัก / การ์ดในตารางกะของฉัน
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { sb } from "@/lib/supabase";
import { addDays, todayIso } from "@/lib/shifts";
import type { AttendanceRow } from "@/lib/attendance";
import type { MyPos, ShiftTime } from "@/lib/my-position";

type Raw = { id: string; work_date: string; shift: "morning" | "night"; skill_name: string; to_warehouse_id: string; break_time: string | null };

export function useMyPositions(days = 7) {
  const { profile: me, demo, warehouses } = useApp();
  const [rows, setRows] = useState<MyPos[] | null>(null);
  const [shifts, setShifts] = useState<Record<string, ShiftTime>>({});
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    const today = todayIso();
    const from = addDays(today, -1);
    const to = addDays(today, days);
    const toShifts = (list: AttendanceRow[]) =>
      Object.fromEntries(list.map((a) => [a.work_date, { code: a.shift_code, start: a.shift_start, end: a.shift_end }]));
    (async () => {
      if (demo) {
        if (!live) return;
        setRows(demo.previewMyPullBookings(today));
        setShifts(toShifts(demo.previewAttendance([from, today, addDays(today, 1), addDays(today, 3)], me.id, today) as AttendanceRow[]));
        return;
      }
      const [b, a] = await Promise.all([
        sb()
          .from("pull_bookings")
          .select("id, work_date, shift, skill_name, to_warehouse_id, break_time")
          .eq("user_id", me.id)
          .eq("status", "booked")
          .gte("work_date", from)
          .lte("work_date", to)
          .order("work_date"),
        sb().rpc("my_attendance", { p_from: from, p_to: to }),
      ]);
      if (!live) return;
      if (b.error) {
        setErr(b.error.message);
        setRows([]);
        return;
      }
      setErr("");
      setRows(
        ((b.data ?? []) as Raw[]).map((r) => {
          const w = warehouses.find((x) => x.id === r.to_warehouse_id);
          return {
            id: r.id, work_date: r.work_date, shift: r.shift, skill_name: r.skill_name, break_time: r.break_time,
            to_code: w?.code ?? "-", to_name: w?.name ?? "", away: r.to_warehouse_id !== me.warehouse_id,
          };
        }),
      );
      setShifts(toShifts((a.data ?? []) as AttendanceRow[]));
    })();
    return () => {
      live = false;
    };
  }, [demo, me.id, me.warehouse_id, warehouses, days, tick]);

  return { rows, shifts, err, reload };
}
