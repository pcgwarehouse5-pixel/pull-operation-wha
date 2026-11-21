// คิวอนุมัติใบลา: เรียงตามวันลา และบอกว่าใกล้ถึงวันลาแค่ไหน (ทดสอบด้วย tests/leave-queue.test.mjs)

export type LeaveDueKind = "overdue" | "ongoing" | "today" | "tomorrow" | "soon" | "later";
export type LeaveDue = { kind: LeaveDueKind; text: string; level: "urgent" | "soon" | "normal" };

const SOON_DAYS = 3; // ไม่เกินกี่วันนับเป็น "ใกล้ถึง" (ใช้จัดสีป้ายอย่างเดียว ไม่เกี่ยวกับสิทธิ์วันลา)

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

/** เรียงจากวันลาที่มาถึงก่อน → วันลาหลัง · วันเริ่มเท่ากัน = จบก่อนขึ้นก่อน แล้วตามเวลาที่ยื่น */
export function sortLeaveQueue<T extends { start_date: string; end_date: string; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date) || a.created_at.localeCompare(b.created_at),
  );
}

/** ป้ายบอกความเร่งด่วนเทียบกับวันนี้ (today = YYYY-MM-DD ตามเวลาไทย) */
export function leaveDue(start: string, end: string, today: string): LeaveDue {
  if (end < today) return { kind: "overdue", text: `เลยมาแล้ว ${daysBetween(end, today)} วัน`, level: "urgent" };
  if (start < today) return { kind: "ongoing", text: "กำลังลาอยู่", level: "urgent" };
  const left = daysBetween(today, start);
  if (left === 0) return { kind: "today", text: "ลาวันนี้", level: "urgent" };
  if (left === 1) return { kind: "tomorrow", text: "ลาพรุ่งนี้", level: "soon" };
  return { kind: left <= SOON_DAYS ? "soon" : "later", text: `อีก ${left} วัน`, level: left <= SOON_DAYS ? "soon" : "normal" };
}
