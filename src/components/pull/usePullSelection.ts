"use client";

// คลัง/วันที่/กะ ที่เลือกในหน้า Pull
//   เปิดหน้าแล้วเลือก "รอบถัดไป" ให้อัตโนมัติตามเวลาประชุมเริ่มงาน (หัวหน้าคลังจองคนก่อนประชุมประมาณ 1 ชั่วโมง)
//     ก่อนประชุมเช้า → กะเช้าวันนี้ · ตั้งแต่ประชุมเช้า → กะดึกวันนี้ · ตั้งแต่ประชุมดึก → กะเช้าพรุ่งนี้
//   ที่เลือกเองจำไว้ระหว่างเปลี่ยนหน้าในแท็บเดียวกัน แต่พอถึงรอบใหม่ (เลยเวลาประชุม) กลับไปเลือกรอบถัดไปให้ใหม่ ไม่ค้างวันเก่า
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { todayIso } from "@/lib/shifts";
import { DEFAULT_MEETINGS, bangkokNowMin, nextRound, shiftWithMeeting, type Meetings, type PullShift } from "@/lib/pull";
import { loadMeetings } from "@/lib/pull-data";
import type { Warehouse } from "@/lib/types";

const KEY = "wha-pull-selection";
type Sel = { wh: string; date: string; shift: PullShift };
type Saved = Sel & { round?: string };

const autoRound = (m: Meetings) => nextRound(todayIso(), bangkokNowMin(), m);
const roundKey = (m: Meetings) => {
  const r = autoRound(m);
  return `${r.date}|${r.shift}`;
};

export function usePullSelection(warehouses: Warehouse[], preferredWh: string | null) {
  const { demo } = useApp();
  const [meetings, setMeetings] = useState<Meetings>(DEFAULT_MEETINGS);
  const [sel, setSel] = useState<Sel>(() => ({ wh: "", ...autoRound(DEFAULT_MEETINGS) }));
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      let m = DEFAULT_MEETINGS;
      if (!demo) {
        try {
          m = await loadMeetings(todayIso());
        } catch {
          // โหลดเวลาประชุมไม่ได้: ใช้ค่าเริ่มต้น
        }
      }
      if (!live) return;
      setMeetings(m);
      let saved: Saved | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Saved | null;
      } catch {
        // เปิดแบบส่วนตัว/ปิดที่เก็บข้อมูล: ใช้รอบถัดไป
      }
      const ok = saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.date ?? "") && (saved.shift === "morning" || saved.shift === "night");
      if (ok && saved!.round === roundKey(m)) {
        touched.current = true;
        setSel({ wh: saved!.wh ?? "", date: saved!.date, shift: saved!.shift });
      } else if (!touched.current) {
        setSel((s) => ({ ...s, ...autoRound(m) }));
      }
    })();
    return () => {
      live = false;
    };
  }, [demo]);

  const update = (patch: Partial<Sel>) => {
    touched.current = true;
    setSel((s) => {
      const next = { ...s, ...patch };
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ ...next, round: roundKey(meetings) } satisfies Saved));
      } catch {
        // ไม่จำก็ใช้งานได้
      }
      return next;
    });
  };

  const wh = warehouses.some((w) => w.id === sel.wh) ? sel.wh : ((warehouses.find((w) => w.id === preferredWh) ?? warehouses[0])?.id ?? "");
  return {
    wh,
    date: sel.date,
    shift: sel.shift,
    meetings,
    /** "กะเช้า · ประชุม 08:00 น." */
    shiftLabel: (s: PullShift) => shiftWithMeeting(s, meetings),
    setWh: (v: string) => update({ wh: v }),
    setDate: (v: string) => v && update({ date: v }),
    setShift: (v: PullShift) => update({ shift: v }),
  };
}
