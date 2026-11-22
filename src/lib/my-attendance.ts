// เวลาเข้า-ออกของฉัน: ถ้าหลายส่วนในหน้าขอช่วงวันเดียวกันพร้อมกัน ใช้คำขอเดียว (ข้อมูลใหม่ทุกครั้งที่เปิดหน้า)
import { sb } from "./supabase";
import type { AttendanceRow } from "./attendance";

type Res = { data: AttendanceRow[] | null; error: unknown };
const flying = new Map<string, Promise<Res>>();

export function loadMyAttendance(from: string, to: string): Promise<Res> {
  const key = `${from}|${to}`;
  const hit = flying.get(key);
  if (hit) return hit;
  const job: Promise<Res> = Promise.resolve(sb().rpc("my_attendance", { p_from: from, p_to: to }))
    .then(({ data, error }) => ({ data: (data ?? null) as AttendanceRow[] | null, error }))
    .finally(() => flying.delete(key));
  flying.set(key, job);
  return job;
}
