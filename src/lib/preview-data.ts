// ข้อมูลสมมติของโหมดดูดีไซน์ (ไม่ใช่ข้อมูลพนักงานจริง) โหลดเฉพาะตอน npm run dev
import type { AppRole, AuditLog, DropdownOption, Employee, HeadcountBudget, Profile, Skill, Warehouse } from "./types";

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

export const PREVIEW_EXTRA_OPTIONS: DropdownOption[] = [
  { id: "u1", category: "pull_unit", value: "pallet", label: "พาเลท", sort_order: 1, extra: {}, is_active: true },
  { id: "u2", category: "pull_unit", value: "piece", label: "ชิ้น", sort_order: 2, extra: {}, is_active: true },
  { id: "o5", category: "employment_type", value: "monthly_employee", label: "พนักงานรายเดือน", sort_order: 1, extra: {}, is_active: true },
  { id: "o6", category: "employment_type", value: "mou", label: "MOU", sort_order: 2, extra: {}, is_active: true },
  { id: "o7", category: "employment_type", value: "daily_worker", label: "คนงานรายวัน", sort_order: 3, extra: {}, is_active: true },
  { id: "o9", category: "shift_type", value: "GN_5", label: "20:00-05:00", sort_order: 2, extra: { start_time: "20:00", end_time: "05:00", bg: "#3b82f6" }, is_active: true },
  { id: "o10", category: "shift_type", value: "OFF", label: "หยุด", sort_order: 3, extra: { bg: "#ef4444" }, is_active: true },
  { id: "o11", category: "shift_type", value: "HOL", label: "นักขัตฤกษ์", sort_order: 4, extra: { bg: "#f59e0b" }, is_active: true },
  { id: "o8", category: "subcontractor_company", value: "บริษัทตัวอย่าง", label: "บริษัทตัวอย่าง", sort_order: 1, extra: {}, is_active: true },
];

export const PREVIEW_SKILLS: Skill[] = [
  { id: "s1", position: "RT", name: "RT ยกรับ (ตัวอย่าง)", sort_order: 1, is_active: true },
  { id: "s2", position: "RT", name: "RT ยกจ่าย (ตัวอย่าง)", sort_order: 2, is_active: true },
  { id: "s3", position: "Checker", name: "เช็ครับ (ตัวอย่าง)", sort_order: 1, is_active: true },
];

export const PREVIEW_BUDGETS: HeadcountBudget[] = [
  { id: "b1", warehouse_id: W5, position: "RT", budget_count: 3 },
  { id: "b2", warehouse_id: W5, position: "Checker", budget_count: 2 },
];

// ข้อมูลพนักงานแบบเต็มสำหรับหน้าทะเบียน
export function previewEmployees(): Employee[] {
  return PREVIEW_USERS.map((p, i) => ({
    ...p,
    salary_code: i === 1 ? null : `S${String(i + 1).padStart(4, "0")}`,
    birth_date: null,
    subcontractor_company: null,
    resigned_date: i === 3 ? "2026-10-31" : null,
    status: i === 3 ? "resigned" : "active",
    exclude_from_shift: false,
    show_in_org_chart: true,
    ot_eligible: true,
    travel_eligible: false,
    show_in_ot_report: true,
    auto_check_in: false,
  }));
}

// ทักษะของพนักงานสมมติ (p2 ยังไม่มีทักษะ ไว้ดูป้าย "ข้อมูลไม่ครบ")
export const PREVIEW_EMPLOYEE_SKILLS = [
  { user_id: "p1", skill_id: "s1" },
  { user_id: "p1", skill_id: "s2" },
  { user_id: "p3", skill_id: "s3" },
  { user_id: "p4", skill_id: "s3" },
];

export const PREVIEW_HOLIDAYS = [
  { id: "h1", holiday_date: "2026-12-05", name: "วันหยุดตัวอย่าง 1" },
  { id: "h2", holiday_date: "2026-12-31", name: "วันหยุดตัวอย่าง 2" },
];

// ตารางกะสมมติ: หมุนกะเช้า/ดึก หยุดวันอาทิตย์
export function previewShifts(dates: string[]) {
  const ids = ["p1", "p2", "preview-me"];
  return ids.flatMap((id, i) =>
    dates.map((d, j) => {
      const dow = new Date(d + "T00:00:00Z").getUTCDay();
      return { user_id: id, work_date: d, shift_code: dow === 0 ? "OFF" : (Math.floor(j / 7) + i) % 2 ? "GN_5" : "STD1", holiday_work: null, is_volunteer: false };
    }),
  );
}

// พนักงานในตารางกะของโหมดดูดีไซน์ (รวมผู้ใช้เดโม)
export function previewRoster(wh: string) {
  const list = previewEmployees().filter((e) => e.warehouse_id === wh);
  if (wh === W5) list.push({ ...list[0], id: "preview-me", employee_code: "DEMO01", first_name_th: "ผู้ใช้", nickname: "เดโม", position: "RT" });
  return list;
}

// ตารางกะของเพื่อนร่วมคลัง (หน้า "ตารางกะของฉัน")
export function previewTeam(dates: string[], meId: string) {
  const names: Record<string, [string, string | null, string]> = { p1: ["ผู้ทดลอง", "หนึ่ง", "RT"], p2: ["ทดสอบ", null, "Checker"], "preview-me": ["ผู้ใช้", "เดโม", "RT"] };
  return previewShifts(dates).map((r) => ({
    ...r,
    holiday_work: null as "OFF" | "HOL" | null,
    user_id: r.user_id === "preview-me" ? meId : r.user_id,
    first_name_th: names[r.user_id][0],
    nickname: names[r.user_id][1],
    position: names[r.user_id][2],
  }));
}

// ---------- ลงเวลา/ลา (ข้อมูลสมมติ) ----------
export function previewAttendance(dates: string[], userId: string, today: string) {
  const sts = ["ok", "late", "ok", "ok", "no_out", "ok", "off"] as const;
  return dates.map((d, i) => {
    const past = d < today;
    const status = d === today ? "working" : past ? sts[i % 7] : "upcoming";
    const st = status === "off" ? null : `${d}T08:00:00+07:00`;
    return {
      user_id: userId, work_date: d, shift_code: status === "off" ? "OFF" : "STD1",
      shift_start: st, shift_end: st && `${d}T17:00:00+07:00`,
      first_in: past || d === today ? (status === "off" ? null : `${d}T0${status === "late" ? "8:12" : "7:52"}:00+07:00`) : null,
      last_out: past && status !== "no_out" && status !== "off" ? `${d}T17:04:00+07:00` : null,
      punch_count: past ? 2 : 0, leave_type: null, leave_period: null, status,
      late_min: status === "late" ? 12 : 0, early_min: 0, pending_correction: status === "no_out" && i < 7,
    };
  });
}

export function previewTeamAttendance(dates: string[], today: string) {
  const people = [["p1", "D0001", "ผู้ทดลอง", "หนึ่ง", "RT"], ["p2", "D0002", "ทดสอบ", null, "Checker"], ["preview-me", "DEMO01", "ผู้ใช้", "เดโม", "RT"]] as const;
  return people.flatMap(([id, code, first, nick, pos], k) =>
    previewAttendance(dates, id, today).map((r, i) => ({
      ...r,
      status: k === 1 && r.status === "ok" && i % 3 === 0 ? "absent" : r.status,
      employee_code: code, first_name_th: first, last_name_th: "ตัวอย่าง", nickname: nick, position: pos,
    })),
  );
}

export const PREVIEW_LEAVE_TYPES = [
  { id: "lt1", category: "leave_type", value: "sick", label: "ป่วย", sort_order: 1, extra: {}, is_active: true },
  { id: "lt2", category: "leave_type", value: "personal", label: "กิจ", sort_order: 2, extra: {}, is_active: true },
  { id: "lt3", category: "leave_type", value: "vacation", label: "พักผ่อน", sort_order: 3, extra: {}, is_active: true },
];

export function previewLeaves(userId: string) {
  return [
    { id: "lr1", user_id: userId, leave_type: "sick", start_date: "2026-11-03", end_date: "2026-11-03", period: "full" as const, days: 1, reason: "ไข้หวัด (ตัวอย่าง)", attachment_path: null, status: "approved" as const, steps_required: 1, steps_done: 1, over_quota: false, created_by: userId, created_at: "2026-11-03T07:00:00Z" },
    { id: "lr2", user_id: "p1", leave_type: "vacation", start_date: "2026-11-20", end_date: "2026-11-24", period: "full" as const, days: 4, reason: "กลับบ้าน (ตัวอย่าง)", attachment_path: null, status: "pending" as const, steps_required: 2, steps_done: 1, over_quota: false, created_by: "p1", created_at: "2026-11-05T07:00:00Z" },
    { id: "lr3", user_id: "p2", leave_type: "personal", start_date: "2026-11-12", end_date: "2026-11-12", period: "morning" as const, days: 0.5, reason: "ติดต่อราชการ (ตัวอย่าง)", attachment_path: null, status: "pending" as const, steps_required: 1, steps_done: 0, over_quota: true, created_by: "p2", created_at: "2026-11-06T02:00:00Z" },
  ];
}

export const PREVIEW_BALANCE = [
  { leave_type: "sick", label: "ป่วย", quota: 30, approved: 1, pending: 0, remaining: 29 },
  { leave_type: "personal", label: "กิจ", quota: 6, approved: 0, pending: 0.5, remaining: 5.5 },
  { leave_type: "vacation", label: "พักผ่อน", quota: 6, approved: 0, pending: 4, remaining: 2 },
];

export function previewCorrections(userId: string) {
  return [
    { id: "c1", user_id: userId, work_date: "2026-11-05", check_in: null, check_out: "17:05:00", reason: "ลืมกดออก (ตัวอย่าง)", status: "pending" as const, decision_note: null, created_at: "2026-11-06T01:00:00Z" },
  ];
}

const PREVIEW_PEOPLE: Record<string, { employee_code: string; first_name_th: string; last_name_th: string | null; nickname: string | null; position: string | null }> = {
  p1: { employee_code: "D0001", first_name_th: "ผู้ทดลอง", last_name_th: "ตัวอย่าง", nickname: "หนึ่ง", position: "RT" },
  p2: { employee_code: "D0002", first_name_th: "ทดสอบ", last_name_th: "ตัวอย่าง", nickname: null, position: "Checker" },
};

// ใบลาของคนในคลัง (หน้าอนุมัติ)
export function previewLeaveQueue(meId: string) {
  return previewLeaves(meId).filter((r) => PREVIEW_PEOPLE[r.user_id]).map((r) => ({ ...r, profiles: PREVIEW_PEOPLE[r.user_id] }));
}

// คำขอแก้เวลาของคนในคลัง (หน้าติดตาม)
export function previewFixQueue() {
  return previewCorrections("p1").map((c) => ({ ...c, profiles: PREVIEW_PEOPLE.p1 }));
}

export const PREVIEW_NOTIFICATIONS = [
  { id: 3, kind: "leave_pending", title: "ใบลารออนุมัติ: ผู้ทดลอง (หนึ่ง)", body: "ลาพักผ่อน 4 วัน (20 พ.ย. – 24 พ.ย.)", link: "/leave/approvals", created_at: "2026-11-06T03:00:00Z", read_at: null },
  { id: 2, kind: "missing_in", title: "ยังไม่ได้ลงเวลาเข้างาน", body: "กะ STD1 เริ่ม 08:00 น. ถ้ามาแล้วให้กดเข้างาน หรือขอแก้เวลา", link: "/attendance", created_at: "2026-11-06T01:35:00Z", read_at: null },
  { id: 1, kind: "schedule", title: "ประกาศตารางกะ ธันวาคม 2569 แล้ว", body: "ดูกะของคุณได้ที่เมนู ตารางกะของฉัน", link: "/my-shifts", created_at: "2026-11-05T09:00:00Z", read_at: "2026-11-05T10:00:00Z" },
];

// OT สมมติ (หน้า OT / รายงาน)
type OtDay = "normal" | "OFF" | "HOL";
type OtApproval = "pending" | "approved" | "changed" | "rejected";
export function previewOt(from: string) {
  const ym = from.slice(0, 7);
  const mk = (id: string, d: string, nh: number, nr: number | null, oh: number, or: number | null, dt: OtDay, ap: OtApproval) => ({
    user_id: id,
    work_date: `${ym}-${d}`,
    day_type: dt,
    shift_code: dt === "normal" ? "STD1" : "OFF",
    first_in: `${ym}-${d}T07:55:00+07:00`,
    last_out: `${ym}-${d}T${dt === "normal" ? "19:10" : "19:30"}:00+07:00`,
    normal_hours: nh,
    normal_rate: nr,
    ot_hours: oh,
    ot_rate: or,
    approval: ap,
    decided_by_name: ap === "approved" ? "ทดสอบ" : null,
    decided_at: ap === "approved" ? `${ym}-${d}T12:00:00Z` : null,
    note: null,
    ...PREVIEW_PEOPLE[id],
    salary_code: null,
    employment_type: "monthly_employee",
  });
  return [
    mk("p1", "02", 0, null, 2, 1.5, "normal", "approved"),
    mk("p1", "06", 8, 1, 2.5, 3, "OFF", "approved"),
    mk("p2", "03", 0, null, 1.5, 1.5, "normal", "pending"),
    mk("p2", "04", 0, null, 1, 1.5, "normal", "changed"),
  ];
}

// เบี้ยขยัน / ค่าเดินทาง / สรุปลา / ภาพรวม (สมมติ)
export function previewDiligence(start: string, end: string) {
  return [
    { user_id: "p1", period_start: start, period_end: end, absent: 0, late: 0, no_punch: 0, leave_days: 0, streak: 3, amount: 500, qualified: true, ...PREVIEW_PEOPLE.p1, salary_code: null },
    { user_id: "p2", period_start: start, period_end: end, absent: 1, late: 2, no_punch: 0, leave_days: 0, streak: 0, amount: 0, qualified: false, ...PREVIEW_PEOPLE.p2, salary_code: null },
  ];
}
export function previewTravel() {
  return [{ user_id: "p1", days: 21, amount: 630, ...PREVIEW_PEOPLE.p1, salary_code: null }];
}
export function previewLeaveSummary() {
  return [
    { user_id: "p1", leave_type: "sick", days: 1, requests: 1, ...PREVIEW_PEOPLE.p1 },
    { user_id: "p2", leave_type: "personal", days: 0.5, requests: 1, ...PREVIEW_PEOPLE.p2 },
  ];
}
export const PREVIEW_DASHBOARD = [
  { warehouse_id: W5, code: "WH5", name: "คลัง 5 (ตัวอย่าง)", headcount: 117, scheduled: 98, present: 90, late: 4, waiting: 3, absent: 1, on_leave: 4, mtd_absent: 6, mtd_leave_days: 12.5, mtd_ot_hours: 186, mtd_ot_pending: 9 },
  { warehouse_id: W32, code: "WH32", name: "คลัง 32 (ตัวอย่าง)", headcount: 74, scheduled: 60, present: 57, late: 2, waiting: 1, absent: 0, on_leave: 2, mtd_absent: 2, mtd_leave_days: 5, mtd_ot_hours: 94.5, mtd_ot_pending: 0 },
];

// ---------- Pull Operation: ตั้งค่าสมมติ (ตัวเลขตัวอย่าง) ----------
export function previewPullConfig(): import("./pull").PullConfig {
  const at = "2026-11-01T00:00:00Z";
  const skillPositions: Record<string, string[]> = {
    "RT รับ(Domestics)": ["RT"], "RT เติม(Domestics)": ["RT"], "RT จ่าย(Domestics)": ["RT"], "RT รับ(Export)": ["RT"],
    "OP ลากรับ": ["OP", "CT"], "OP ลากจ่าย": ["OP", "CT"], "CT4F": ["CT", "CT4F"], "Picker จ่าย": ["OP"],
    "เช็ครับ(Domestics)": ["Checker Receive"], "เช็คจ่าย(Domestics)": ["Checker Dispatch"], "เช็ครับ(Export)": ["Checker Receive"], "โหลดงาน": ["Team Load"],
  };
  const pull = (wh: string, names: string[]) => names.map((skill_name, i) => ({ warehouse_id: wh, skill_name, sort_order: i + 1 }));
  const types = [
    { id: "pt1", warehouse_id: W5, name: "งานรับ", unit: "pallet", sort_order: 1, is_active: true },
    { id: "pt2", warehouse_id: W5, name: "งานจ่าย พาเลทเต็ม", unit: "pallet", sort_order: 2, is_active: true },
    { id: "pt3", warehouse_id: W5, name: "งานจ่าย Picker", unit: "piece", sort_order: 3, is_active: true },
    { id: "pt4", warehouse_id: W32, name: "งานรับ Export", unit: "pallet", sort_order: 1, is_active: true },
    { id: "pt5", warehouse_id: W5, name: "งานเติม Pickface", unit: "pallet", sort_order: 4, is_active: true },
  ];
  const t = (id: string, wh: string, type: string, skill: string) => ({ id, warehouse_id: wh, workload_type_id: type, skill_name: skill, is_active: true });
  const tasks = [
    t("pk1", W5, "pt1", "RT รับ(Domestics)"), t("pk2", W5, "pt1", "OP ลากรับ"), t("pk3", W5, "pt1", "เช็ครับ(Domestics)"),
    t("pk4", W5, "pt2", "RT จ่าย(Domestics)"), t("pk5", W5, "pt2", "OP ลากจ่าย"), t("pk6", W5, "pt3", "Picker จ่าย"),
    t("pk9", W5, "pt5", "RT เติม(Domestics)"), t("pk7", W32, "pt4", "RT รับ(Export)"), t("pk8", W32, "pt4", "เช็ครับ(Export)"),
  ];
  const r = (task_id: string, wh: string, per_hour: number, effective_from = "2000-01-01") => ({ task_id, warehouse_id: wh, effective_from, per_hour, note: "ค่าตัวอย่าง", created_at: at });
  return {
    skillNames: Object.keys(skillPositions).sort((a, b) => a.localeCompare(b, "th")),
    skillPositions,
    pullSkills: [
      ...pull(W5, ["RT รับ(Domestics)", "OP ลากรับ", "เช็ครับ(Domestics)", "RT จ่าย(Domestics)", "OP ลากจ่าย", "Picker จ่าย", "RT เติม(Domestics)"]),
      ...pull(W32, ["RT รับ(Export)", "เช็ครับ(Export)", "OP ลากรับ"]),
    ],
    types,
    tasks,
    rates: [r("pk1", W5, 30), r("pk2", W5, 32), r("pk3", W5, 60), r("pk4", W5, 35), r("pk5", W5, 38), r("pk1", W5, 28, "2026-12-01"), r("pk6", W5, 180), r("pk9", W5, 18), r("pk7", W32, 30), r("pk8", W32, 60)],
    hours: (["morning", "night"] as const).flatMap((shift) => [
      { warehouse_id: W5, shift, effective_from: "2000-01-01", hours: 10, note: "ค่าตัวอย่าง", created_at: at },
      { warehouse_id: W32, shift, effective_from: "2000-01-01", hours: 9, note: "ค่าตัวอย่าง", created_at: at },
    ]),
    counts: [
      { warehouse_id: W5, skill_name: "RT รับ(Domestics)", people: 8 }, { warehouse_id: W5, skill_name: "OP ลากรับ", people: 12 },
      { warehouse_id: W5, skill_name: "Picker จ่าย", people: 18 }, { warehouse_id: W32, skill_name: "RT รับ(Export)", people: 6 },
      { warehouse_id: W32, skill_name: "OP ลากรับ", people: 5 },
    ],
  };
}

// ยอดงานสมมติของคลัง 5 (วันนี้ครบทั้งกะเช้า, กะดึกกรอกบางส่วน, พรุ่งนี้กะเช้าครบ)
export function previewPullWorkloads(today: string): import("./pull-data").WorkloadRow[] {
  const next = new Date(today + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const w = (work_date: string, shift: "morning" | "night", workload_type_id: string, volume: number) => ({ warehouse_id: W5, work_date, shift, workload_type_id, volume });
  return [
    w(today, "morning", "pt1", 1300), w(today, "morning", "pt2", 1000), w(today, "morning", "pt3", 18000), w(today, "morning", "pt5", 300),
    w(today, "night", "pt1", 850),
    w(tomorrow, "morning", "pt1", 900), w(tomorrow, "morning", "pt2", 700), w(tomorrow, "morning", "pt3", 15000), w(tomorrow, "morning", "pt5", 250),
  ];
}
