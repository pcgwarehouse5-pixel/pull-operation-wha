"use client";

// โหลดข้อมูลกระดานดึงคนของคลัง/วัน/กะ: ความต้องการต่อทักษะ + คลังกลาง + การจองเข้าคลังนี้
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { errText } from "@/lib/supabase";
import { todayIso } from "@/lib/shifts";
import { loadBookings, loadPool, loadRequirements, volumesFor } from "@/lib/pull-data";
import { requirementRows, skillRequirements, type Booking, type PoolPerson, type PullShift, type SkillReq } from "@/lib/pull";

export type BoardData = { reqs: SkillReq[]; pool: PoolPerson[]; bookings: Booking[] };

export function usePullBoard(wh: string, date: string, shift: PullShift) {
  const { demo } = useApp();
  const [data, setData] = useState<BoardData | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!wh) return;
    let live = true;
    (async () => {
      try {
        let d: BoardData;
        if (demo) {
          const cfg = demo.previewPullConfig();
          const reqs = skillRequirements(cfg, wh, requirementRows(cfg, wh, date, shift, volumesFor(demo.previewPullWorkloads(todayIso()), date, shift)));
          d = { reqs, pool: demo.previewPullPool(wh, shift), bookings: demo.previewPullBookings(wh, date, shift) };
        } else {
          const [reqs, pool, bookings] = await Promise.all([loadRequirements(wh, date, shift), loadPool(wh, date, shift), loadBookings(wh, date, shift)]);
          d = { reqs, pool, bookings };
        }
        if (live) {
          setData(d);
          setErr("");
          setAt(new Date());
        }
      } catch (e) {
        if (live) setErr(errText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, wh, date, shift, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, setData, err, reload, at };
}
