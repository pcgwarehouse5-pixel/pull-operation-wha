// ชนิดข้อมูลหลัก (ตรงกับตารางใน supabase/migrations)

export type AppRole = "employee" | "supervisor" | "admin" | "executive" | "super_admin";

export const ROLES: AppRole[] = ["employee", "supervisor", "admin", "executive", "super_admin"];

export const ROLE_LABEL: Record<AppRole, string> = {
  employee: "พนักงาน",
  supervisor: "หัวหน้างาน",
  admin: "แอดมินคลัง",
  executive: "ผู้บริหาร",
  super_admin: "ผู้ดูแลระบบสูงสุด",
};

export const ROLE_RANK: Record<AppRole, number> = { employee: 1, supervisor: 2, admin: 3, executive: 4, super_admin: 5 };

// บทบาทสูงสุดที่แต่ละคนมอบให้คนอื่นได้ (ตรงกับฟังก์ชัน set_user_access ในฐานข้อมูล)
export function assignableRoles(me: AppRole): AppRole[] {
  const max = me === "admin" ? 2 : me === "executive" ? 3 : me === "super_admin" ? 5 : 0;
  return ROLES.filter((r) => ROLE_RANK[r] <= max);
}

export const isGlobal = (r: AppRole) => r === "executive" || r === "super_admin";
export const isManager = (r: AppRole) => ROLE_RANK[r] >= 3;
export const isSupervisorUp = (r: AppRole) => ROLE_RANK[r] >= 2;

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
