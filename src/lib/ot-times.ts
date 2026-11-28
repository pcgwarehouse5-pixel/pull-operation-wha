// เวลาที่แสดงในรายงาน OT / ใบลงเวลา "ตามตารางกะ" (ผู้ใช้กำหนด 28 พ.ย. 2569)
//   เข้าก่อนเวลากะ → แสดงเวลาเข้ากะ (สแกน 07:50 กะ 08:00 → 08:00)
//   เวลาออก = เวลาเลิกกะ + ชั่วโมง OT ที่คำนวณได้ (ปัดลงตามกฎ OT ในฐานข้อมูล) เช่น สแกน 20:05 → 20:00, 20:35 → 20:30
//   ชั่วโมง OT มาจากฐานข้อมูล (ot_rows_core) เวลาในรายงานจึงตรงกับชั่วโมงที่จ่ายเสมอ
// ทดสอบได้ด้วย tests/ot-times.test.mjs · ไฟล์นี้ห้าม import แบบ "@/" (เทสต์รันตรงด้วย node)

export type PaidInput = {
  /** วันทำงานปกติ หรือวันหยุด (OFF / HOL) */
  off: boolean;
  firstIn: string | null;
  lastOut: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  /** ชั่วโมงปกติของวันหยุด + ชั่วโมง OT (จากฐานข้อมูล) */
  normalHours: number;
  otHours: number;
  /** ชั่วโมงนี้นับได้ (อนุมัติแล้ว) — ถ้าไม่ เวลาออกไม่เกินเวลาเลิกกะ */
  counted: boolean;
};

export type PaidTimes = {
  from: string | null;
  to: string | null;
  /** วันทำงาน: ช่วงเวลาปกติ */
  normalFrom: string | null;
  normalTo: string | null;
  /** ช่วงที่ทำ OT (วันหยุด = ทั้งช่วงที่ทำงาน) */
  otFrom: string | null;
  otTo: string | null;
};

export type BreakRule = { minutes: number; after: number };

const ms = (iso: string) => new Date(iso).getTime();
const iso = (t: number) => new Date(t).toISOString();
const MIN = 60_000;

/** เวลาเข้า-ออกที่แสดงในรายงาน */
export function paidTimes(x: PaidInput, brk: BreakRule): PaidTimes {
  const out: PaidTimes = { from: null, to: null, normalFrom: null, normalTo: null, otFrom: null, otTo: null };
  if (!x.firstIn) {
    out.to = x.lastOut;
    return out;
  }
  const start = x.shiftStart && ms(x.firstIn) < ms(x.shiftStart) ? x.shiftStart : x.firstIn;
  out.from = start;
  if (!x.lastOut) return out;

  if (x.off) {
    const paid = (Number(x.normalHours) || 0) + (Number(x.otHours) || 0);
    if (x.counted && paid > 0) {
      const raw = (ms(x.lastOut) - ms(start)) / MIN;
      const end = Math.min(ms(start) + paid * 60 * MIN + (raw >= brk.after ? brk.minutes * MIN : 0), ms(x.lastOut));
      out.to = out.otTo = iso(end);
      out.otFrom = start;
    } else out.to = x.lastOut;
    return out;
  }

  // วันทำงาน
  out.normalFrom = start;
  if (!x.shiftEnd) {
    out.to = out.normalTo = x.lastOut;
    return out;
  }
  out.normalTo = ms(x.lastOut) < ms(x.shiftEnd) ? x.lastOut : x.shiftEnd;
  const ot = Number(x.otHours) || 0;
  if (x.counted && ot > 0 && ms(x.lastOut) > ms(x.shiftEnd)) {
    out.otFrom = x.shiftEnd;
    out.otTo = iso(Math.min(ms(x.shiftEnd) + ot * 60 * MIN, ms(x.lastOut)));
    out.to = out.otTo;
  } else out.to = out.normalTo;
  return out;
}

/** เวลาเริ่ม-เลิกกะเป็น ISO (เวลาไทย) จากวันที่ + "HH:MM" · เลิกไม่หลังเริ่ม = ข้ามวัน */
export function shiftWindow(date: string, start: string | null | undefined, end: string | null | undefined): { start: string | null; end: string | null } {
  const ok = (t: string | null | undefined) => !!t && /^\d{1,2}:\d{2}$/.test(t);
  if (!ok(start) || !ok(end)) return { start: null, end: null };
  const at = (t: string) => ms(`${date}T${t!.padStart(5, "0")}:00+07:00`);
  const s = at(start!);
  let e = at(end!);
  if (e <= s) e += 24 * 60 * MIN;
  return { start: iso(s), end: iso(e) };
}

/** เหมือน shiftWindow แต่รับนาทีนับจากเที่ยงคืน (ShiftDef.start / end — end เกิน 1440 = ข้ามวัน) */
export function shiftWindowMin(date: string, startMin: number | null, endMin: number | null): { start: string | null; end: string | null } {
  if (startMin === null || endMin === null) return { start: null, end: null };
  const base = ms(`${date}T00:00:00+07:00`);
  return { start: iso(base + startMin * MIN), end: iso(base + endMin * MIN) };
}
