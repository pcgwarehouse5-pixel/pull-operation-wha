// ตัวกรองรายชื่อพนักงานในหน้าดึงกำลังคนทีละตำแหน่ง
// ไม่แสดงคนที่ไม่พร้อมในกะนั้น (ลา วันหยุด เข้าอีกกะ จองอีกกะแล้ว) · กรองคลังต้นทาง ตำแหน่ง สถานะ ทักษะ และคำค้น
import type { PoolPerson, PoolStatus } from "./pull";

/** ค่าพิเศษของตัวกรองตำแหน่ง = ตำแหน่งที่งานนี้สังกัด */
export const JOB = "__job";
const NO_POS = "ไม่ระบุตำแหน่ง";
const posOf = (p: PoolPerson) => p.emp_position?.trim() || NO_POS;

export type PoolFilter = {
  skill: string;
  scope: "skill" | "all"; // มีทักษะนี้ / ทุกคน
  wh: string; // "" = ทุกคลัง
  pos: string; // "" = ทุกตำแหน่ง · JOB = ตำแหน่งของงานนี้ · อื่นๆ = ตำแหน่งนั้น
  jobPos: string[];
  status: PoolStatus | "";
  q: string;
};

/** ตำแหน่งที่งาน (ทักษะ) นี้สังกัด: จากหน้าทักษะ ถ้ายังไม่มีใช้ตำแหน่งของคนที่มีทักษะนี้ */
export function jobPositions(fromSkills: string[] | null, pool: PoolPerson[], skill: string): string[] {
  const list = fromSkills ?? pool.filter((p) => p.skills.includes(skill) && p.emp_position).map(posOf);
  return [...new Set(list)].sort((a, b) => a.localeCompare(b, "th"));
}

const base = (p: PoolPerson, f: Pick<PoolFilter, "skill" | "scope" | "wh">) =>
  (f.scope === "all" || p.skills.includes(f.skill)) && (!f.wh || p.warehouse_id === f.wh);

/** ตัวเลือกตำแหน่ง (เฉพาะคนที่แสดงได้) เรียงจากคนมากไปน้อย · ไม่ระบุตำแหน่งไว้ท้าย */
export function positionOptions(pool: PoolPerson[], f: Pick<PoolFilter, "skill" | "scope" | "wh">) {
  const n = new Map<string, number>();
  for (const p of pool) if (p.status !== "unavailable" && base(p, f)) n.set(posOf(p), (n.get(posOf(p)) ?? 0) + 1);
  return [...n].map(([position, count]) => ({ position, count })).sort((a, b) => Number(a.position === NO_POS) - Number(b.position === NO_POS) || b.count - a.count || a.position.localeCompare(b.position, "th"));
}

/** รายชื่อที่แสดง + จำนวนคนไม่พร้อมที่ซ่อนไว้ (ตามตัวกรองเดียวกัน) */
export function visiblePool(pool: PoolPerson[], f: PoolFilter) {
  const q = f.q.trim().toLowerCase();
  const posOk = (p: PoolPerson) => !f.pos || (f.pos === JOB ? f.jobPos.includes(posOf(p)) : posOf(p) === f.pos);
  const match = pool.filter((p) => base(p, f) && posOk(p) && `${p.name} ${p.nickname ?? ""} ${p.employee_code}`.toLowerCase().includes(q));
  return {
    shown: match.filter((p) => p.status !== "unavailable" && (!f.status || p.status === f.status)),
    hidden: match.filter((p) => p.status === "unavailable").length,
  };
}
