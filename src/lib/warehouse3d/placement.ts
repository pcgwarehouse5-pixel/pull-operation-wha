// จัดวางกล่องพนักงานบนแผนที่คลัง 3D (หน้าผังตำแหน่ง)
// คนที่ลากวางแล้ว = อยู่ที่บันทึกไว้ · ยังไม่ได้วาง = ไปเรียงเป็นตารางรอบ "จุดของตำแหน่งนั้น" ตามลำดับนี้
//   1) คนตำแหน่งเดียวกันในรอบนี้ที่วางไว้แล้ว  2) จุดที่ตำแหน่งนั้นเคยวางล่าสุดในคลังนี้  3) เรียงตามแนวพื้นที่ UNLOADING AREA
import type { WhMap } from "./types";

export type Pt = { x: number; y: number };
export type MapPerson = { id: string; skill: string; x: number | null; y: number | null };
export type Placed = Pt & { auto: boolean };
export type HistoryRow = { skill_name: string; work_date: string; shift: string; map_x: number | null; map_y: number | null; map_at: string | null };

/** ระยะห่างระหว่างกล่อง (หน่วยผัง) */
export const personGap = (m: Pick<WhMap, "pxm">) => m.pxm * 5;

/** จุดของแต่ละตำแหน่ง = จุดกึ่งกลางของคนตำแหน่งนั้นในรอบ (วัน+กะ) ล่าสุดที่เคยวางไว้ */
export function skillAnchors(history: HistoryRow[]): Record<string, Pt> {
  const latest = new Map<string, { key: string; at: string }>();
  for (const r of history) {
    if (r.map_x === null || r.map_y === null || !r.map_at) continue;
    const key = `${r.work_date}|${r.shift}`;
    const cur = latest.get(r.skill_name);
    if (!cur || r.map_at > cur.at) latest.set(r.skill_name, { key, at: r.map_at });
  }
  const out: Record<string, Pt> = {};
  for (const [skill, { key }] of latest) {
    const pts = history.filter((r) => r.skill_name === skill && `${r.work_date}|${r.shift}` === key && r.map_x !== null && r.map_y !== null);
    out[skill] = { x: avg(pts.map((p) => p.map_x!)), y: avg(pts.map((p) => p.map_y!)) };
  }
  return out;
}

const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** ตำแหน่งของทุกคน · ลำดับตำแหน่งตามที่ส่งเข้ามา (คงที่ทุกครั้ง ไม่กระโดดไปมา) */
export function placePeople(people: MapPerson[], anchors: Record<string, Pt>, map: Pick<WhMap, "bounds" | "pxm" | "zones">): Record<string, Placed> {
  const out: Record<string, Placed> = {};
  const [bx0, by0, bx1, by1] = map.bounds;
  const S = personGap(map);
  const skills = [...new Set(people.map((p) => p.skill))];
  const groups = skills.map((skill) => {
    const all = people.filter((p) => p.skill === skill);
    const placed = all.filter((p) => p.x !== null && p.y !== null);
    const base = placed.length ? { x: avg(placed.map((p) => p.x!)), y: avg(placed.map((p) => p.y!)) } : anchors[skill] ?? null;
    return { skill, all, placed, base };
  });
  /* ตำแหน่งที่ยังไม่มีจุด: เรียงตามแนว UNLOADING AREA (หรือแถบล่างของอาคาร) */
  const zone = map.zones?.find((z) => /unloading/i.test(z.t ?? ""))?.r;
  const [zx, zy, zw, zh] = zone ?? [bx0, by1 - 120, bx1 - bx0, 120];
  /* ช่องละกว้างอย่างน้อย ~27 ม. ถ้าตำแหน่งเยอะเกินแถวเดียว ขึ้นแถวใหม่ (ไม่ให้กลุ่มชิดกันจนป้ายทับ)
     ทุกตำแหน่งมีช่องประจำตามลำดับ (แม้ถูกลากไปแล้ว) → กลุ่มอื่นไม่ขยับมาแทนที่ */
  const cols = Math.max(1, Math.min(groups.length, Math.floor(zw / (map.pxm * 27)))), rowsN = Math.ceil(groups.length / cols);
  groups.forEach((g, k) => {
    if (g.base) return;
    const c = k % cols, r = Math.floor(k / cols);
    g.base = { x: zx + ((c + 0.5) * zw) / cols, y: zy + ((r + 0.5) * zh) / rowsN };
  });
  for (const g of groups) {
    for (const p of g.placed) out[p.id] = { x: p.x!, y: p.y!, auto: false };
    const todo = g.all.filter((p) => p.x === null || p.y === null);
    if (!todo.length) continue;
    const n = g.all.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    todo.forEach((p, i) => {
      const j = g.placed.length + i, c = j % cols, r = Math.floor(j / cols);
      out[p.id] = {
        x: clamp(g.base!.x + (c - (cols - 1) / 2) * S, bx0 + S / 2, bx1 - S / 2),
        y: clamp(g.base!.y + (r - (rows - 1) / 2) * S, by0 + S / 2, by1 - S / 2),
        auto: true,
      };
    });
  }
  return out;
}
