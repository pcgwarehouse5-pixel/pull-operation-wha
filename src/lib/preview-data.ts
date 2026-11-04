// ข้อมูลสมมติของโหมดดูดีไซน์ (ไม่ใช่ข้อมูลพนักงานจริง) โหลดเฉพาะตอน npm run dev
import type { AppRole, AuditLog, DropdownOption, Profile, Warehouse } from "./types";

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ข้อมูลพนักงานจริง)
const W5 = "preview-wh-5";
const W32 = "preview-wh-32";

export const PREVIEW_WAREHOUSES: Warehouse[] = [
  { id: W5, code: "WH5", name: "คลัง 5 (ตัวอย่าง)", address: null, latitude: 13.08, longitude: 100.92, checkin_radius_m: 200, color: "#2563eb", is_active: true },
  { id: W32, code: "WH32", name: "คลัง 32 (ตัวอย่าง)", address: null, latitude: null, longitude: null, checkin_radius_m: 300, color: "#16a34a", is_active: true },
];

const base = { title: null, last_name_th: "ตัวอย่าง", position: null, department: null, employment_type: "monthly_employee", phone: null, line_id: null, status: "active" as const, created_at: "2026-11-01T00:00:00Z" };

export const PREVIEW_USERS: Profile[] = [
  { ...base, id: "p1", employee_code: "D0001", first_name_th: "ผู้ทดลอง", nickname: "หนึ่ง", position: "RT", warehouse_id: W5, role: "employee", must_change_password: true },
  { ...base, id: "p2", employee_code: "D0002", first_name_th: "ทดสอบ", nickname: null, position: "Checker", warehouse_id: W5, role: "supervisor", must_change_password: false },
  { ...base, id: "p3", employee_code: "D0003", first_name_th: "สมมติ", nickname: "สาม", position: "Admin คลัง", warehouse_id: W32, role: "admin", must_change_password: false },
  { ...base, id: "p4", employee_code: "D0004", first_name_th: "จำลอง", nickname: null, position: "ผู้จัดการฝ่าย", warehouse_id: null, role: "executive", must_change_password: false },
];

export function previewProfile(role: AppRole): Profile {
  return { ...base, id: "preview-me", employee_code: "DEMO01", first_name_th: "ผู้ใช้", last_name_th: "ตัวอย่าง", nickname: "เดโม", position: "ตัวอย่าง", warehouse_id: role === "executive" || role === "super_admin" ? null : W5, role, must_change_password: false };
}

export const PREVIEW_OPTIONS: DropdownOption[] = [
  { id: "o1", category: "position", value: "RT", label: "RT", sort_order: 1, extra: {}, is_active: true },
  { id: "o2", category: "position", value: "Checker", label: "Checker", sort_order: 2, extra: {}, is_active: true },
  { id: "o3", category: "shift_type", value: "STD1", label: "08:00-17:00", sort_order: 1, extra: { start_time: "08:00", end_time: "17:00", bg: "#00b341" }, is_active: true },
  { id: "o4", category: "leave_type", value: "sick", label: "ป่วย", sort_order: 1, extra: {}, is_active: true },
];

export const PREVIEW_AUDIT: AuditLog[] = [
  { id: 2, created_at: "2026-11-04T09:15:00Z", actor_id: "p3", action: "update", table_name: "profiles", record_id: "p1", warehouse_id: W5, old_data: { position: "Picker" }, new_data: { position: "RT" } },
  { id: 1, created_at: "2026-11-04T08:00:00Z", actor_id: "p1", action: "login", table_name: "profiles", record_id: "p1", warehouse_id: W5, old_data: null, new_data: null },
];
