// เวลาพัก 2 รอบ: เลือกรอบแรกครั้งเดียว รู้รอบที่ 2 จากตัวเลือกในหน้าตั้งค่า (ทดสอบด้วย tests/break-times.test.mjs)
// ตัวเลือก pull_break_time: value = รอบแรก "11:00" · extra.shift = morning/night · extra.second = รอบ 2 · extra.second_note = หมายเหตุ
type Option = { value: string; sort_order: number; is_active: boolean; extra: Record<string, unknown> };
export type BreakSlot = { first: string; second: string | null; note: string };

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "12:00:00" → "12:00" */
export const breakHm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const slotOf = (o: Option): BreakSlot => {
  const second = str(o.extra?.second);
  return { first: o.value, second: HM.test(second) ? second : null, note: str(o.extra?.second_note) };
};
const forShift = (o: Option, shift: string) => !str(o.extra?.shift) || str(o.extra?.shift) === shift;

/** เวลาพักที่เลือกได้ของผลัดนี้ เรียงตามลำดับในหน้าตั้งค่า (ตัวเลือกที่ไม่ระบุผลัด = ใช้ได้ทุกผลัด) */
export function breakSlots(options: Option[] | undefined, shift: string): BreakSlot[] {
  return (options ?? [])
    .filter((o) => o.is_active && HM.test(o.value) && forShift(o, shift))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(slotOf);
}

/** เวลาพักของคนหนึ่ง: รอบแรกที่บันทึกไว้ + รอบ 2 ตามตัวเลือกของผลัดนั้น (ไม่พบตัวเลือก = แสดงรอบแรกอย่างเดียว) */
export function breakPair(options: Option[] | undefined, shift: string, time: string | null | undefined): BreakSlot | null {
  const first = breakHm(time);
  if (!first) return null;
  const list = (options ?? []).filter((o) => o.value === first);
  const hit = list.find((o) => o.is_active && forShift(o, shift)) ?? list.find((o) => forShift(o, shift));
  return hit ? slotOf(hit) : { first, second: null, note: "" };
}

/** ข้อความสั้น: "พัก 11:00 · 16:30" */
export const breakShort = (s: BreakSlot) => `พัก ${s.first}${s.second ? ` · ${s.second}` : ""}`;
