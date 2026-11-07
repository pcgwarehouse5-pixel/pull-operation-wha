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
