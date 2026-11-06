// ชนิดข้อมูลและตัวช่วยของ OT (ชั่วโมงคำนวณในฐานข้อมูล: ot_rows_core) ทดสอบได้ด้วย tests/ot-lib.test.mjs

export type OtRow = {
  user_id: string;
  work_date: string;
  day_type: "normal" | "OFF" | "HOL";
  shift_code: string | null;
  first_in: string;
  last_out: string;
  normal_hours: number;
  normal_rate: number | null;
  ot_hours: number;
  ot_rate: number | null;
  approval: "pending" | "changed" | "approved" | "rejected";
  decided_by_name: string | null;
  decided_at: string | null;
  note: string | null;
};

export type TeamOtRow = OtRow & {
  employee_code: string;
  first_name_th: string;
  last_name_th: string | null;
  nickname: string | null;
  position: string | null;
  salary_code: string | null;
  employment_type: string | null;
};

type Tone = "slate" | "blue" | "green" | "amber" | "red";
export const APPROVAL: Record<OtRow["approval"], { label: string; tone: Tone }> = {
  pending: { label: "รออนุมัติ", tone: "amber" },
  changed: { label: "เวลาเปลี่ยน รออนุมัติใหม่", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  rejected: { label: "ไม่อนุมัติ", tone: "red" },
};

export const DAY_TYPE: Record<OtRow["day_type"], string> = { normal: "วันทำงาน", OFF: "วันหยุดประจำสัปดาห์", HOL: "วันนักขัตฤกษ์" };

/** ป้ายอัตรา เช่น 1.5 → "OT 1.5" */
export const rateLabel = (r: number) => `OT ${Number(r).toString()}`;

/** รวมชั่วโมงแยกตามอัตรา (ชั่วโมงปกติวันหยุดใช้ normal_rate, ส่วนเกินใช้ ot_rate) */
export function otBuckets(rows: Pick<OtRow, "normal_hours" | "normal_rate" | "ot_hours" | "ot_rate">[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rows) {
    if (Number(r.normal_hours) > 0 && r.normal_rate !== null) m.set(Number(r.normal_rate), (m.get(Number(r.normal_rate)) ?? 0) + Number(r.normal_hours));
    if (Number(r.ot_hours) > 0 && r.ot_rate !== null) m.set(Number(r.ot_rate), (m.get(Number(r.ot_rate)) ?? 0) + Number(r.ot_hours));
  }
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]));
}

/** อัตราทั้งหมดที่พบ (ใช้เป็นหัวคอลัมน์รายงาน) */
export function ratesOf(rows: Parameters<typeof otBuckets>[0]): number[] {
  return [...otBuckets(rows).keys()];
}

export const fmtHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));
