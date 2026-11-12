// ชนิดข้อมูลหลัก (ตรงกับตารางใน supabase/migrations)

export type AppRole =
  | "employee"
  | "supervisor"
  | "admin"
  | "dept_manager"
  | "division_manager"
  | "deputy_gm"
  | "gm"
  | "executive" // ผู้บริหาร: บทบาทเดิม เลิกใช้แล้ว (คงไว้ให้ข้อมูลเก่าอ่านได้)
  | "super_admin";

// ลำดับบทบาท (ตรงกับฟังก์ชัน role_rank ในฐานข้อมูล)
export const ROLES: AppRole[] = ["employee", "supervisor", "admin", "dept_manager", "division_manager", "deputy_gm", "gm", "executive", "super_admin"];

export const ROLE_LABEL: Record<AppRole, string> = {
  employee: "พนักงาน",
  supervisor: "หัวหน้างาน",
  admin: "แอดมินคลัง",
  dept_manager: "ผู้จัดการแผนก",
  division_manager: "ผู้จัดการฝ่าย",
  deputy_gm: "รองผู้จัดการทั่วไป",
  gm: "ผู้จัดการทั่วไป",
  executive: "ผู้บริหาร (เดิม)",
  super_admin: "ผู้ดูแลระบบสูงสุด",
};

export const ROLE_RANK: Record<AppRole, number> = {
  employee: 1,
  supervisor: 2,
  admin: 3,
  executive: 4,
  dept_manager: 4,
  division_manager: 5,
  deputy_gm: 6,
  gm: 7,
  super_admin: 9,
};

// บทบาทสูงสุดที่แต่ละคนมอบให้คนอื่นได้ (ตรงกับฟังก์ชัน set_user_access ในฐานข้อมูล) · ไม่มอบ "ผู้บริหาร" แล้ว
export function assignableRoles(me: AppRole): AppRole[] {
  const max: Partial<Record<AppRole, number>> = { supervisor: 2, admin: 2, executive: 3, dept_manager: 3, division_manager: 4, deputy_gm: 5, gm: 6, super_admin: 9 };
  return ROLES.filter((r) => r !== "executive" && ROLE_RANK[r] <= (max[me] ?? 0));
}

/** เห็นและจัดการได้ทุกคลัง (ผู้จัดการทุกระดับ ผู้บริหารเดิม และผู้ดูแลระบบสูงสุด) */
export const isGlobal = (r: AppRole) => ROLE_RANK[r] >= 4;
/** ทำงานระดับแอดมินคลังได้ (หัวหน้างานขึ้นไป · หัวหน้างานทำได้เท่าแอดมิน ยกเว้นตั้งค่า Pull) */
export const isManager = (r: AppRole) => ROLE_RANK[r] >= 2;
export const isSupervisorUp = (r: AppRole) => ROLE_RANK[r] >= 2;
/** ผู้จัดการ (ทำได้ทุกอย่าง เช่น เพิ่มคลัง แก้ตารางกะหัวหน้าคลัง) */
export const isManagerRole = (r: AppRole) => ["dept_manager", "division_manager", "deputy_gm", "gm", "super_admin"].includes(r);
/** ไม่ลงเวลา ไม่อยู่ในตารางกะ ไม่มี OT ไม่ใช้ระบบลา (ผู้จัดการฝ่ายขึ้นไป) */
export const noTimekeeping = (r: AppRole) => ["division_manager", "deputy_gm", "gm", "executive", "super_admin"].includes(r);

// ระดับต่ำสุดที่อนุมัติคำขอของบทบาทนี้ได้ (ตรงกับ approval_min_rank ในฐานข้อมูล)
const APPROVAL_MIN: Partial<Record<AppRole, number>> = { employee: 2, supervisor: 4, admin: 4, dept_manager: 5 };

/** ฉันอนุมัติคำขอ (ลา/แก้เวลา/OT) ของคนบทบาทนี้ได้ไหม · sameWarehouse = ฉันดูแลคลังของเขา */
export function canApproveRole(me: AppRole, target: AppRole, sameWarehouse: boolean): boolean {
  const r = ROLE_RANK[me];
  return r >= (APPROVAL_MIN[target] ?? 99) && r > ROLE_RANK[target] && (isGlobal(me) || sameWarehouse);
}

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  checkin_radius_m: number;
  color: string | null;
  is_active: boolean;
};

export type Profile = {
  id: string;
  employee_code: string;
  title: string | null;
  first_name_th: string;
  last_name_th: string | null;
  nickname: string | null;
  position: string | null;
  department: string | null;
  employment_type: string | null;
  phone: string | null;
  line_id: string | null;
  warehouse_id: string | null;
  role: AppRole;
  status: "active" | "resigned";
  must_change_password: boolean;
  created_at: string;
};

// ข้อมูลพนักงานแบบเต็ม (หน้าทะเบียนพนักงาน)
export type Employee = Profile & {
  department: string | null;
  salary_code: string | null;
  birth_date: string | null;
  subcontractor_company: string | null;
  resigned_date: string | null;
  exclude_from_shift: boolean;
  show_in_org_chart: boolean;
  ot_eligible: boolean;
  travel_eligible: boolean;
  show_in_ot_report: boolean;
  auto_check_in: boolean;
};

export type Skill = { id: string; position: string; name: string; sort_order: number; is_active: boolean };

export type HeadcountBudget = { id: string; warehouse_id: string; position: string; budget_count: number };

export const TITLES = ["นาย", "นาง", "นางสาว"];

// ตัวเลือกการคำนวณ/การแสดงผลของพนักงาน (ใช้ในโมดูลตารางกะ ลงเวลา และ OT)
export const EMPLOYEE_FLAGS: { key: keyof Employee; label: string; hint: string }[] = [
  { key: "ot_eligible", label: "คำนวณ OT", hint: "ปิดสำหรับตำแหน่งที่ไม่ได้รับค่าล่วงเวลา" },
  { key: "show_in_ot_report", label: "แสดงในรายงาน OT", hint: "" },
  { key: "travel_eligible", label: "ได้ค่าเดินทาง", hint: "" },
  { key: "exclude_from_shift", label: "ไม่แสดงในตารางกะ", hint: "เช่น ผู้บริหาร หรือพนักงานสำนักงาน" },
  { key: "show_in_org_chart", label: "แสดงในผังองค์กร", hint: "" },
  { key: "auto_check_in", label: "Check In อัตโนมัติตามกะ", hint: "ใช้ในโมดูลลงเวลา" },
];

export type DropdownOption = {
  id: string;
  category: string;
  value: string;
  label: string;
  sort_order: number;
  extra: Record<string, unknown>;
  is_active: boolean;
};

export type AuditLog = {
  id: number;
  created_at: string;
  actor_id: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  warehouse_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

export function fullName(p: Pick<Profile, "title" | "first_name_th" | "last_name_th">): string {
  return [p.title, p.first_name_th, p.last_name_th].filter(Boolean).join(" ").replace(/^(นาย|นาง|นางสาว) /, "$1");
}

// กติการหัสผ่านใหม่ (ใช้ทั้งหน้าจอและฝั่งเซิร์ฟเวอร์) — คืนคีย์ข้อความ เพื่อแปลภาษาได้
export type PasswordProblem = "pw.tooShort" | "pw.tooLong" | "pw.sameChar" | "pw.sequence" | "pw.hasCode";
export function passwordProblemKey(pw: string, employeeCode: string): PasswordProblem | null {
  if (pw.length < 8) return "pw.tooShort";
  if (pw.length > 72) return "pw.tooLong";
  if (/^(.)\1+$/.test(pw)) return "pw.sameChar";
  if ("01234567890".includes(pw) || "09876543210".includes(pw)) return "pw.sequence";
  if (pw.toLowerCase().includes(employeeCode.toLowerCase())) return "pw.hasCode";
  return null;
}
const PW_TH: Record<PasswordProblem, string> = {
  "pw.tooShort": "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว",
  "pw.tooLong": "รหัสผ่านยาวเกินไป",
  "pw.sameChar": "ห้ามใช้ตัวเดียวกันซ้ำทั้งหมด",
  "pw.sequence": "ห้ามใช้ตัวเลขเรียงกัน",
  "pw.hasCode": "ห้ามมีรหัสพนักงานอยู่ในรหัสผ่าน",
};
export function passwordProblem(pw: string, employeeCode: string): string | null {
  const k = passwordProblemKey(pw, employeeCode);
  return k ? PW_TH[k] : null;
}
