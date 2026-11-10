// ตรวจว่าข้อมูลหลักของพนักงานครบไหม (ใช้ทั้งหน้าทะเบียนและหน้ารายคน · ทดสอบด้วย tests/employee-check.test.mjs)

export type MissingKey = "last_name" | "salary_code" | "position" | "employment_type" | "warehouse" | "skill";

export const MISSING_LABEL: Record<MissingKey, string> = {
  last_name: "นามสกุล",
  salary_code: "รหัสเงินเดือน",
  position: "ตำแหน่ง",
  employment_type: "ประเภทพนักงาน",
  warehouse: "คลัง",
  skill: "ทักษะ",
};

export const MISSING_KEYS = Object.keys(MISSING_LABEL) as MissingKey[];

type Checkable = {
  first_name_th: string;
  last_name_th: string | null;
  salary_code: string | null;
  position: string | null;
  employment_type: string | null;
  warehouse_id: string | null;
  role?: string;
};

// บทบาทส่วนกลาง (ไม่ต้องสังกัดคลัง)
const GLOBAL_ROLES = ["dept_manager", "division_manager", "deputy_gm", "gm", "executive", "super_admin"];

const blank = (v: string | null | undefined) => !v || !v.trim();

/**
 * คืนรายการช่องที่ยังว่าง
 * - นามสกุล: ถ้าช่องชื่อมีชื่อเต็มอยู่แล้ว (มีช่องว่างคั่น เช่น ชื่อพม่าของพนักงาน MOU) ถือว่าครบ
 * - คลัง: ไม่ตรวจผู้บริหาร (เป็นส่วนกลาง) · บัญชีผู้ดูแลระบบสูงสุดไม่ตรวจเลย
 */
export function missingFields(e: Checkable, skillCount: number): MissingKey[] {
  if (e.role === "super_admin") return []; // บัญชีผู้ดูแลระบบ ไม่ใช่พนักงานคลัง
  const out: MissingKey[] = [];
  if (blank(e.last_name_th) && !/\S\s+\S/.test(e.first_name_th.trim())) out.push("last_name");
  if (blank(e.salary_code)) out.push("salary_code");
  if (blank(e.position)) out.push("position");
  if (blank(e.employment_type)) out.push("employment_type");
  if (!e.warehouse_id && !GLOBAL_ROLES.includes(e.role ?? "")) out.push("warehouse");
  if (skillCount <= 0) out.push("skill");
  return out;
}
