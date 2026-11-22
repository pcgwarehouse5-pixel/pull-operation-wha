// วันลาในตารางผลัด: ใบลาที่อนุมัติแล้ว → ช่องไหนต้องขึ้นว่าลา (ทดสอบด้วย tests/shift-leave.test.mjs)
import { addDays, keyOf, type Cell, type ShiftDef } from "./shifts.ts";

export type LeavePeriod = "full" | "morning" | "afternoon";
export type LeaveSpan = { user_id: string; leave_type: string; start_date: string; end_date: string; period: LeavePeriod; status: string };
export type DayLeave = { type: string; period: LeavePeriod; cancelling: boolean };

// ตรงกับ attendance_rows_core: ขอยกเลิกแล้วแต่ยังไม่อนุมัติการยกเลิก = ยังนับเป็นวันลา
const COUNTED = new Set(["approved", "cancel_requested"]);

/** กระจายใบลาเป็นรายวัน เฉพาะวันที่แสดงอยู่ · key = keyOf(user_id, date) */
export function leaveDayMap(rows: LeaveSpan[], dates: string[]): Map<string, DayLeave> {
  const out = new Map<string, DayLeave>();
  if (!dates.length) return out;
  const first = dates[0];
  const last = dates[dates.length - 1];
  for (const r of rows) {
    if (!COUNTED.has(r.status)) continue;
    const end = r.end_date < last ? r.end_date : last;
    for (let d = r.start_date > first ? r.start_date : first; d <= end; d = addDays(d, 1)) {
      const k = keyOf(r.user_id, d);
      const cur = out.get(k);
      // ใบซ้อนวันเดียวกัน: เลือกแบบเดียวกับฐานข้อมูล (order by period)
      if (!cur || r.period < cur.period) out.set(k, { type: r.leave_type, period: r.period, cancelling: r.status === "cancel_requested" });
    }
  }
  return out;
}

/** วันที่มีใบลารออนุมัติ (ยังไม่นับเป็นวันลา ใช้เตือนในสรุปคนขาด) · key → รหัสประเภทลา */
export function pendingLeaveDays(rows: LeaveSpan[], dates: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!dates.length) return out;
  const first = dates[0];
  const last = dates[dates.length - 1];
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const end = r.end_date < last ? r.end_date : last;
    for (let d = r.start_date > first ? r.start_date : first; d <= end; d = addDays(d, 1)) out.set(keyOf(r.user_id, d), r.leave_type);
  }
  return out;
}

/**
 * ช่องนี้ขึ้นว่าลาไหม (ตรงกับ leave_day_count ที่ใช้นับวันลา):
 * มีกะทำงาน = ลา · OFF/วันหยุดกลางใบลา = ไม่นับ คง OFF ไว้ · ยังไม่มีกะ = ลา ยกเว้นวันนักขัตฤกษ์
 */
export function leaveOnDay(
  leaves: Map<string, DayLeave>, userId: string, date: string, cell: Cell | undefined, def: ShiftDef | undefined, isHoliday: boolean,
): DayLeave | null {
  const l = leaves.get(keyOf(userId, date));
  if (!l) return null;
  if (cell) return def?.working ? l : null;
  return isHoliday ? null : l;
}

const LEAVE_PERIOD_TOP: Record<LeavePeriod, string> = { full: "ลา", morning: "ลาเช้า", afternoon: "ลาบ่าย" };
export const LEAVE_PERIOD_TEXT: Record<LeavePeriod, string> = { full: "เต็มวัน", morning: "ครึ่งวันเช้า", afternoon: "ครึ่งวันบ่าย" };

/** จำนวนตัวอักษรที่กินความกว้างจริง (ไม่นับสระบน-ล่างและวรรณยุกต์) ใช้เลือกขนาดตัวหนังสือในช่อง */
export const visibleLength = (s: string) => s.replace(/[ัิ-ฺ็-๎]/g, "").length;

// ชื่อยาวแบ่ง 2 บรรทัดให้ตัวล่างใหญ่พอดีช่องกว้าง 44px: ลาพัก/ร้อน · ลาช่วย/คลอด · ลาดูแล/บุตร
const TWO_LINE: Record<string, { top: string; main: string; half: string }> = {
  vacation: { top: "ลาพัก", main: "ร้อน", half: "พักร้อน" },
  paternity: { top: "ลาช่วย", main: "คลอด", half: "คลอด" },
  child_care: { top: "ลาดูแล", main: "บุตร", half: "บุตร" },
};
const MAX_VISIBLE = 5;

/** ข้อความ 2 บรรทัดในช่องวันลา (ชื่อเต็มแสดงเมื่อชี้ที่ช่อง) */
export function leaveCellText(type: string, label: string | undefined, period: LeavePeriod): { top: string; main: string } {
  const known = TWO_LINE[type];
  if (known) return period === "full" ? { top: known.top, main: known.main } : { top: LEAVE_PERIOD_TOP[period], main: known.half };
  const name = (label || type).replace(/^ลา/, "").trim();
  return { top: LEAVE_PERIOD_TOP[period], main: visibleLength(name) <= MAX_VISIBLE ? name : `${name.slice(0, MAX_VISIBLE - 1)}…` };
}
