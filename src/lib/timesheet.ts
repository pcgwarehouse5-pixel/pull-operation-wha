// ใบลงเวลา (พิมพ์ตามฟอร์มบริษัท): ฟอร์ม MOU (ครึ่งเดือน) และฟอร์มคนไทย (เต็มเดือน)
// แปลงข้อมูลลงเวลา (warehouse_attendance) + OT ที่อนุมัติแล้ว (warehouse_ot) เป็นแถวรายวันของแต่ละคน
// ทดสอบได้ด้วย tests/timesheet.test.mjs · ไฟล์นี้ห้าม import แบบ "@/" (เทสต์รันตรงด้วย node)
// เวลาเข้า-ออกในใบ "ตามตารางกะ" (28 พ.ย. 2569): เข้าก่อนกะ = เวลาเข้ากะ · ออก = เลิกกะ + ชั่วโมง OT ที่อนุมัติ (ดู ot-times.ts)
import { paidTimes, type BreakRule } from "./ot-times.ts";

export type TsAtt = {
  user_id: string;
  work_date: string;
  shift_code: string | null;
  shift_start: string | null;
  shift_end: string | null;
  first_in: string | null;
  last_out: string | null;
  leave_type: string | null;
  leave_period: string | null;
  status: string;
  /** นาทีที่มาสาย (หลังหักเวลาผ่อนผัน) */
  late_min?: number | null;
};

export type TsOt = {
  user_id: string;
  work_date: string;
  day_type: "normal" | "OFF" | "HOL";
  normal_hours: number;
  normal_rate: number | null;
  ot_hours: number;
  ot_rate: number | null;
  approval: string;
};

export type TsDay = {
  date: string;
  /** วันหยุดของคนนั้น (ตามตารางกะ) → ระบายเทา */
  off: boolean;
  /** วันที่ยังไม่ถึง → เว้นว่างทั้งแถว */
  future: boolean;
  inAt: string | null;
  outAt: string | null;
  /** ฟอร์มคนไทย: ช่วงเวลาทำงานปกติ */
  normalFrom: string | null;
  normalTo: string | null;
  /** ฟอร์มคนไทย: ช่วงเวลาที่ทำ OT (เฉพาะวันที่มี OT อนุมัติแล้ว) */
  otFrom: string | null;
  otTo: string | null;
  /** ฟอร์ม MOU: จำนวนแรงวันทำงาน (1 = มาทำงานวันทำงานปกติ, 0.5 = ลาครึ่งวัน) */
  workUnits: number | null;
  /** ชั่วโมงที่อนุมัติแล้ว แยกตามอัตรา (เท่า) */
  byRate: Map<number, number>;
  /** ชั่วโมงที่อนุมัติแล้ว แยกตามชนิด (ฟอร์มคนไทย) */
  workdayOt: number;
  holidayNormal: number;
  holidayOt: number;
  /** มี OT ที่ยังไม่อนุมัติ (ไม่ได้ใส่ในใบ) */
  otWaiting: boolean;
  remark: string;
};

export type FormTexts = { company: string; title: string; subject?: string; to?: string; notes: string[] };
export type WhTexts = { mou_dept: string; mou_ul: string; thai_dept: string; thai_ul: string };
export type TimesheetForm = { mou: FormTexts; thai: FormTexts; wh: Record<string, WhTexts> };

export const MOU_RATES = [1, 1.5, 2, 3] as const;
const TZ = "Asia/Bangkok";
const LEN = 200;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** วันที่ทั้งเดือน "YYYY-MM" */
export function monthDays(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => isoOf(y, m, i + 1));
}

/** รอบครึ่งเดือนตามปฏิทิน: 1 = วันที่ 1–15, 2 = วันที่ 16–สิ้นเดือน */
export function halfDays(ym: string, half: 1 | 2): string[] {
  return monthDays(ym).filter((d) => (half === 1 ? Number(d.slice(8)) <= 15 : Number(d.slice(8)) >= 16));
}

/** เวลา HH:MM ตามเวลาไทย */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const h = p.find((x) => x.type === "hour")?.value ?? "00";
  const mi = p.find((x) => x.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${mi}`;
}

/** 2026-11-16 → 16-11-2026 (ตามฟอร์ม MOU) */
export const dmy = (d: string) => `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** ประจำงวดวันที่ เช่น 16-30/11/2026 */
export function periodLabel(days: string[]): string {
  if (!days.length) return "";
  const a = days[0];
  const b = days[days.length - 1];
  return `${Number(a.slice(8))}-${Number(b.slice(8))}/${b.slice(5, 7)}/${b.slice(0, 4)}`;
}

/** แสดงชั่วโมง: 0 = ว่าง, 2 → "2", 2.5 → "2.5" */
export function hrs(h: number | null | undefined): string {
  if (!h) return "";
  return String(Math.round(h * 100) / 100);
}

const OFF_STATUS = new Set(["off", "off_worked"]);
const WORKED = (a: TsAtt | undefined) => !!a?.first_in;

/**
 * แถวรายวันของพนักงาน 1 คน
 * @param leaveLabel แปลงรหัสประเภทลาเป็นข้อความ เช่น sick → "ลาป่วย"
 */
export type BuildOpts = {
  /** หักพักเมื่อทำงานวันหยุด (ตามค่าตั้งค่า OT) */
  brk?: BreakRule;
  /** หมายเหตุ "สาย N นาที" (หน่วยงานที่เปิดแบบฟอร์มหน้าร้าน) */
  lateNote?: boolean;
};

export function buildDays(days: string[], att: TsAtt[], ot: TsOt[], today: string, leaveLabel: (code: string) => string, opts: BuildOpts = {}): TsDay[] {
  const brk = opts.brk ?? { minutes: 60, after: 480 };
  const A = new Map(att.map((a) => [a.work_date, a]));
  const O = new Map(ot.map((o) => [o.work_date, o]));
  return days.map((date) => {
    const a = A.get(date);
    const o = O.get(date);
    const off = !!a && (OFF_STATUS.has(a.status) || (!!a.shift_code && !a.shift_start)) || o?.day_type === "OFF" || o?.day_type === "HOL";
    const row: TsDay = {
      date, off, future: date > today, inAt: null, outAt: null, normalFrom: null, normalTo: null, otFrom: null, otTo: null,
      workUnits: null, byRate: new Map(), workdayOt: 0, holidayNormal: 0, holidayOt: 0, otWaiting: false, remark: "",
    };
    if (row.future) return row;

    const half = a?.status === "leave_half" || (!!a?.leave_type && !!a.leave_period && a.leave_period !== "full");

    // ชั่วโมง OT: นับเฉพาะที่อนุมัติแล้ว
    const approved = o?.approval === "approved";
    if (o && !approved && (Number(o.normal_hours) > 0 || Number(o.ot_hours) > 0)) row.otWaiting = true;
    if (o && approved) {
      const add = (rate: number | null, h: number) => {
        if (rate === null || !(h > 0)) return;
        row.byRate.set(Number(rate), (row.byRate.get(Number(rate)) ?? 0) + h);
      };
      add(o.normal_rate, Number(o.normal_hours));
      add(o.ot_rate, Number(o.ot_hours));
      if (o.day_type === "normal") row.workdayOt = Number(o.ot_hours) || 0;
      else {
        row.holidayNormal = Number(o.normal_hours) || 0;
        row.holidayOt = Number(o.ot_hours) || 0;
      }
    }
    const hasOt = row.workdayOt + row.holidayNormal + row.holidayOt > 0;

    // เวลาตามตารางกะ (ฟอร์ม MOU: เข้า/ออก · ฟอร์มคนไทย: ช่วงปกติ / ช่วง OT)
    const p = paidTimes(
      {
        off,
        firstIn: a?.first_in ?? null,
        lastOut: a?.last_out ?? null,
        shiftStart: a?.shift_start ?? null,
        shiftEnd: a?.shift_end ?? null,
        normalHours: approved ? Number(o!.normal_hours) || 0 : 0,
        otHours: approved ? Number(o!.ot_hours) || 0 : 0,
        counted: approved,
      },
      brk,
    );
    row.inAt = p.from;
    row.outAt = p.to;
    if (off) {
      // ทำงานวันหยุด = นอกเวลาทำงานปกติทั้งหมด
      if (hasOt && p.otFrom && p.otTo) {
        row.otFrom = p.otFrom;
        row.otTo = p.otTo;
      }
    } else if (row.inAt) {
      row.normalFrom = p.normalFrom;
      row.normalTo = p.normalTo;
      if (hasOt && p.otFrom && p.otTo) {
        row.otFrom = p.otFrom;
        row.otTo = p.otTo;
      }
    }

    // ฟอร์ม MOU: จำนวนแรงวันทำงาน (วันหยุดที่มาทำงานคิดในช่อง OT แทน)
    if (!off && WORKED(a)) row.workUnits = half ? 0.5 : 1;

    // หมายเหตุ
    const notes: string[] = [];
    if (a?.leave_type) {
      const p = a.leave_period === "morning" ? " (ครึ่งเช้า)" : a.leave_period === "afternoon" ? " (ครึ่งบ่าย)" : "";
      notes.push(`${leaveLabel(a.leave_type)}${p}`);
    }
    if (opts.lateNote && (a?.status === "late" || a?.status === "late_early") && Number(a.late_min) > 0) notes.push(`สาย ${Number(a.late_min)} นาที`);
    if (a?.status === "absent") notes.push("ขาดงาน");
    if (a?.status === "no_out") notes.push("ไม่มีเวลาออก");
    if (a?.status === "no_in") notes.push("ไม่มีเวลาเข้า");
    row.remark = notes.join(" · ");
    return row;
  });
}

/** รวมชั่วโมงทั้งใบ */
export function totals(rows: TsDay[]) {
  const byRate = new Map<number, number>();
  let units = 0;
  let workdayOt = 0;
  let holidayNormal = 0;
  let holidayOt = 0;
  for (const r of rows) {
    for (const [k, h] of r.byRate) byRate.set(k, (byRate.get(k) ?? 0) + h);
    units += r.workUnits ?? 0;
    workdayOt += r.workdayOt;
    holidayNormal += r.holidayNormal;
    holidayOt += r.holidayOt;
  }
  return { byRate, units, workdayOt, holidayNormal, holidayOt };
}

/** อัตราที่ไม่มีช่องในฟอร์ม MOU (1 / 1.5 / 2 / 3) → ต้องเตือน ไม่ให้ชั่วโมงหายเงียบๆ */
export function unmappedMouRates(rows: TsDay[]): number[] {
  const s = new Set<number>();
  for (const r of rows) for (const k of r.byRate.keys()) if (!(MOU_RATES as readonly number[]).includes(k)) s.add(k);
  return [...s].sort((a, b) => a - b);
}

/** ป้ายอัตราในหัวคอลัมน์ฟอร์มคนไทย เช่น 1.5 → "(1.5 เท่า)" */
export const rateText = (r: number | null | undefined) => (r === null || r === undefined ? "" : `(${Number(r)} เท่า)`);

/** อัตรา OT ของประเภทพนักงาน ตามค่าตั้งค่า ot.rates (ไม่มีค่าเฉพาะ = ค่าเริ่มต้น) */
export function ratesFor(setting: unknown, type: string | null) {
  const s = (setting ?? {}) as Record<string, { workday?: number; holiday_normal?: number; holiday_ot?: number }>;
  const d = s.default ?? {};
  const t = (type && s[type]) || {};
  return {
    workday: t.workday ?? d.workday ?? null,
    holiday_normal: t.holiday_normal ?? d.holiday_normal ?? null,
    holiday_ot: t.holiday_ot ?? d.holiday_ot ?? null,
  };
}

/** ชื่อเต็มพร้อมคำนำหน้า */
export const personName = (p: { title?: string | null; first_name_th: string; last_name_th: string | null }) =>
  [p.title, p.first_name_th, p.last_name_th].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

/** ฟอร์ม MOU ใช้กับประเภท mou · ที่เหลือใช้ฟอร์มคนไทย */
export const formOf = (employmentType: string | null | undefined): "mou" | "thai" => ((employmentType ?? "").toLowerCase() === "mou" ? "mou" : "thai");

const str = (v: unknown, max = LEN) => (typeof v === "string" ? v.slice(0, max) : "");
const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => (x as string).slice(0, 300)).slice(0, 8) : []);

/** อ่านค่าตั้งค่า timesheet.form แบบปลอดภัย (ค่าที่ขาด = ว่าง) */
export function parseForm(v: unknown): TimesheetForm {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const f = (x: unknown): FormTexts => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { company: str(r.company), title: str(r.title, 300), subject: str(r.subject), to: str(r.to), notes: lines(r.notes) };
  };
  const wh: Record<string, WhTexts> = {};
  const w = (o.wh && typeof o.wh === "object" ? o.wh : {}) as Record<string, unknown>;
  for (const [k, x] of Object.entries(w)) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    wh[k] = { mou_dept: str(r.mou_dept, 100), mou_ul: str(r.mou_ul, 30), thai_dept: str(r.thai_dept, 100), thai_ul: str(r.thai_ul, 30) };
  }
  return { mou: f(o.mou), thai: f(o.thai), wh };
}

/** ค่าที่มีผล ณ วันที่ (จากหลายเวอร์ชันที่มีวันที่เริ่มใช้) */
export function settingAt<T = unknown>(rows: { effective_from: string; value: T }[], date: string): T | undefined {
  return [...rows].filter((r) => r.effective_from <= date).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]?.value;
}
