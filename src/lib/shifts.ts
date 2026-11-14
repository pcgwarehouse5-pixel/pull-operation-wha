// สูตรของโมดูลตารางกะ (ไม่แตะฐานข้อมูล ทดสอบได้ด้วย tests/shifts.test.mjs)
import type { DropdownOption } from "./types";

export const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export const THAI_DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

// ---------- วันที่ (ใช้สตริง YYYY-MM-DD ตลอด ไม่ขึ้นกับเขตเวลาของเครื่อง) ----------
const pad = (n: number) => String(n).padStart(2, "0");

export function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "2026-12" → ["2026-12-01", ..., "2026-12-31"] */
export function monthDates(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => isoOf(y, m, i + 1));
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 0 = อาทิตย์ ... 6 = เสาร์ */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function thaiMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${THAI_MONTHS[m - 1]} ${y + 543}`;
}

/** เดือนปัจจุบันตามเวลาไทย */
export function currentMonth(now = new Date()): string {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(now);
  return s.slice(0, 7);
}

export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ---------- รหัสกะ (มาจากหน้าตั้งค่าตัวเลือก หมวด shift_type) ----------
export type ShiftDef = {
  code: string;
  label: string;
  start: number | null; // นาทีนับจากเที่ยงคืน
  end: number | null; // ถ้าข้ามเที่ยงคืน จะมากกว่า 1440
  bg: string;
  text: string;
  working: boolean; // มีเวลาเข้า-ออก = กะทำงาน (OFF, HOL ฯลฯ ไม่ใช่)
  night: boolean;
  noOt: boolean; // วันหยุดที่บริษัทให้พิเศษ (เช่น OFF เหลือง) มาทำงานไม่คิด OT
};

export function parseTime(t: unknown): number | null {
  const m = typeof t === "string" ? t.match(/^(\d{1,2})[:.](\d{2})$/) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export function shiftDef(o: Pick<DropdownOption, "value" | "label" | "extra">): ShiftDef {
  const s = parseTime(o.extra?.start_time);
  let e = parseTime(o.extra?.end_time);
  const working = s !== null && e !== null;
  if (working && e! <= s!) e = e! + 1440;
  return {
    code: o.value,
    label: o.label,
    start: working ? s : null,
    end: working ? e : null,
    bg: typeof o.extra?.bg === "string" ? (o.extra.bg as string) : "#64748b",
    text: typeof o.extra?.text === "string" ? (o.extra.text as string) : "#fff",
    working,
    night: working && e! > 1440,
    noOt: o.extra?.no_ot === true,
  };
}

export function fmtMinutes(m: number): string {
  return `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
}

export function shiftTimeText(d: ShiftDef | undefined): string {
  return d && d.start !== null && d.end !== null ? `${fmtMinutes(d.start)}-${fmtMinutes(d.end)}` : "";
}

// ---------- ช่องในตาราง ----------
export type Cell = { shift_code: string; holiday_work: "OFF" | "HOL" | null; is_volunteer: boolean };
/** userId → วันที่ → ช่อง */
export type Grid = Record<string, Record<string, Cell>>;
export type Change = { user_id: string; work_date: string; cell: Cell | null }; // null = ลบ

export const cellOf = (code: string, holiday_work: Cell["holiday_work"] = null): Cell => ({ shift_code: code, holiday_work, is_volunteer: false });

export function sameCell(a: Cell | null | undefined, b: Cell | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.shift_code === b.shift_code && a.holiday_work === b.holiday_work && a.is_volunteer === b.is_volunteer;
}

/** รวมการแก้ไขที่ยังไม่บันทึกเข้ากับตารางจริง */
export function mergeGrid(base: Grid, pending: Record<string, Cell | null>): Grid {
  const out: Grid = {};
  for (const [u, days] of Object.entries(base)) out[u] = { ...days };
  for (const [key, cell] of Object.entries(pending)) {
    const [u, d] = splitKey(key);
    out[u] = out[u] ?? {};
    if (cell) out[u][d] = cell;
    else delete out[u][d];
  }
  return out;
}

export const keyOf = (userId: string, date: string) => `${userId}|${date}`;
export const splitKey = (k: string) => k.split("|") as [string, string];

/** ใส่ค่าลงรายการแก้ไข: ถ้ากลับไปเท่ากับของเดิมก็ไม่นับเป็นการแก้ */
export function stage(pending: Record<string, Cell | null>, base: Grid, changes: Change[], onlyEmpty = false): Record<string, Cell | null> {
  const next = { ...pending };
  const merged = onlyEmpty ? mergeGrid(base, pending) : null;
  for (const c of changes) {
    if (merged && merged[c.user_id]?.[c.work_date]) continue;
    const k = keyOf(c.user_id, c.work_date);
    const orig = base[c.user_id]?.[c.work_date] ?? null;
    if (sameCell(orig, c.cell)) delete next[k];
    else next[k] = c.cell;
  }
  return next;
}

/** รายการที่ส่งให้ฐานข้อมูล (apply_shifts) */
export function toRows(pending: Record<string, Cell | null>) {
  return Object.entries(pending).map(([k, c]) => {
    const [user_id, work_date] = splitKey(k);
    return { user_id, work_date, shift_code: c?.shift_code ?? null, holiday_work: c?.holiday_work ?? null, is_volunteer: c?.is_volunteer ?? false };
  });
}

// ---------- เครื่องมือวางกะ ----------

/** คัดลอกจากเดือนก่อน: ใช้กะของวันเดียวกันเมื่อ 4 สัปดาห์ก่อน (วันในสัปดาห์ตรงกัน รอบหมุนกะต่อเนื่อง) */
export function copyFromPrevious(source: Grid, userIds: string[], dates: string[], offsetDays = 28): Change[] {
  const out: Change[] = [];
  for (const u of userIds) {
    for (const d of dates) {
      let from = addDays(d, -offsetDays);
      // ถ้า 4 สัปดาห์ก่อนยังอยู่ในเดือนเป้าหมาย ให้ถอยต่ออีกรอบ (ใช้ค่าที่คัดลอกมาแล้ว)
      let cell = source[u]?.[from];
      if (!cell && dates.includes(from)) {
        from = addDays(from, -offsetDays);
        cell = source[u]?.[from];
      }
      if (cell) out.push({ user_id: u, work_date: d, cell: { ...cell } });
    }
  }
  return out;
}

/** ทำซ้ำรูปแบบ เช่น [{STD1 x5}, {OFF x2}] ตั้งแต่วันที่เลือกถึงสิ้นเดือน */
export function repeatPattern(pattern: { code: string; days: number }[], userIds: string[], dates: string[], startIndex = 0): Change[] {
  const seq: string[] = [];
  for (const p of pattern) for (let i = 0; i < Math.max(0, Math.floor(p.days)); i++) if (p.code) seq.push(p.code);
  if (!seq.length) return [];
  const out: Change[] = [];
  for (const u of userIds) {
    for (let i = startIndex; i < dates.length; i++) {
      out.push({ user_id: u, work_date: dates[i], cell: cellOf(seq[(i - startIndex) % seq.length]) });
    }
  }
  return out;
}

/** เติมกะเดียวกันให้หลายคน ช่วงวันที่เลือก */
export function fillRange(code: string | null, userIds: string[], dates: string[]): Change[] {
  return userIds.flatMap((u) => dates.map((d) => ({ user_id: u, work_date: d, cell: code ? cellOf(code) : null })));
}

/** วันนักขัตฤกษ์: ใส่รหัสวันหยุด (เช่น HOL) ให้ทุกคนในวันหยุดของเดือนนั้น */
export function holidayFill(holidayDates: string[], userIds: string[], dates: string[], holCode: string): Change[] {
  const set = new Set(dates);
  return fillRange(holCode, userIds, holidayDates.filter((d) => set.has(d)));
}

/** นับจำนวนคนต่อกะต่อวัน */
export function countByDay(grid: Grid, userIds: string[], dates: string[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const d of dates) out[d] = {};
  for (const u of userIds) {
    for (const d of dates) {
      const c = grid[u]?.[d];
      if (c) out[d][c.shift_code] = (out[d][c.shift_code] ?? 0) + 1;
    }
  }
  return out;
}

// ---------- วางกะอัตโนมัติ (ปรับจากแอปเดิม: เติมคนให้พอดีความต้องการ คนที่เหลือหยุด ไม่เกินจำนวน = ไม่เกิด OT) ----------
export type PlanEmployee = { id: string; code: string; position: string | null };
export type ShiftNeed = { shift: string; start: number | null; end: number | null; counts: Record<string, number> };
export type PlanOptions = {
  employees: PlanEmployee[];
  dates: string[];
  needs: ShiftNeed[];
  offCode: string;
  daysOffPerWeek: number;
  rotateWeekly: boolean;
  rotationWeeks: number;
  minRestHours: number;
  /** กะของวันสุดท้ายเดือนก่อน (ใช้ตรวจเวลาพักข้ามเดือน) */
  previousLast?: Record<string, ShiftNeed | undefined>;
};
export type PlanResult = {
  assignments: Record<string, Record<string, string>>;
  workDays: Record<string, number>;
  shortages: { date: string; shift: string; position: string; missing: number }[];
  missingPositions: string[];
  restBlocked: number;
};

export function generatePlan(o: PlanOptions): PlanResult {
  const { employees, dates, needs, offCode } = o;
  const rest = Math.max(0, o.minRestHours) * 60;
  const assignments: PlanResult["assignments"] = {};
  const workDays: Record<string, number> = {};
  const shortages: PlanResult["shortages"] = [];
  const lastEnd: Record<string, number> = {};
  let restBlocked = 0;

  const win = (n: ShiftNeed, dayIdx: number) => {
    const start = dayIdx * 1440 + (n.start ?? 0);
    return { start, end: start + Math.max(60, (n.end ?? 1440) - (n.start ?? 0)) };
  };
  for (const e of employees) {
    assignments[e.id] = {};
    workDays[e.id] = 0;
    const prev = o.previousLast?.[e.id];
    if (prev) lastEnd[e.id] = win(prev, -1).end;
  }
  const rested = (id: string, start: number) => lastEnd[id] === undefined || start - lastEnd[id] >= rest;

  const byPos = new Map<string, PlanEmployee[]>();
  for (const e of employees) {
    const p = e.position || "อื่นๆ";
    if (!byPos.has(p)) byPos.set(p, []);
    byPos.get(p)!.push(e);
  }
  byPos.forEach((list) => list.sort((a, b) => a.code.localeCompare(b.code)));

  const wanted = new Set<string>();
  needs.forEach((n) => Object.entries(n.counts).forEach(([p, c]) => c > 0 && wanted.add(p)));
  const missingPositions = [...wanted].filter((p) => !byPos.has(p));

  // วันหยุดประจำสัปดาห์ของแต่ละคน (เหลื่อมกันเพื่อให้คนพอทุกวัน)
  const offDays = new Map<string, Set<number>>();
  byPos.forEach((list) =>
    list.forEach((e, idx) => {
      const set = new Set<number>();
      for (let w = 0; w * 7 < dates.length; w++) {
        for (let k = 0; k < Math.max(0, o.daysOffPerWeek); k++) {
          const day = w * 7 + ((idx + w + k * 3) % 7);
          if (day < dates.length) set.add(day);
        }
      }
      offDays.set(e.id, set);
    }),
  );

  const shiftCount = needs.length || 1;
  const rotation = new Map<string, number>();
  byPos.forEach((list) => list.forEach((e, idx) => rotation.set(e.id, idx % shiftCount)));
  const preferred = (id: string, dayIdx: number) => {
    const block = o.rotateWeekly ? Math.floor(dayIdx / (7 * Math.max(1, o.rotationWeeks))) : 0;
    return needs[((rotation.get(id) ?? 0) + block) % shiftCount]?.shift;
  };

  dates.forEach((date, dayIdx) => {
    const today = new Set<string>();
    for (const n of needs) {
      for (const [pos, need] of Object.entries(n.counts)) {
        if (!need || need <= 0) continue;
        const w = win(n, dayIdx);
        const all = byPos.get(pos) ?? [];
        const pool = all
          .filter((e) => !today.has(e.id) && !offDays.get(e.id)?.has(dayIdx) && rested(e.id, w.start))
          .sort((a, b) => {
            const pa = preferred(a.id, dayIdx) === n.shift ? 0 : 1;
            const pb = preferred(b.id, dayIdx) === n.shift ? 0 : 1;
            return pa - pb || workDays[a.id] - workDays[b.id] || a.code.localeCompare(b.code);
          });
        let taken = pool.slice(0, need);
        if (taken.length < need) {
          // คนไม่พอ: ยืมคนที่ตรงกับวันหยุดของตัวเองมาช่วย
          const backup = all
            .filter((e) => !today.has(e.id) && !taken.includes(e) && rested(e.id, w.start))
            .sort((a, b) => workDays[a.id] - workDays[b.id] || a.code.localeCompare(b.code));
          taken = taken.concat(backup.slice(0, need - taken.length));
        }
        for (const e of taken) {
          assignments[e.id][date] = n.shift;
          workDays[e.id] += 1;
          today.add(e.id);
          lastEnd[e.id] = w.end;
        }
        if (taken.length < need) {
          const idle = all.filter((e) => !today.has(e.id) && !rested(e.id, w.start)).length;
          restBlocked += Math.min(idle, need - taken.length);
          shortages.push({ date, shift: n.shift, position: pos, missing: need - taken.length });
        }
      }
    }
    for (const e of employees) if (!today.has(e.id)) assignments[e.id][date] = offCode;
  });

  return { assignments, workDays, shortages, missingPositions, restBlocked };
}

/** แปลงผลวางกะเป็นรายการแก้ไข */
export function planChanges(plan: PlanResult): Change[] {
  return Object.entries(plan.assignments).flatMap(([u, days]) => Object.entries(days).map(([d, code]) => ({ user_id: u, work_date: d, cell: cellOf(code) })));
}
