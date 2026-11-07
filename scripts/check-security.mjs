// ตรวจความปลอดภัยของฐานข้อมูลจริงแบบอ่านอย่างเดียว: RLS, สิทธิ์ของคนที่ไม่ได้ล็อกอิน, สิทธิ์เรียกฟังก์ชัน
// ใช้: npm run db:security
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const e = process.env;
const c = new pg.Client({ connectionString: e.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
let bad = 0;
const rls = await c.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`);
for (const r of rls.rows) if (!r.relrowsecurity) { bad++; console.log("RLS ปิดอยู่:", r.relname); }
console.log(`ตารางทั้งหมด ${rls.rows.length} ตาราง เปิด RLS ${rls.rows.filter((r) => r.relrowsecurity).length}`);
const anonT = await c.query(`select table_name, string_agg(privilege_type, ',') p from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' group by 1`);
for (const r of anonT.rows) { bad++; console.log("anon ยังมีสิทธิ์ตาราง:", r.table_name, r.p); }
const fns = await c.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, p.prosecdef secdef, coalesce(array_to_string(p.proconfig, ','), '') cfg
  from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`);
for (const f of fns.rows) {
  if (f.anon) { bad++; console.log("anon เรียกฟังก์ชันได้:", f.proname); }
  if (f.secdef && !f.cfg.includes("search_path")) { bad++; console.log("security definer ไม่ได้ล็อก search_path:", f.proname); }
}
console.log(`ฟังก์ชัน ${fns.rows.length} ตัว | authenticated เรียกได้: ${fns.rows.filter((f) => f.auth).map((f) => f.proname).join(", ")}`);
await c.end();
// ลองอ่านผ่าน API ด้วยกุญแจสาธารณะโดยไม่ล็อกอิน
const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
for (const t of ["profiles", "warehouses", "audit_logs", "dropdown_options", "user_warehouses", "skills", "employee_skills", "headcount_budgets", "shift_schedules", "schedule_months", "holidays", "app_settings", "attendance_punches", "attendance_corrections", "leave_requests", "leave_approvals", "leave_quota_overrides", "ot_approvals", "notifications", "schedule_group_order", "pull_skills", "pull_workload_types", "pull_tasks", "pull_task_rates", "pull_shift_hours", "pull_workloads"]) {
  const { data, error } = await anon.from(t).select("*").limit(1);
  const blocked = !!error || (data ?? []).length === 0;
  if (!blocked) bad++;
  console.log(`API ไม่ล็อกอิน อ่าน ${t}:`, error ? "ถูกปฏิเสธ" : `${data.length} แถว`);
}
const r = await anon.rpc("set_user_access", { p_user: "00000000-0000-0000-0000-000000000000", p_role: "super_admin", p_home: null });
console.log("API ไม่ล็อกอิน เรียก set_user_access:", r.error ? "ถูกปฏิเสธ" : "ผ่าน (อันตราย!)");
if (!r.error) bad++;
for (const [fn, args] of [["team_schedule", { p_month: "2026-01-01" }], ["apply_shifts", { p_wh: "00000000-0000-0000-0000-000000000000", p_rows: [], p_source: "x" }], ["schedule_history", { p_wh: "00000000-0000-0000-0000-000000000000", p_month: "2026-01-01" }], ["punch", { p_kind: "in", p_lat: 13, p_lng: 100 }], ["submit_leave", { p_type: "sick", p_start: "2026-01-01", p_end: "2026-01-01", p_period: "full", p_reason: "x" }], ["warehouse_attendance", { p_wh: "00000000-0000-0000-0000-000000000000", p_from: "2026-01-01", p_to: "2026-01-01" }], ["decide_ot", { p_items: [], p_approve: true }], ["dashboard_summary", { p_date: "2026-01-01" }], ["run_jobs", {}], ["mark_notifications_read", {}], ["set_group_order", { p_wh: "00000000-0000-0000-0000-000000000000", p_positions: [] }], ["set_pull_skills", { p_wh: "00000000-0000-0000-0000-000000000000", p_skills: [] }], ["set_pull_rates", { p_wh: "00000000-0000-0000-0000-000000000000", p_from: "2026-01-01", p_rates: [] }], ["set_pull_shift_hours", { p_wh: "00000000-0000-0000-0000-000000000000", p_from: "2026-01-01", p_morning: 8, p_night: 8 }], ["pull_skill_counts", {}], ["pull_rate_at", { p_task: "00000000-0000-0000-0000-000000000000", p_date: "2026-01-01" }], ["save_pull_workloads", { p_wh: "00000000-0000-0000-0000-000000000000", p_date: "2026-01-01", p_shift: "morning", p_items: [] }], ["pull_requirements", { p_wh: "00000000-0000-0000-0000-000000000000", p_date: "2026-01-01", p_shift: "morning" }], ["pull_requirement_rows", { p_wh: "00000000-0000-0000-0000-000000000000", p_date: "2026-01-01", p_shift: "morning" }]]) {
  const x = await anon.rpc(fn, args);
  console.log(`API ไม่ล็อกอิน เรียก ${fn}:`, x.error ? "ถูกปฏิเสธ" : "ผ่าน (อันตราย!)");
  if (!x.error) bad++;
}
console.log(bad ? `พบปัญหา ${bad} จุด` : "ผ่านทั้งหมด");
process.exit(bad ? 1 : 0);
