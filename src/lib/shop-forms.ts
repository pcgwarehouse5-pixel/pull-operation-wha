// แบบฟอร์มหน้าร้าน (ผู้ใช้กำหนด 28 พ.ย. 2569): ลาเป็นชั่วโมง · แบบฟอร์มลางานรายคน · ใบแจ้งตารางการปฏิบัติงาน
// ทดสอบได้ด้วย tests/shop-forms.test.mjs · ไฟล์นี้ห้าม import แบบ "@/" (เทสต์รันตรงด้วย node)

const pad = (n: number) => String(n).padStart(2, "0");
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const LEN = 200;

// ---------------- ลาเป็นชั่วโมง ----------------

/** เวลาสิ้นสุดการลา "HH:MM" (null ถ้าข้ามเที่ยงคืน) */
export function leaveEnd(start: string, hours: number): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(start);
  if (!m || !(hours > 0)) return null;
  const end = Number(m[1]) * 60 + Number(m[2]) + Math.round(hours * 60);
  if (end >= 24 * 60) return null;
  return `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

/** ตัวเลือกจำนวนชั่วโมงที่ลาได้: ทีละ step นาที ไม่ถึง 1 วัน (8 ชม. ทีละ 60 → 1–7) */
export function hourChoices(hoursPerDay: number, stepMinutes: number): number[] {
  const step = Math.max(1, Math.round(stepMinutes));
  const out: number[] = [];
  for (let m = step; m < hoursPerDay * 60; m += step) out.push(m / 60);
  return out;
}

/** วันลาตามฐานข้อมูล: ชั่วโมง ÷ ชั่วโมงต่อวัน ปัด 3 ตำแหน่ง */
export const hoursToDays = (hours: number, hoursPerDay: number) => round3(hours / hoursPerDay);

/** "1.5" → "1.5", 2 → "2" */
export const num = (n: number) => String(Math.round(n * 100) / 100);

/** จำนวนวันลาเป็นข้อความ: 11.75 วัน (8 ชม./วัน) → "11 วัน 6 ชม." · 0.25 → "2 ชม." · 1 → "1 วัน" · ติดลบมีเครื่องหมายลบ */
export function daysText(days: number, hoursPerDay: number): string {
  if (!Number.isFinite(days)) return "-";
  const neg = days < 0;
  const totalMin = Math.round(Math.abs(days) * hoursPerDay * 60);
  const perDay = Math.round(hoursPerDay * 60);
  const d = Math.floor(totalMin / perDay);
  const h = (totalMin - d * perDay) / 60;
  const parts = [d ? `${d} วัน` : "", h ? `${num(h)} ชม.` : ""].filter(Boolean);
  return (neg ? "-" : "") + (parts.join(" ") || "0 วัน");
}

// ---------------- วันที่แบบไทย ----------------

/** 2027-03-05 → 05/03/2570 */
export function thaiDmy(d: string | null | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${Number(d.slice(0, 4)) + 543}`;
}

/** ช่วงวันที่สั้น: วันเดียว 05/03/2570 · เดือนเดียวกัน 05–07/03/2570 · ข้ามเดือน 30/03–02/04/2570 */
export function thaiRange(a: string, b: string): string {
  if (a === b) return thaiDmy(a);
  const yb = Number(b.slice(0, 4)) + 543;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${a.slice(8, 10)}–${b.slice(8, 10)}/${b.slice(5, 7)}/${yb}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${a.slice(8, 10)}/${a.slice(5, 7)}–${b.slice(8, 10)}/${b.slice(5, 7)}/${yb}`;
  return `${thaiDmy(a)}–${thaiDmy(b)}`;
}

// ---------------- แบบฟอร์มลางาน ----------------

export type LeaveFormRow = {
  user_id: string;
  request_id: string | null;
  leave_type: string | null;
  start_date: string | null;
  end_date: string | null;
  period: "full" | "morning" | "afternoon" | "hours" | null;
  start_time: string | null;
  hours: number | null;
  days: number | null;
  reason: string | null;
  approved_by: string | null;
  vacation_quota: number | null;
};

/** 3 คอลัมน์ในฟอร์ม (ป่วย / กิจ / พักผ่อน) แต่ละคอลัมน์มี วัน + ชม. */
export const FORM_TYPES = ["sick", "personal", "vacation"] as const;
export type FormType = (typeof FORM_TYPES)[number];
type Cell = { days: number; hours: number };

export type LeaveFormLine = {
  date: string;
  cells: Partial<Record<FormType, Cell>>;
  /** สิทธิลาพักผ่อนคงเหลือหลังใบนี้ (เฉพาะใบลาพักผ่อน) */
  vacationLeft: string;
  reason: string;
  approver: string;
};

export type LeaveFormSheet = { lines: LeaveFormLine[]; totals: Record<FormType, Cell>; quota: number | null };

/**
 * แถวของแบบฟอร์มลางาน 1 คน (ใบที่อนุมัติแล้ว เรียงตามวันที่)
 * @param typeLabel รหัสประเภทลา → ชื่อ เช่น ordination → "บวช" (ประเภทนอก 3 คอลัมน์เขียนในช่องเหตุผล)
 */
export function leaveFormSheet(rows: LeaveFormRow[], hoursPerDay: number, typeLabel: (code: string) => string): LeaveFormSheet {
  const reqs = rows.filter((r) => r.request_id && r.leave_type && r.start_date);
  const quota = rows.find((r) => r.vacation_quota !== null && r.vacation_quota !== undefined)?.vacation_quota ?? null;
  const totals = Object.fromEntries(FORM_TYPES.map((t) => [t, { days: 0, hours: 0 }])) as Record<FormType, Cell>;
  let usedVac = 0;
  const lines = reqs.map((r): LeaveFormLine => {
    const type = r.leave_type!;
    const hourly = r.period === "hours" && r.hours !== null;
    const days = Number(r.days) || 0;
    const notes: string[] = [];
    if (r.period === "morning") notes.push("ครึ่งวันเช้า");
    if (r.period === "afternoon") notes.push("ครึ่งวันบ่าย");
    if (hourly && r.start_time) {
      const st = r.start_time.slice(0, 5);
      const en = leaveEnd(st, Number(r.hours));
      notes.push(en ? `${st}–${en} น.` : `${st} น.`);
    }
    const cells: LeaveFormLine["cells"] = {};
    let vacationLeft = "";
    if ((FORM_TYPES as readonly string[]).includes(type)) {
      const t = type as FormType;
      const cell = hourly ? { days: 0, hours: Number(r.hours) } : { days, hours: 0 };
      cells[t] = cell;
      totals[t].days += cell.days;
      totals[t].hours += cell.hours;
      if (t === "vacation") {
        usedVac += days;
        if (quota !== null) vacationLeft = daysText(round3(Number(quota) - usedVac), hoursPerDay);
      }
    } else {
      notes.unshift(`ลา${typeLabel(type)} ${hourly ? `${num(Number(r.hours))} ชม.` : `${num(days)} วัน`}`);
    }
    if (r.reason) notes.push(r.reason);
    return { date: thaiRange(r.start_date!, r.end_date ?? r.start_date!), cells, vacationLeft, reason: notes.join(" · "), approver: r.approved_by ?? "" };
  });
  for (const t of FORM_TYPES) totals[t].days = round3(totals[t].days);
  return { lines, totals, quota };
}

// ---------------- ใบแจ้งตารางการปฏิบัติงาน ----------------

export type ShiftFormTexts = {
  company: string;
  title: string;
  group: string;
  signer_name: string;
  signer_title: string;
  signer_role: string;
  /** รหัสกะ → ข้อความในช่อง เช่น { STD1: "1" } */
  codes: Record<string, string>;
  legend: string;
};

export type LeaveFormTexts = { group: string; title: string; company: string; dept: string };

const str = (v: unknown, max = LEN) => (typeof v === "string" ? v.slice(0, max) : "");

/** อ่านค่าตั้งค่า shop.shift_form แบบปลอดภัย */
export function parseShiftForm(v: unknown): ShiftFormTexts {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const codes: Record<string, string> = {};
  if (o.codes && typeof o.codes === "object") {
    for (const [k, x] of Object.entries(o.codes as Record<string, unknown>)) if (typeof x === "string" && k.length <= 30) codes[k] = x.slice(0, 6);
  }
  return {
    company: str(o.company), title: str(o.title), group: str(o.group, 100),
    signer_name: str(o.signer_name, 100), signer_title: str(o.signer_title, 100), signer_role: str(o.signer_role, 50),
    codes, legend: str(o.legend, 300),
  };
}

/** อ่านค่าตั้งค่า shop.leave_form แบบปลอดภัย */
export function parseLeaveForm(v: unknown): LeaveFormTexts {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { group: str(o.group, 100), title: str(o.title, 100), company: str(o.company), dept: str(o.dept, 100) };
}

/**
 * ข้อความในช่องวันที่ของใบแจ้งตารางการปฏิบัติงาน
 * รหัสที่ตั้งไว้ (เช่น STD1 → "1") · กะอื่นแสดงชั่วโมงเข้างาน (11:00 → "11", 07:30 → "7.30") · วันหยุด/ไม่มีเวลา → "-" · ไม่มีตารางกะ → ว่าง
 */
export function shiftCell(code: string | null | undefined, startTime: string | null | undefined, codes: Record<string, string>): string {
  if (!code) return "";
  if (codes[code] !== undefined) return codes[code];
  const m = startTime ? /^(\d{1,2}):(\d{2})$/.exec(startTime) : null;
  if (!m) return "-";
  return m[2] === "00" ? String(Number(m[1])) : `${Number(m[1])}.${m[2]}`;
}

/** วันอาทิตย์ (ระบายเทาในฟอร์ม) */
export const isSunday = (d: string) => new Date(`${d}T12:00:00+07:00`).getUTCDay() === 0;

/** ชื่อเดือนไทยเต็ม */
export const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** ช่วงเวลาลาเป็นชั่วโมง เช่น "10:00–12:00" */
export function hourSpan(r: { start_time?: string | null; hours?: number | null }): string {
  if (!r.start_time || !r.hours) return "";
  const st = r.start_time.slice(0, 5);
  return `${st}–${leaveEnd(st, Number(r.hours)) ?? ""}`;
}

/** จำนวนวันลา (สิทธิคงเหลือ ฯลฯ): จำนวนเต็ม/ครึ่งวันแสดงตัวเลขแบบเดิม · มีเศษชั่วโมง → "11 วัน 4 ชม." */
export function leaveDays(n: number, hoursPerDay: number): string {
  return Number.isInteger(Math.round(n * 1000) / 500) ? num(n) : daysText(n, hoursPerDay);
}
