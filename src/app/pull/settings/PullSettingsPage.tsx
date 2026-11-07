"use client";

// ตั้งค่า Pull Operation 4 ขั้น (ตามสไลด์ "ตรรกะก่อนดึงคน"): ทักษะ → Productivity → ผูกประเภทงาน → ชั่วโมงต่อกะ
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Loading } from "@/components/ui";
import { BarSelect, PullBar, StepTabs } from "@/components/pull/PullUI";
import { SkillCatalog } from "@/components/pull/settings/SkillCatalog";
import { ProductivitySettings } from "@/components/pull/settings/ProductivitySettings";
import { WorkloadMapping, type TypeForm } from "@/components/pull/settings/WorkloadMapping";
import { ShiftHoursSettings } from "@/components/pull/settings/ShiftHoursSettings";
import { errText, sb } from "@/lib/supabase";
import { loadPullConfig } from "@/lib/pull-data";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { thaiDate } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { readiness, type PullConfig, type WorkloadType } from "@/lib/pull";

type Step = "skills" | "productivity" | "mapping" | "hours";
type Msg = { tone: "success" | "error"; text: string } | null;

export default function PullSettingsPage() {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const today = todayIso();
  const opts = useOptions(["pull_unit"]);
  const units = useMemo(() => (opts.pull_unit ?? []).filter((u) => u.is_active), [opts]);
  const unitLabel = useCallback((v: string) => opts.pull_unit?.find((u) => u.value === v)?.label ?? v, [opts]);

  const active = useMemo(() => warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true })), [warehouses]);
  const manageable = useMemo(() => (isGlobal(profile.role) ? active : active.filter((w) => myWarehouseIds.includes(w.id))), [active, myWarehouseIds, profile.role]);
  const [wh, setWh] = useState("");
  const curWh = manageable.some((w) => w.id === wh) ? wh : (manageable.find((w) => w.id === profile.warehouse_id) ?? manageable[0])?.id ?? "";

  const [cfg, setCfg] = useState<PullConfig | null>(null);
  const [version, setVersion] = useState(0); // เปลี่ยนเมื่อบันทึก ให้ฟอร์มรีเซ็ตเป็นค่าล่าสุด
  const [step, setStep] = useState<Step>("skills");
  const [msg, setMsg] = useState<Msg>(null);

  // โหลดตอนเปิดหน้า (โหมดตัวอย่างใช้ข้อมูลสมมติ)
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c = demo ? demo.previewPullConfig() : await loadPullConfig();
        if (live) setCfg(c);
      } catch (e) {
        if (live) setMsg({ tone: "error", text: errText(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [demo]);

  async function reload() {
    setCfg(await loadPullConfig());
    setVersion((v) => v + 1);
  }

  /** บันทึก: ของจริงเรียกคำสั่งในฐานข้อมูลแล้วโหลดใหม่ / โหมดตัวอย่างแก้เฉพาะบนจอ */
  async function run(text: string, real: () => Promise<void>, local: (c: PullConfig) => PullConfig): Promise<boolean> {
    setMsg(null);
    try {
      if (demo) {
        setCfg((c) => (c ? local(c) : c));
        setVersion((v) => v + 1);
        setMsg({ tone: "success", text: `${text} (โหมดตัวอย่าง ไม่ได้บันทึกจริง)` });
      } else {
        await real();
        await reload();
        setMsg({ tone: "success", text });
      }
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
      return false;
    }
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await sb().rpc(fn, args);
    if (error) throw error;
  };

  if (!cfg) return <AppShell title="ตั้งค่า Pull Operation" minRole="admin" wide>{msg ? <Alert tone="error">{msg.text}</Alert> : <Loading />}</AppShell>;

  const r = curWh ? readiness(cfg, curWh, today) : null;
  const steps: { key: Step; label: string; done: boolean }[] = [
    { key: "skills", label: "ทักษะที่ดึงได้", done: !!r?.skills },
    { key: "productivity", label: "Productivity", done: !!r?.productivity },
    { key: "mapping", label: "ผูกประเภทงาน", done: !!r?.mapping },
    { key: "hours", label: "ชั่วโมงต่อกะ", done: !!r?.hours },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const titles: Record<Step, string> = {
    skills: "ตั้งค่าทักษะ (Skill Catalogue)",
    productivity: "ตั้งค่า Productivity Target",
    mapping: "ผูกประเภทงานกับทักษะ",
    hours: "ตั้งค่าชั่วโมงทำงานต่อกะ",
  };
  const k = `${curWh}-${version}`;

  return (
    <AppShell title="ตั้งค่า Pull Operation" minRole="admin" wide>
      <PullBar title={titles[step]} sub={`ตั้งค่าครั้งเดียว ใช้คำนวณคนที่ต้องการทุกวัน · พร้อม ${doneCount}/4 ขั้น`}>
        <BarSelect label="คลัง" value={curWh} onChange={setWh}>
          {manageable.map((w) => (
            <option key={w.id} value={w.id}>{w.code}</option>
          ))}
        </BarSelect>
      </PullBar>

      {manageable.length === 0 ? (
        <Alert tone="warning">คุณยังไม่มีคลังที่ตั้งค่าได้</Alert>
      ) : (
        <>
          <StepTabs steps={steps} active={step} onChange={(s) => { setStep(s); setMsg(null); }} />
          {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

          {step === "skills" && (
            <SkillCatalog
              key={k}
              cfg={cfg}
              wh={curWh}
              warehouses={active}
              canEdit
              onSave={(skills) =>
                run(
                  "บันทึกทักษะที่ดึงได้แล้ว",
                  () => rpc("set_pull_skills", { p_wh: curWh, p_skills: skills }),
                  (c) => ({ ...c, pullSkills: [...c.pullSkills.filter((s) => s.warehouse_id !== curWh), ...skills.map((s, i) => ({ warehouse_id: curWh, skill_name: s, sort_order: i + 1 }))] }),
                )
              }
            />
          )}

          {step === "productivity" && (
            <ProductivitySettings
              key={k}
              cfg={cfg}
              wh={curWh}
              today={today}
              canEdit
              unitLabel={unitLabel}
              onGoMapping={() => setStep("mapping")}
              onSave={(from, rates, note) =>
                run(
                  `บันทึก Productivity ${rates.length} รายการแล้ว (เริ่มใช้ ${from === today ? "วันนี้" : thaiDate(from)})`,
                  () => rpc("set_pull_rates", { p_wh: curWh, p_from: from, p_rates: rates, p_note: note || null }),
                  (c) => ({
                    ...c,
                    rates: [
                      ...c.rates.filter((x) => !(x.effective_from === from && rates.some((y) => y.task_id === x.task_id))),
                      ...rates.map((y) => ({ task_id: y.task_id, warehouse_id: curWh, effective_from: from, per_hour: y.per_hour, note: note || null, created_at: new Date().toISOString() })),
                    ],
                  }),
                )
              }
              onDeleteFuture={(taskId, from) =>
                run(
                  "ลบค่าที่ตั้งล่วงหน้าแล้ว",
                  () => rpc("delete_pull_future", { p_kind: "rate", p_wh: curWh, p_from: from, p_task: taskId }),
                  (c) => ({ ...c, rates: c.rates.filter((x) => !(x.task_id === taskId && x.effective_from === from)) }),
                )
              }
            />
          )}

          {step === "mapping" && (
            <WorkloadMapping
              key={k}
              cfg={cfg}
              wh={curWh}
              today={today}
              units={units}
              canEdit
              onGoSkills={() => setStep("skills")}
              onSave={(f: TypeForm) =>
                run(
                  f.id ? `บันทึก “${f.name}” แล้ว` : `เพิ่ม “${f.name}” แล้ว`,
                  async () => {
                    const { data, error } = await sb().rpc("save_pull_workload_type", { p_id: f.id, p_wh: curWh, p_name: f.name, p_unit: f.unit, p_sort: f.sort_order, p_active: f.is_active });
                    if (error) throw error;
                    await rpc("set_pull_type_skills", { p_type: data as string, p_skills: f.skills });
                  },
                  (c) => {
                    const id = f.id ?? `demo-${Date.now()}`;
                    const type: WorkloadType = { id, warehouse_id: curWh, name: f.name, unit: f.unit, sort_order: f.sort_order, is_active: f.is_active };
                    const old = c.tasks.filter((x) => x.workload_type_id === id);
                    const tasks = [
                      ...c.tasks.filter((x) => x.workload_type_id !== id),
                      ...old.map((x) => ({ ...x, is_active: f.skills.includes(x.skill_name) })),
                      ...f.skills.filter((s) => !old.some((x) => x.skill_name === s)).map((s) => ({ id: `demo-${id}-${s}`, warehouse_id: curWh, workload_type_id: id, skill_name: s, is_active: true })),
                    ];
                    return { ...c, types: [...c.types.filter((x) => x.id !== id), type], tasks };
                  },
                )
              }
            />
          )}

          {step === "hours" && (
            <ShiftHoursSettings
              key={k}
              cfg={cfg}
              wh={curWh}
              warehouses={manageable}
              today={today}
              canEditWh={() => true}
              onSave={(from, rows, note) =>
                run(
                  `บันทึกชั่วโมงต่อกะ ${rows.length} คลังแล้ว (เริ่มใช้ ${from === today ? "วันนี้" : thaiDate(from)})`,
                  async () => {
                    for (const x of rows) await rpc("set_pull_shift_hours", { p_wh: x.wh, p_from: from, p_morning: x.morning, p_night: x.night, p_note: note || null });
                  },
                  (c) => ({
                    ...c,
                    hours: [
                      ...c.hours.filter((h) => !(h.effective_from === from && rows.some((x) => x.wh === h.warehouse_id))),
                      ...rows.flatMap((x) =>
                        (["morning", "night"] as const).map((shift) => ({ warehouse_id: x.wh, shift, effective_from: from, hours: x[shift], note: note || null, created_at: new Date().toISOString() })),
                      ),
                    ],
                  }),
                )
              }
              onDeleteFuture={(w, from) =>
                run(
                  "ลบค่าที่ตั้งล่วงหน้าแล้ว",
                  () => rpc("delete_pull_future", { p_kind: "hours", p_wh: w, p_from: from }),
                  (c) => ({ ...c, hours: c.hours.filter((h) => !(h.warehouse_id === w && h.effective_from === from)) }),
                )
              }
            />
          )}
        </>
      )}
    </AppShell>
  );
}
