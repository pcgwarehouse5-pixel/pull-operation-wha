// โหลดข้อมูล Pull Operation จาก Supabase (ใช้ร่วมกันทุกหน้าของ Pull)
import { fetchAll, sb } from "./supabase";
import type { PullConfig, PullShift, PullSkillRow, PullTask, ShiftHours, SkillCount, TaskRate, WorkloadType } from "./pull";

export type WorkloadRow = { warehouse_id: string; work_date: string; shift: PullShift; workload_type_id: string; volume: number };

export async function loadPullConfig(): Promise<PullConfig> {
  const [skills, pullSkills, types, tasks, rates, hours, counts] = await Promise.all([
    fetchAll<{ name: string; position: string }>((f, t) => sb().from("skills").select("name, position").eq("is_active", true).order("name").order("position").range(f, t)),
    fetchAll<PullSkillRow>((f, t) => sb().from("pull_skills").select("warehouse_id, skill_name, sort_order").order("warehouse_id").order("sort_order").range(f, t)),
    fetchAll<WorkloadType>((f, t) => sb().from("pull_workload_types").select("*").order("sort_order").order("name").range(f, t)),
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
