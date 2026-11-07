"use client";

// คลัง/วันที่/กะ ที่เลือกในหน้า Pull (จำไว้ระหว่างเปลี่ยนหน้าในแท็บเดียวกัน)
import { useEffect, useState } from "react";
import { todayIso } from "@/lib/shifts";
import type { PullShift } from "@/lib/pull";
import type { Warehouse } from "@/lib/types";

const KEY = "wha-pull-selection";
type Sel = { wh: string; date: string; shift: PullShift };

export function usePullSelection(warehouses: Warehouse[], preferredWh: string | null) {
  const [sel, setSel] = useState<Sel>({ wh: "", date: todayIso(), shift: "morning" });

  useEffect(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Partial<Sel> | null;
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.date ?? "") && (v.shift === "morning" || v.shift === "night")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านค่าที่จำไว้หลังเปิดหน้า (ไม่มีบนเซิร์ฟเวอร์)
        setSel({ wh: v.wh ?? "", date: v.date!, shift: v.shift });
      }
    } catch {
      // เปิดแบบส่วนตัว/ปิดที่เก็บข้อมูล: ใช้ค่าตั้งต้น
    }
  }, []);

  const update = (patch: Partial<Sel>) =>
    setSel((s) => {
      const next = { ...s, ...patch };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ไม่จำก็ใช้งานได้
      }
      return next;
    });

  const wh = warehouses.some((w) => w.id === sel.wh) ? sel.wh : ((warehouses.find((w) => w.id === preferredWh) ?? warehouses[0])?.id ?? "");
  return {
    wh,
    date: sel.date,
    shift: sel.shift,
    setWh: (v: string) => update({ wh: v }),
    setDate: (v: string) => v && update({ date: v }),
    setShift: (v: PullShift) => update({ shift: v }),
  };
}
