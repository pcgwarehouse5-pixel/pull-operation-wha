// โหลดข้อมูล Pull Operation จาก Supabase (ใช้ร่วมกันทุกหน้าของ Pull)
import { fetchAll, sb } from "./supabase";
import { DEFAULT_MEETINGS, MEETING_KEYS, isHm, type Meetings } from "./pull";
import type { Booking, NetRow, PoolPerson, PullConfig, PullShift, PullSkillRow, PullTask, ShiftHours, SkillCount, SkillReq, TaskRate, WorkloadType } from "./pull";
import type { HistoryRow } from "./warehouse3d/placement";

export type WorkloadRow = { warehouse_id: string; work_date: string; shift: PullShift; workload_type_id: string; volume: number };

export async function loadPullConfig(): Promise<PullConfig> {
  const [skills, pullSkills, types, tasks, rates, hours, counts] = await Promise.all([
    fetchAll<{ name: string; position: string }>((f, t) => sb().from("skills").select("name, position").eq("is_active", true).order("name").order("position").range(f, t)),
    fetchAll<PullSkillRow>((f, t) => sb().from("pull_skills").select("warehouse_id, skill_name, sort_order").order("warehouse_id").order("sort_order").range(f, t)),
    // ประเภทงานที่ลบแล้วเก็บไว้เป็นประวัติ ไม่แสดงในหน้าใด
    fetchAll<WorkloadType>((f, t) => sb().from("pull_workload_types").select("*").is("deleted_at", null).order("sort_order").order("name").range(f, t)),
    fetchAll<PullTask>((f, t) => sb().from("pull_tasks").select("id, warehouse_id, workload_type_id, skill_name, is_active").order("id").range(f, t)),
    fetchAll<TaskRate>((f, t) => sb().from("pull_task_rates").select("task_id, warehouse_id, effective_from, per_hour, note, created_at").order("task_id").order("effective_from").range(f, t)),
    fetchAll<ShiftHours>((f, t) => sb().from("pull_shift_hours").select("warehouse_id, shift, effective_from, hours, note, created_at").order("warehouse_id").order("effective_from").range(f, t)),
    sb().rpc("pull_skill_counts"),
  ]);
  if (counts.error) throw counts.error;
  const skillPositions: Record<string, string[]> = {};
  for (const s of skills) (skillPositions[s.name] ??= []).push(s.position);
  return {
    skillNames: Object.keys(skillPositions).sort((a, b) => a.localeCompare(b, "th")),
    skillPositions,
    pullSkills,
    types,
    tasks,
    rates: rates.map((r) => ({ ...r, per_hour: Number(r.per_hour) })),
    hours: hours.map((h) => ({ ...h, hours: Number(h.hours) })),
    counts: ((counts.data ?? []) as SkillCount[]).map((c) => ({ ...c, people: Number(c.people) })),
  };
}

/** เวลาประชุมเริ่มงานของแต่ละกะ ณ วันที่ (ค่าล่าสุดที่เริ่มใช้ไม่เกินวันนั้น · ตั้งผิดรูปแบบใช้ค่าเริ่มต้น) */
export async function loadMeetings(date: string): Promise<Meetings> {
  const { data, error } = await sb()
    .from("app_settings")
    .select("key, value")
    .in("key", Object.values(MEETING_KEYS))
    .lte("effective_from", date)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  const pick = (k: string, d: string) => {
    const v = (data ?? []).find((r) => r.key === k)?.value;
    return isHm(v) ? v : d;
  };
  return { morning: pick(MEETING_KEYS.morning, DEFAULT_MEETINGS.morning), night: pick(MEETING_KEYS.night, DEFAULT_MEETINGS.night) };
}

/** ยอดงานของคลังในช่วงวันที่ (ดึงทีละหน้าจนครบ) */
export async function loadWorkloads(wh: string, from: string, to: string): Promise<WorkloadRow[]> {
  const rows = await fetchAll<WorkloadRow>((f, t) =>
    sb()
      .from("pull_workloads")
      .select("warehouse_id, work_date, shift, workload_type_id, volume")
      .eq("warehouse_id", wh)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date")
      .order("shift")
      .order("workload_type_id")
      .range(f, t),
  );
  return rows.map((r) => ({ ...r, volume: Number(r.volume) }));
}

/** ยอดงานของวัน/กะหนึ่ง เป็น { ประเภทงาน: ยอด } */
export function volumesFor(rows: WorkloadRow[], date: string, shift: PullShift): Record<string, number> {
  return Object.fromEntries(rows.filter((r) => r.work_date === date && r.shift === shift).map((r) => [r.workload_type_id, r.volume]));
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** คลังกลางพร้อมสถานะของวัน/กะ (มุมมองของคลังปลายทาง) */
export async function loadPool(wh: string, date: string, shift: PullShift): Promise<PoolPerson[]> {
  const { data, error } = await sb().rpc("pull_pool", { p_to_wh: wh, p_date: date, p_shift: shift });
  if (error) throw error;
  return ((data ?? []) as PoolPerson[]).map((p) => ({ ...p, skills: p.skills ?? [], start_min: p.start_min === null ? null : Number(p.start_min) }));
}

/** การจองเข้าคลังนี้ของวัน/กะ (เฉพาะที่ยังไม่ยกเลิก) */
/** ตำแหน่งบนแผนที่ 3D ที่คลังนี้เคยวางไว้ล่าสุด (ใช้หาจุดของแต่ละตำแหน่ง) · 500 แถวล่าสุดพอสำหรับหลายรอบ */
export async function loadMapHistory(wh: string): Promise<HistoryRow[]> {
  const { data, error } = await sb()
    .from("pull_bookings")
    .select("skill_name, work_date, shift, map_x, map_y, map_at")
    .eq("to_warehouse_id", wh)
    .not("map_x", "is", null)
    .order("map_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as HistoryRow[];
}

export async function loadBookings(wh: string, date: string, shift: PullShift): Promise<Booking[]> {
  const { data, error } = await sb()
    .from("pull_bookings")
    .select("id, work_date, shift, user_id, from_warehouse_id, to_warehouse_id, skill_name, status, break_time, booked_at, map_x, map_y")
    .eq("to_warehouse_id", wh)
    .eq("work_date", date)
    .eq("shift", shift)
    .eq("status", "booked")
    .order("booked_at");
  if (error) throw error;
  return (data ?? []) as Booking[];
}

/** ความต้องการต่อทักษะจากฐานข้อมูล */
export async function loadRequirements(wh: string, date: string, shift: PullShift): Promise<SkillReq[]> {
  const { data, error } = await sb().rpc("pull_requirements", { p_wh: wh, p_date: date, p_shift: shift });
  if (error) throw error;
  return ((data ?? []) as SkillReq[]).map((x) => ({ ...x, fte: x.fte === null ? null : Number(x.fte), required: x.required === null ? null : Number(x.required) }));
}

/** ภาพรวมทุกคลังช่วงวันที่ (Dashboard ผู้บริหาร) */
export async function loadNetwork(from: string, to: string, shift: PullShift | "all"): Promise<NetRow[]> {
  const { data, error } = await sb().rpc("pull_network", { p_from: from, p_to: to, p_shift: shift });
  if (error) throw error;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return ((data ?? []) as NetRow[]).map((r) => ({
    ...r,
    pool_count: Number(r.pool_count),
    on_leave: Number(r.on_leave),
    need: n(r.need),
    short: n(r.short),
    booked: Number(r.booked),
    pulled_in: Number(r.pulled_in),
    lent_out: Number(r.lent_out),
  }));
}

/** หมายเหตุ "คนที่เหลือ" ของวัน/กะ (ทุกคลังเห็น) · user_id → หมายเหตุ */
export type LeftoverNote = { user_id: string; note: string; updated_at: string };
export async function loadLeftoverNotes(date: string, shift: PullShift): Promise<Map<string, LeftoverNote>> {
  const list = await fetchAll<LeftoverNote>((f, t) =>
    sb().from("pull_leftover_notes").select("user_id, note, updated_at").eq("work_date", date).eq("shift", shift).order("user_id").range(f, t),
  );
  return new Map(list.map((n) => [n.user_id, n]));
}

/** ใส่/แก้/ลบ (ข้อความว่าง) หมายเหตุให้หลายคนพร้อมกัน */
export async function saveLeftoverNotes(date: string, shift: PullShift, users: string[], note: string): Promise<number> {
  const { data, error } = await sb().rpc("set_pull_leftover_notes", { p_date: date, p_shift: shift, p_users: users, p_note: note });
  if (error) throw error;
  return data as number;
}
