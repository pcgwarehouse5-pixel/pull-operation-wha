"use client";

// รหัสกะทั้งหมด (จากหน้าตั้งค่า) + ข้อความที่พนักงานอ่านง่าย: กะทำงาน = เวลา, วันหยุด = ชื่อ (OFF) ไม่แสดงรหัสกะ
import { useMemo } from "react";
import { useOptions } from "./useOptions";
import { shiftDef, shiftTimeText, type ShiftDef } from "./shifts";

export function useShiftDefs(): Map<string, ShiftDef> {
  const opts = useOptions(["shift_type"]);
  return useMemo(() => new Map((opts.shift_type ?? []).map((o) => [o.value, shiftDef(o)])), [opts.shift_type]);
}

/** "08:00-17:00" หรือ "OFF" (ไม่ใช่รหัสกะ) */
export function shiftText(code: string | null | undefined, defs: Map<string, ShiftDef>): string {
  if (!code) return "";
  const d = defs.get(code);
  return shiftTimeText(d) || d?.label || code;
}
