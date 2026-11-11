// ตำแหน่งงานประจำวันของพนักงาน (มาจากการจัดคนในหน้า Pull: คลัง ตำแหน่ง กะ เวลาพัก)
// เลือก "ตำแหน่งตอนนี้": ถ้ากะดึกของเมื่อวานยังไม่จบ (ยังไม่ถึงเวลาเลิกกะ) ให้แสดงกะนั้นก่อน ไม่อย่างนั้นแสดงของวันนี้
// ทดสอบได้ด้วย tests/my-position.test.mjs

export type MyPos = {
  id: string;
  work_date: string;
  shift: "morning" | "night";
  skill_name: string;
  to_code: string;
  to_name: string;
  break_time: string | null; // "12:00:00"
  away: boolean; // ไปช่วยคลังอื่น (ไม่ใช่คลังสังกัด)
};

export type ShiftTime = { code: string | null; start: string | null; end: string | null };

function shiftDay(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "12:00:00" → "12:00" */
export const breakHm = (t: string | null) => (t ? t.slice(0, 5) : null);

/**
 * วันที่ของ "กะตอนนี้" และตำแหน่งของกะนั้น
 * - กะของเมื่อวานที่ยังไม่ถึงเวลาเลิก (กะดึกข้ามเที่ยงคืน) → ใช้เมื่อวาน
 * - ไม่อย่างนั้นใช้วันนี้ (อาจยังไม่ได้จัดตำแหน่ง = pos เป็น null)
 */
export function currentPosition(rows: MyPos[], shifts: Record<string, ShiftTime>, today: string, now: Date): { date: string; pos: MyPos | null } {
  const yesterday = shiftDay(today, -1);
  const end = shifts[yesterday]?.end;
  if (end && new Date(end).getTime() > now.getTime()) {
    const pos = rows.find((r) => r.work_date === yesterday);
    if (pos) return { date: yesterday, pos };
  }
  return { date: today, pos: rows.find((r) => r.work_date === today) ?? null };
}

/** วันถัดจากกะตอนนี้ ที่หัวหน้าจัดตำแหน่งไว้แล้ว (เรียงตามวันที่) */
export function upcomingPositions(rows: MyPos[], currentDate: string): MyPos[] {
  return rows.filter((r) => r.work_date > currentDate).sort((a, b) => a.work_date.localeCompare(b.work_date));
}
