// ชนิดข้อมูลและป้ายแสดงผลของโมดูลลงเวลา/ลา (สถานะคำนวณในฐานข้อมูล: attendance_rows_core)

export type AttendanceStatus =
  | "ok" | "late" | "early" | "late_early" | "working" | "no_out" | "no_in" | "absent" | "waiting" | "upcoming"
  | "leave" | "leave_half" | "off" | "off_worked" | "no_shift" | "no_shift_worked";

export type AttendanceRow = {
  user_id: string;
  work_date: string;
  shift_code: string | null;
  shift_start: string | null;
  shift_end: string | null;
  first_in: string | null;
  last_out: string | null;
  punch_count: number;
  leave_type: string | null;
  leave_period: string | null;
  status: AttendanceStatus;
  late_min: number;
  early_min: number;
  pending_correction: boolean;
};

export type TeamAttendanceRow = AttendanceRow & {
  employee_code: string;
  first_name_th: string;
  last_name_th: string | null;
  nickname: string | null;
  position: string | null;
};

type Tone = "slate" | "blue" | "green" | "amber" | "red";

export const STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  ok: { label: "ปกติ", tone: "green" },
  late: { label: "สาย", tone: "amber" },
  early: { label: "ออกก่อน", tone: "amber" },
  late_early: { label: "สาย+ออกก่อน", tone: "amber" },
  working: { label: "กำลังทำงาน", tone: "blue" },
  no_out: { label: "ลืมออก", tone: "red" },
  no_in: { label: "ลืมเข้า", tone: "red" },
  absent: { label: "ขาด", tone: "red" },
  waiting: { label: "ยังไม่เข้า", tone: "amber" },
  upcoming: { label: "ยังไม่ถึงกะ", tone: "slate" },
  leave: { label: "ลา", tone: "blue" },
  leave_half: { label: "ลาครึ่งวัน", tone: "blue" },
  off: { label: "วันหยุด", tone: "slate" },
  off_worked: { label: "ทำงานวันหยุด", tone: "blue" },
  no_shift: { label: "ไม่มีกะ", tone: "slate" },
  no_shift_worked: { label: "มาทำงาน (ไม่มีกะ)", tone: "blue" },
};

/** สถานะที่ต้องตามต่อ (ใช้กรองในหน้าติดตาม) */
export const PROBLEM: AttendanceStatus[] = ["late", "early", "late_early", "no_out", "no_in", "absent", "waiting"];

export const PERIOD_LABEL: Record<string, string> = { full: "เต็มวัน", morning: "ครึ่งวันเช้า", afternoon: "ครึ่งวันบ่าย" };

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled" | "cancel_requested";

export const LEAVE_STATUS: Record<LeaveStatus, { label: string; tone: Tone }> = {
  pending: { label: "รออนุมัติ", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  rejected: { label: "ไม่อนุมัติ", tone: "red" },
  cancelled: { label: "ยกเลิกแล้ว", tone: "slate" },
  cancel_requested: { label: "ขอยกเลิก", tone: "amber" },
};

export type LeaveRequest = {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  period: "full" | "morning" | "afternoon";
  days: number;
  reason: string | null;
  attachment_path: string | null;
  status: LeaveStatus;
  steps_required: number;
  steps_done: number;
  over_quota: boolean;
  created_by: string | null;
  created_at: string;
};

export type LeaveApproval = {
  id: string;
  request_id: string;
  step: number;
  action: "approve" | "reject" | "cancel_request" | "cancel_approve" | "cancel_reject";
  actor_name: string | null;
  actor_role: string | null;
  note: string | null;
  created_at: string;
};

export const APPROVAL_ACTION: Record<LeaveApproval["action"], string> = {
  approve: "อนุมัติ",
  reject: "ไม่อนุมัติ",
  cancel_request: "ขอยกเลิก",
  cancel_approve: "อนุมัติการยกเลิก",
  cancel_reject: "ไม่อนุมัติการยกเลิก",
};

export type LeaveBalance = { leave_type: string; label: string; quota: number | null; approved: number; pending: number; remaining: number | null };

export type Correction = {
  id: string;
  user_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision_note: string | null;
  created_at: string;
};

export const CORRECTION_STATUS: Record<Correction["status"], { label: string; tone: Tone }> = {
  pending: { label: "รออนุมัติ", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  rejected: { label: "ไม่อนุมัติ", tone: "red" },
  cancelled: { label: "ยกเลิก", tone: "slate" },
};

/** ระยะห่าง (เมตร) ระหว่างพิกัด 2 จุด — ใช้แสดงผลก่อนกด (ฐานข้อมูลตรวจซ้ำเสมอ) */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** "08:05" จาก time ของฐานข้อมูล ("08:05:00") */
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "-");

/** ข้อความสั้นของช่วงวันลา */
export function leaveRange(r: Pick<LeaveRequest, "start_date" | "end_date" | "period">, fmt: (d: string) => string): string {
  if (r.start_date === r.end_date) return `${fmt(r.start_date)}${r.period !== "full" ? ` (${PERIOD_LABEL[r.period]})` : ""}`;
  return `${fmt(r.start_date)} – ${fmt(r.end_date)}`;
}
