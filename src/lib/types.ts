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

// กติการหัสผ่านใหม่ (ใช้ทั้งหน้าจอและฝั่งเซิร์ฟเวอร์)
export function passwordProblem(pw: string, employeeCode: string): string | null {
  if (pw.length < 8) return "รหัสผ่านต้องยาวอย่างน้อย 8 ตัว";
  if (pw.length > 72) return "รหัสผ่านยาวเกินไป";
  if (/^(.)\1+$/.test(pw)) return "ห้ามใช้ตัวเดียวกันซ้ำทั้งหมด";
  if ("01234567890".includes(pw) || "09876543210".includes(pw)) return "ห้ามใช้ตัวเลขเรียงกัน";
  if (pw.toLowerCase().includes(employeeCode.toLowerCase())) return "ห้ามมีรหัสพนักงานอยู่ในรหัสผ่าน";
  return null;
}
