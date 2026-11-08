// สูตรและชนิดข้อมูลของ Pull Operation (ทดสอบด้วย tests/pull-lib.test.mjs)

export type PullShift = "morning" | "night";
export const SHIFT_LABEL: Record<PullShift, string> = { morning: "กะเช้า", night: "กะดึก" };

export type PullSkillRow = { warehouse_id: string; skill_name: string; sort_order: number };
export type WorkloadType = { id: string; warehouse_id: string; name: string; unit: string; sort_order: number; is_active: boolean };
export type PullTask = { id: string; warehouse_id: string; workload_type_id: string; skill_name: string; is_active: boolean };
export type TaskRate = { task_id: string; warehouse_id: string; effective_from: string; per_hour: number; note: string | null; created_at: string };
export type ShiftHours = { warehouse_id: string; shift: PullShift; effective_from: string; hours: number; note: string | null; created_at: string };
export type SkillCount = { warehouse_id: string; skill_name: string; people: number };

export type PullConfig = {
  skillNames: string[]; // ชื่อทักษะทั้งหมดที่เปิดใช้ (ไม่ซ้ำ)
  skillPositions: Record<string, string[]>; // ทักษะนี้อยู่ในตำแหน่งไหนบ้าง
  pullSkills: PullSkillRow[];
  types: WorkloadType[];
  tasks: PullTask[];
  rates: TaskRate[];
  hours: ShiftHours[];
  counts: SkillCount[];
};

type Dated = { effective_from: string };

/** ค่าที่ใช้ ณ วันที่ (ค่าล่าสุดที่เริ่มใช้ไม่เกินวันนั้น) ไม่มี = null (ไม่ตีเป็น 0) */
export function valueAt<T extends Dated>(list: T[], date: string): T | null {
  let best: T | null = null;
  for (const x of list) if (x.effective_from <= date && (!best || x.effective_from > best.effective_from)) best = x;
  return best;
}

/** ค่าที่ตั้งไว้ล่วงหน้า (เริ่มใช้หลังวันนั้น) ตัวที่ใกล้ที่สุด */
export function nextChange<T extends Dated>(list: T[], date: string): T | null {
  let best: T | null = null;
  for (const x of list) if (x.effective_from > date && (!best || x.effective_from < best.effective_from)) best = x;
  return best;
}

/** 1 คนทำได้ต่อกะ = Productivity ต่อชั่วโมง × ชั่วโมงต่อกะ */
export function perShift(perHour: number | null | undefined, hours: number | null | undefined): number | null {
  if (!perHour || !hours || perHour <= 0 || hours <= 0) return null;
  return Math.round(perHour * hours * 100) / 100;
}

export function rateOf(cfg: PullConfig, taskId: string, date: string) {
  return valueAt(cfg.rates.filter((r) => r.task_id === taskId), date);
}

export function hoursOf(cfg: PullConfig, wh: string, shift: PullShift, date: string) {
  return valueAt(cfg.hours.filter((h) => h.warehouse_id === wh && h.shift === shift), date);
}

/** งานที่ใช้คำนวณจริงของคลัง: งานที่เปิดอยู่ ประเภทงานเปิดอยู่ และทักษะเปิดให้คลังดึง */
export function activeTasks(cfg: PullConfig, wh: string) {
  const pulled = new Set(cfg.pullSkills.filter((s) => s.warehouse_id === wh).map((s) => s.skill_name));
  const types = new Map(cfg.types.filter((t) => t.warehouse_id === wh && t.is_active).map((t) => [t.id, t]));
  return cfg.tasks.filter((k) => k.warehouse_id === wh && k.is_active && types.has(k.workload_type_id) && pulled.has(k.skill_name));
}

export type Readiness = {
  skills: boolean;
  productivity: boolean;
  mapping: boolean;
  hours: boolean;
  skillsWithoutTask: string[];
  typesWithoutSkill: string[];
  tasksWithoutRate: number;
};

/** ความพร้อมของการตั้งค่า 4 ขั้นของคลังหนึ่ง ณ วันที่ */
export function readiness(cfg: PullConfig, wh: string, date: string): Readiness {
  const pulled = cfg.pullSkills.filter((s) => s.warehouse_id === wh).map((s) => s.skill_name);
  const tasks = activeTasks(cfg, wh);
  const types = cfg.types.filter((t) => t.warehouse_id === wh && t.is_active);
  const skillsWithoutTask = pulled.filter((s) => !tasks.some((k) => k.skill_name === s));
  const typesWithoutSkill = types.filter((t) => !tasks.some((k) => k.workload_type_id === t.id)).map((t) => t.name);
  const tasksWithoutRate = tasks.filter((k) => !rateOf(cfg, k.id, date)).length;
  return {
    skills: pulled.length > 0,
    productivity: tasks.length > 0 && tasksWithoutRate === 0,
    mapping: types.length > 0 && skillsWithoutTask.length === 0 && typesWithoutSkill.length === 0,
    hours: !!hoursOf(cfg, wh, "morning", date) && !!hoursOf(cfg, wh, "night", date),
    skillsWithoutTask,
    typesWithoutSkill,
    tasksWithoutRate,
  };
}

/** แสดงตัวเลขแบบไทย ตัดศูนย์ท้าย (30 / 32.5) */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/** ตรวจตัวเลขที่พิมพ์: ต้องมากกว่า 0 และไม่เกิน max คืน null ถ้าใช้ไม่ได้ */
export function parsePositive(text: string, max: number): number | null {
  const s = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v > 0 && v <= max ? Math.round(v * 100) / 100 : null;
}

// ---------- หน้าตาของทักษะ (ไอคอน + สี) เดาจากชื่อ ----------
export type SkillIcon = "forklift" | "clipboard" | "cart" | "trolley" | "truck" | "box";
export type SkillStyle = { icon: SkillIcon; color: string; tint: string };

const C = {
  red: ["#e5484d", "#fdecec"],
  green: ["#1e8e5a", "#e6f4ec"],
  amber: ["#e8930c", "#fdf3e1"],
  blue: ["#2563eb", "#e8effd"],
  purple: ["#7c3aed", "#f1eafd"],
  teal: ["#0f8b8d", "#e2f3f3"],
} as const;

export function skillStyle(name: string): SkillStyle {
  const n = name.toLowerCase();
  const icon: SkillIcon = /^rt/.test(n)
    ? "forklift"
    : /เช็ค|checker/.test(n)
      ? "clipboard"
      : /picker/.test(n)
        ? "cart"
        : /^op/.test(n)
          ? "trolley"
          : /โหลด|load/.test(n)
            ? "truck"
            : "box";
  const key: keyof typeof C = /^op/.test(n)
    ? "purple"
    : /เช็ค|checker/.test(n)
      ? "amber"
      : /picker/.test(n)
        ? "blue"
        : /เติม/.test(n)
          ? "green"
          : /รับ/.test(n)
            ? "red"
            : /จ่าย/.test(n)
              ? "blue"
              : /โหลด|load/.test(n)
                ? "teal"
                : "red";
  return { icon, color: C[key][0], tint: C[key][1] };
}

// ---------- คำนวณคนที่ต้องการ (สูตรเดียวกับฟังก์ชัน pull_requirements ในฐานข้อมูล) ----------
export type ReqRow = {
  skill_name: string;
  skill_order: number;
  workload_type_id: string;
  type_name: string;
  type_order: number;
  unit: string;
  volume: number | null;
  hours: number | null;
  per_hour: number | null;
  fte: number | null; // ยอดงาน ÷ (ชั่วโมง × Productivity)
};
export type SkillReq = { skill_name: string; skill_order: number; fte: number | null; required: number | null; complete: boolean; missing: string | null };

/** ปัดขึ้นเสมอ (กันเศษทศนิยมเล็กมากจากการหาร เช่น 0.7 + 0.3 = 0.9999999999999999) */
export function ceilPeople(fte: number): number {
  return Math.max(0, Math.ceil(fte - 1e-9));
}

/** รายละเอียดทีละงาน ณ คลัง/วัน/กะ · volumes = ยอดงานต่อประเภทงาน (ไม่มี = ยังไม่กรอก) */
export function requirementRows(cfg: PullConfig, wh: string, date: string, shift: PullShift, volumes: Record<string, number | null | undefined>): ReqRow[] {
  const hours = hoursOf(cfg, wh, shift, date)?.hours ?? null;
  const order = new Map(cfg.pullSkills.filter((s) => s.warehouse_id === wh).map((s) => [s.skill_name, s.sort_order]));
  const types = new Map(cfg.types.map((t) => [t.id, t]));
  return activeTasks(cfg, wh)
    .map((k) => {
      const t = types.get(k.workload_type_id)!;
      const v = volumes[t.id];
      const volume = v === undefined || v === null || !Number.isFinite(v) ? null : v;
      const per_hour = rateOf(cfg, k.id, date)?.per_hour ?? null;
      const fte = volume !== null && hours && hours > 0 && per_hour && per_hour > 0 ? volume / (hours * per_hour) : null;
      return { skill_name: k.skill_name, skill_order: order.get(k.skill_name) ?? 0, workload_type_id: t.id, type_name: t.name, type_order: t.sort_order, unit: t.unit, volume, hours, per_hour, fte };
    })
    .sort((a, b) => a.skill_order - b.skill_order || a.type_order - b.type_order);
}

/** คนที่ต้องการต่อทักษะ: รวมทุกงานของทักษะ แล้วปัดขึ้นครั้งเดียว · ข้อมูลไม่ครบ = null (ไม่ตีเป็น 0) */
export function skillRequirements(cfg: PullConfig, wh: string, rows: ReqRow[]): SkillReq[] {
  return cfg.pullSkills
    .filter((s) => s.warehouse_id === wh)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => {
      const mine = rows.filter((r) => r.skill_name === s.skill_name);
      const complete = mine.length > 0 && mine.every((r) => r.fte !== null);
      const sum = mine.reduce((n, r) => n + (r.fte ?? 0), 0);
      const missing = !mine.length
        ? "ยังไม่ผูกประเภทงาน"
        : mine.some((r) => r.hours === null)
          ? "ยังไม่ตั้งชั่วโมงต่อกะ"
          : mine.some((r) => r.per_hour === null)
            ? "ยังไม่ตั้ง Productivity"
            : mine.some((r) => r.volume === null)
              ? "ยังไม่กรอกยอดงาน"
              : null;
      return { skill_name: s.skill_name, skill_order: s.sort_order, fte: complete ? Math.round(sum * 10000) / 10000 : null, required: complete ? ceilPeople(sum) : null, complete, missing };
    });
}

/** รวมคนที่ต้องการ: ต้องครบทุกทักษะ ไม่อย่างนั้นแสดง — (ไม่ตีเป็นตัวเลขที่ต่ำกว่าความจริง) */
export function totalRequired(reqs: SkillReq[]): number | null {
  if (!reqs.length || reqs.some((r) => !r.complete)) return null;
  return reqs.reduce((n, r) => n + (r.required ?? 0), 0);
}

/** ตรวจยอดงานที่พิมพ์: ว่าง = ยังไม่กรอก (null) / ตัวเลข 0 ขึ้นไป / อื่นๆ = ใช้ไม่ได้ */
export function parseVolume(text: string, max = 10000000): { ok: boolean; value: number | null } {
  const s = text.replace(/,/g, "").trim();
  if (!s) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, value: null };
  const v = Math.round(Number(s) * 100) / 100;
  return v <= max ? { ok: true, value: v } : { ok: false, value: null };
}

/** จัดรูปตัวเลขขณะพิมพ์ให้มีคอมมาคั่นหลักพัน (1300 → 1,300 / 1234.5 → 1,234.5) ตัดตัวอักษรอื่นทิ้ง */
export function formatTyping(text: string): string {
  const clean = text.replace(/[^\d.]/g, "");
  const dot = clean.indexOf(".");
  const int = (dot < 0 ? clean : clean.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const dec = dot < 0 ? null : clean.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec === null ? withCommas : `${withCommas || "0"}.${dec}`;
}

/** ตำแหน่งเคอร์เซอร์หลังจัดรูป: วางหลังตัวเลขตัวที่ n เท่าเดิม */
export function caretAfterDigits(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d.]/.test(formatted[i])) seen++;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}

// ---------- คลังกลางและการจอง (หน้าสรุปกำลังพล / ดึงคน) ----------
export type PoolStatus = "ready" | "booked_here" | "busy" | "unavailable";
export type PoolPerson = {
  user_id: string;
  employee_code: string;
  name: string;
  nickname: string | null;
  emp_position: string | null;
  warehouse_id: string;
  warehouse_code: string;
  shift_code: string | null;
  start_min: number | null;
  status: PoolStatus;
  reason: string | null;
  skills: string[];
  booking_id: string | null;
  booked_to: string | null;
  booked_to_code: string | null;
  booked_skill: string | null;
};
export type Booking = { id: string; work_date: string; shift: PullShift; user_id: string; from_warehouse_id: string | null; to_warehouse_id: string; skill_name: string; status: "booked" | "cancelled"; break_time: string | null; booked_at: string };

export const STATUS_LABEL: Record<PoolStatus, string> = { ready: "พร้อม", booked_here: "จองแล้ว", busy: "ติดภารกิจ", unavailable: "ไม่พร้อม" };

export type SkillSummary = {
  skill: string;
  total: number; // คนในคลังกลางที่มีทักษะนี้และเข้ากะนี้ (รวมที่ถูกจองแล้ว)
  need: number | null; // ต้องการ (null = ยังคำนวณไม่ได้)
  booked: number; // จองเข้าคลังนี้แล้ว (วัน/กะนี้)
  waiting: number | null; // ยังต้องจองอีก
  left: number; // คนที่ยังว่าง พร้อมดึง
  rate: number | null; // % จองแล้วเทียบที่ต้องการ
};

const working = (p: PoolPerson) => p.status === "ready" || p.status === "booked_here" || p.status === "busy";

/** สรุปต่อทักษะ + ภาพรวม (คนที่มีหลายทักษะนับครั้งเดียวในภาพรวม) */
export function summarize(reqs: SkillReq[], pool: PoolPerson[], bookings: Booking[]) {
  const mine = bookings.filter((b) => b.status === "booked");
  const rows: SkillSummary[] = reqs.map((q) => {
    const booked = mine.filter((b) => b.skill_name === q.skill_name).length;
    const need = q.complete ? q.required : null;
    return {
      skill: q.skill_name,
      total: pool.filter((p) => working(p) && p.skills.includes(q.skill_name)).length,
      need,
      booked,
      waiting: need === null ? null : Math.max(0, need - booked),
      left: pool.filter((p) => p.status === "ready" && p.skills.includes(q.skill_name)).length,
      rate: need === null ? null : need === 0 ? 100 : Math.min(100, Math.round((booked / need) * 100)),
    };
  });
  const skills = new Set(reqs.map((q) => q.skill_name));
  const has = (p: PoolPerson) => p.skills.some((s) => skills.has(s));
  const need = totalRequired(reqs);
  const booked = mine.length;
  return {
    rows,
    total: pool.filter((p) => working(p) && has(p)).length,
    need,
    booked,
    waiting: need === null ? null : rows.reduce((n, r) => n + (r.waiting ?? 0), 0),
    left: pool.filter((p) => p.status === "ready" && has(p)).length,
    rate: need === null ? null : need === 0 ? 100 : Math.min(100, Math.round((booked / need) * 100)),
  };
}

/** เวลาเข้างานจากนาที (480 → 08:00) */
export function hhmm(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- Dashboard ผู้บริหาร (ตัวเลขรวมจากฟังก์ชัน pull_network) ----------
export type NetRow = {
  work_day: string;
  wh_id: string;
  wh_code: string;
  wh_name: string;
  pool_count: number;
  on_leave: number;
  need: number | null;
  complete: boolean;
  short: number | null;
  booked: number;
  pulled_in: number;
  lent_out: number;
};

export function pct(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** รวมทุกคลังของวันหนึ่ง: ถ้ามีคลังที่ยังคำนวณไม่ได้ ความต้องการ/ยังขาด = null (แสดง —) */
export function networkTotals(rows: NetRow[]) {
  const known = rows.length > 0 && rows.every((r) => r.need !== null);
  const pool = rows.reduce((n, r) => n + r.pool_count, 0);
  const booked = rows.reduce((n, r) => n + r.booked, 0);
  return {
    pool,
    booked,
    need: known ? rows.reduce((n, r) => n + (r.need ?? 0), 0) : null,
    short: known ? rows.reduce((n, r) => n + (r.short ?? 0), 0) : null,
    remaining: Math.max(0, pool - booked),
    leave: rows.reduce((n, r) => n + r.on_leave, 0),
    pulled: rows.reduce((n, r) => n + r.pulled_in, 0),
    incomplete: rows.filter((r) => r.need === null).length,
  };
}

/** แนวโน้มรายวัน (รวมทุกคลังที่เลือก) */
export function trend(rows: NetRow[]) {
  const days = [...new Set(rows.map((r) => r.work_day))].sort();
  return days.map((day) => {
    const t = networkTotals(rows.filter((r) => r.work_day === day));
    return { day, pool: t.pool, need: t.need, booked: t.booked, usage: pct(t.booked, t.pool) };
  });
}

/** ตำแหน่งหลักของทักษะ (ใช้จัดกลุ่มในหน้าผังตำแหน่ง) */
export function skillGroup(name: string): string {
  const n = name.toLowerCase();
  if (/^rt/.test(n)) return "RT";
  if (/เช็ค|checker/.test(n)) return "Checker";
  if (/picker/.test(n)) return "Picker";
  if (/^op/.test(n)) return "OP";
  if (/^ct/.test(n)) return "CT";
  if (/โหลด|load/.test(n)) return "โหลดสินค้า";
  return "อื่นๆ";
}
