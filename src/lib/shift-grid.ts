// สูตรของตารางกะแบบ Excel: แปลงข้อความ↔กะ, คัดลอก/วาง, ลากเติม, ลากย้าย (ทดสอบด้วย tests/shift-grid.test.mjs)
import { fmtMinutes, type Cell, type ShiftDef } from "./shifts.ts";

export type Pos = { r: number; c: number };
export type Range = { r0: number; c0: number; r1: number; c1: number }; // ปรับให้ r0<=r1, c0<=c1 เสมอ

export const norm = (a: Pos, b: Pos): Range => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
export const inRange = (g: Range, r: number, c: number) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;
export const size = (g: Range) => ({ h: g.r1 - g.r0 + 1, w: g.c1 - g.c0 + 1 });

// ---------- ข้อความที่แสดง / คัดลอก ----------
const FLAG_TEXT = { OFF: "+OFF", HOL: "+HOL" } as const;

/** ข้อความในช่อง: กะทำงาน = เวลาเข้า/ออก 2 บรรทัด, วันหยุด = ชื่อ */
export function cellLines(cell: Cell | undefined, def: ShiftDef | undefined): [string, string] | null {
  if (!cell) return null;
  if (def?.working && def.start !== null && def.end !== null) return [fmtMinutes(def.start), fmtMinutes(def.end)];
  return [def?.label || cell.shift_code, ""];
}

/** ข้อความตอนคัดลอก (วางใน Excel ได้ และวางกลับเข้าแอปได้) */
export function cellCopyText(cell: Cell | undefined, def: ShiftDef | undefined): string {
  if (!cell) return "";
  const base = def?.working && def.start !== null && def.end !== null ? `${fmtMinutes(def.start)}-${fmtMinutes(def.end)}` : def?.label || cell.shift_code;
  return cell.holiday_work ? `${base}${FLAG_TEXT[cell.holiday_work]}` : base;
}

// ---------- แปลงข้อความที่พิมพ์/วาง เป็นกะ ----------
export type Parsed = { ok: true; cell: Cell | null } | { ok: false; error: string };
const TIME_RE = /^(\d{1,2})(?:[:.](\d{2}))?\s*[-–~/]\s*(\d{1,2})(?:[:.](\d{2}))?$/;
const OFF_WORDS = ["หยุด", "off", "วันหยุด"];

/**
 * รับได้: เวลา (8-17, 08:00-17:00, 7.30-16.30), รหัสกะ (STD1), ชื่อกะ (หยุด, นักขัตฤกษ์)
 * ต่อท้าย +OFF / +HOL หรือ (ห) / (น) = ทำงานวันหยุด · ว่าง = ลบ
 * defs = รหัสกะที่ใช้งาน เรียงตามลำดับในหน้าตั้งค่า (เวลาเหมือนกันหลายรหัส = ใช้รหัสแรก)
 */
export function parseCellText(raw: string, defs: ShiftDef[]): Parsed {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, cell: null };
  let hw: Cell["holiday_work"] = null;
  const flag = text.match(/\s*(?:\+\s*(OFF|HOL)|\((ห|น)\))\s*$/i);
  if (flag) {
    const f = (flag[1] ?? flag[2]).toUpperCase();
    hw = f === "HOL" || f === "น" ? "HOL" : "OFF";
    text = text.slice(0, flag.index).trim();
  }
  const lower = text.toLowerCase();
  const byCode = defs.find((d) => d.code.toLowerCase() === lower);
  const byLabel = defs.find((d) => d.label.trim().toLowerCase() === lower);
  let def = byCode ?? byLabel;
  if (!def && OFF_WORDS.includes(lower)) def = defs.find((d) => d.code.toUpperCase() === "OFF") ?? defs.find((d) => !d.working);
  if (!def) {
    const m = text.match(TIME_RE);
    if (m) {
      const s = Number(m[1]) * 60 + Number(m[2] ?? 0);
      const e = Number(m[3]) * 60 + Number(m[4] ?? 0);
      if (Number(m[1]) < 24 && Number(m[3]) < 24) def = defs.find((d) => d.working && d.start === s && d.end !== null && d.end % 1440 === e % 1440);
      if (!def) return { ok: false, error: `ไม่มีกะเวลา ${fmtMinutes(s)}-${fmtMinutes(e)} เพิ่มรหัสกะในหน้าตั้งค่าก่อน` };
    }
  }
  if (!def) return { ok: false, error: `ไม่รู้จัก "${raw.trim()}" พิมพ์เป็นเวลา เช่น 8-17 หรือรหัสกะ` };
  return { ok: true, cell: { shift_code: def.code, holiday_work: def.working ? hw : null, is_volunteer: false } };
}

// ---------- คลิปบอร์ด (ข้อความคั่นด้วย Tab แบบ Excel) ----------
export function toTsv(matrix: string[][]): string {
  return matrix.map((r) => r.map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
}

export function fromTsv(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return rows.map((r) => r.split("\t"));
}

/**
 * วาง: ข้อมูล 1 ช่อง + เลือกหลายช่อง = เติมทุกช่อง / ช่วงที่เลือกใหญ่เป็นจำนวนเท่าของข้อมูล = ทำซ้ำ /
 * อื่นๆ = วางจากมุมซ้ายบน ขยายตามขนาดข้อมูล (ตัดส่วนที่เกินตาราง)
 * คืนรายการ [แถว, คอลัมน์, ค่า]
 */
export function pastePlan<T>(data: T[][], sel: Range, rows: number, cols: number): [number, number, T][] {
  const h = data.length;
  const w = Math.max(...data.map((r) => r.length), 0);
  if (!h || !w) return [];
  const { h: sh, w: sw } = size(sel);
  const tile = (h === 1 && w === 1) || (sh % h === 0 && sw % w === 0 && (sh > h || sw > w));
  const outH = tile ? sh : h;
  const outW = tile ? sw : w;
  const out: [number, number, T][] = [];
  for (let i = 0; i < outH; i++) {
    for (let j = 0; j < outW; j++) {
      const r = sel.r0 + i;
      const c = sel.c0 + j;
      if (r >= rows || c >= cols) continue;
      const v = data[i % h][j % w];
      if (v === undefined) continue;
      out.push([r, c, v]);
    }
  }
  return out;
}

/**
 * ลากเติม (จุดมุมขวาล่าง): ขยายไปทางที่ลากไกลกว่า แล้วซ้ำรูปแบบของช่วงต้นฉบับ
 * คืนช่วงปลายทาง (ไม่รวมต้นฉบับ) และตำแหน่งต้นฉบับของแต่ละช่อง
 */
export function fillPlan(src: Range, to: Pos): { area: Range | null; from: (r: number, c: number) => Pos } {
  const down = to.r > src.r1 ? to.r - src.r1 : to.r < src.r0 ? to.r - src.r0 : 0;
  const right = to.c > src.c1 ? to.c - src.c1 : to.c < src.c0 ? to.c - src.c0 : 0;
  const { h, w } = size(src);
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  const from = (r: number, c: number): Pos => ({ r: src.r0 + mod(r - src.r0, h), c: src.c0 + mod(c - src.c0, w) });
  if (!down && !right) return { area: null, from };
  if (Math.abs(right) >= Math.abs(down)) {
    const area = right > 0 ? { r0: src.r0, r1: src.r1, c0: src.c1 + 1, c1: src.c1 + right } : { r0: src.r0, r1: src.r1, c0: src.c0 + right, c1: src.c0 - 1 };
    return { area, from };
  }
  const area = down > 0 ? { r0: src.r1 + 1, r1: src.r1 + down, c0: src.c0, c1: src.c1 } : { r0: src.r0 + down, r1: src.r0 - 1, c0: src.c0, c1: src.c1 };
  return { area, from };
}

/** ลากย้าย/คัดลอกช่วง: ช่วงปลายทางที่ขยับไป (dr, dc) โดยไม่ล้นตาราง */
export function moveTarget(src: Range, dr: number, dc: number, rows: number, cols: number): Range {
  const { h, w } = size(src);
  const r0 = Math.max(0, Math.min(rows - h, src.r0 + dr));
  const c0 = Math.max(0, Math.min(cols - w, src.c0 + dc));
  return { r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 };
}

// ---------- ลำดับรายชื่อในกลุ่ม (ลากชื่อขึ้น/ลง) ----------
/** ย้าย id ไปไว้ตำแหน่งของ over: ลากลง = ไปอยู่หลัง over · ลากขึ้น = ไปอยู่ก่อน over */
export function moveItem(list: string[], id: string, over: string): string[] {
  const from = list.indexOf(id);
  const to = list.indexOf(over);
  if (from < 0 || to < 0 || from === to) return list;
  const out = list.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** เรียงคนในกลุ่มตามลำดับที่บันทึกไว้ คนที่ไม่อยู่ในรายการคงลำดับเดิมต่อท้าย */
export function sortByMembers<T extends { id: string }>(list: T[], members: string[]): T[] {
  const at = new Map(members.map((id, i) => [id, i]));
  return list
    .map((e, i) => ({ e, k: at.get(e.id) ?? members.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.e);
}

/** ลำดับใหม่ทั้งคลังหลังจัดกลุ่มหนึ่ง: คนในกลุ่มนี้ตามลำดับใหม่ ต่อด้วยคนอื่นตามลำดับเดิม */
export function mergeMembers(members: string[], groupIds: string[]): string[] {
  const inGroup = new Set(groupIds);
  return [...groupIds, ...members.filter((id) => !inGroup.has(id))];
}
