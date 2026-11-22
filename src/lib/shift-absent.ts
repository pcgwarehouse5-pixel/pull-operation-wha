// สรุปคนขาดงานในตารางผลัด: ใครขาดวันไหน (ทดสอบด้วย tests/shift-absent.test.mjs)
import { fmtMinutes, keyOf, type Cell, type Grid, type ShiftDef } from "./shifts.ts";

export type AbsentDay = {
  date: string;
  start: string | null; // เวลาที่ต้องเข้างาน
  pendingLeave: string | null; // มีใบลารออนุมัติในวันนี้ (รหัสประเภทลา)
  pendingFix: boolean; // มีคำขอแก้เวลารออนุมัติในวันนี้
};
export type AbsentPerson<E> = { emp: E; days: AbsentDay[] };

/**
 * นับตรงกับช่องสีดำในตาราง: มีกะ · ระบบบอกว่าขาด · ไม่ได้ลาที่อนุมัติแล้ว · ช่องนั้นยังไม่ถูกแก้ค้างบันทึก
 * เรียงคนที่ขาดมากสุดก่อน แล้วตามรหัสพนักงาน · วันที่เรียงจากเก่าไปใหม่
 */
export function absentSummary<E extends { id: string; employee_code: string }>(o: {
  emps: E[];
  dates: string[];
  absent: Set<string>;
  grid: Grid;
  pending: Record<string, Cell | null>;
  defs: Map<string, ShiftDef>;
  isOnLeave: (id: string, date: string) => boolean;
  pendingLeaves: Map<string, string>;
  pendingFixes: Set<string>;
}): AbsentPerson<E>[] {
  const out: AbsentPerson<E>[] = [];
  for (const emp of o.emps) {
    const days: AbsentDay[] = [];
    for (const date of o.dates) {
      const k = keyOf(emp.id, date);
      const cell = o.grid[emp.id]?.[date];
      if (!o.absent.has(k) || !cell || k in o.pending || o.isOnLeave(emp.id, date)) continue;
      const start = o.defs.get(cell.shift_code)?.start ?? null;
      days.push({
        date,
        start: start === null ? null : fmtMinutes(start),
        pendingLeave: o.pendingLeaves.get(k) ?? null,
        pendingFix: o.pendingFixes.has(k),
      });
    }
    if (days.length) out.push({ emp, days });
  }
  return out.sort((a, b) => b.days.length - a.days.length || a.emp.employee_code.localeCompare(b.emp.employee_code));
}
