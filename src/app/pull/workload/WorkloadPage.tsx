"use client";

// บันทึกปริมาณงานประจำวัน (สไลด์ "ตรรกะก่อนดึงคน" ขั้นที่ 5): กรอกยอดงานคาดการณ์ต่อวัน/กะ แล้วเห็นคนที่ต้องการทันที
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Loading, inputCls } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { BarDate, BarSelect, PullBar, SkillIcon } from "@/components/pull/PullUI";
import { usePullSelection } from "@/components/pull/usePullSelection";
import { errText, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { shortDay, thaiDate } from "@/lib/format";
import { isGlobal, ROLE_RANK } from "@/lib/types";
import { addDays, loadPullConfig, loadWorkloads, volumesFor, type WorkloadRow } from "@/lib/pull-data";
import {
  SHIFT_LABEL, activeTasks, caretAfterDigits, formatTyping, hoursOf, num, parseVolume, readiness, requirementRows, skillRequirements, skillStyle, totalRequired,
  type PullConfig, type PullShift, type WorkloadType,
} from "@/lib/pull";

type Msg = { tone: "success" | "error" | "warning"; text: string } | null;

export default function WorkloadPage() {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const today = todayIso();
  const opts = useOptions(["pull_unit"]);
  const unitLabel = (v: string) => opts.pull_unit?.find((u) => u.value === v)?.label ?? v;
  const whs = useMemo(() => {
    const act = warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true }));
    return isGlobal(profile.role) ? act : act.filter((w) => myWarehouseIds.includes(w.id));
  }, [warehouses, myWarehouseIds, profile.role]);
  const { wh, date, shift, setWh, setDate, setShift } = usePullSelection(whs, profile.warehouse_id);

  const [cfg, setCfg] = useState<PullConfig | null>(null);
  const [loads, setLoads] = useState<WorkloadRow[]>([]);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<Msg>(null);
  const from = date < addDays(today, -1) ? date : addDays(today, -1);
  const to = date > addDays(today, 5) ? date : addDays(today, 5);

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

  useEffect(() => {
    if (!wh) return;
    let live = true;
    (async () => {
      try {
        const rows = demo ? demo.previewPullWorkloads(today).filter((r) => r.warehouse_id === wh) : await loadWorkloads(wh, from, to);
        if (live) {
          setLoads(rows);
          setVersion((v) => v + 1);
        }
      } catch (e) {
        if (live) setMsg({ tone: "error", text: errText(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, wh, from, to, today]);

  const isManager = isGlobal(profile.role) || (ROLE_RANK[profile.role] >= ROLE_RANK.supervisor && myWarehouseIds.includes(wh));
  const canEdit = date >= today || isManager;
  const maxDate = addDays(today, 90);

  async function save(values: Record<string, number | null>) {
    setMsg(null);
    const items = Object.entries(values).map(([type_id, volume]) => ({ type_id, volume }));
    try {
      if (demo) {
        setLoads((rows) => [
          ...rows.filter((r) => !(r.work_date === date && r.shift === shift)),
          ...items.filter((i) => i.volume !== null).map((i) => ({ warehouse_id: wh, work_date: date, shift, workload_type_id: i.type_id, volume: i.volume! })),
        ]);
      } else {
        const { error } = await sb().rpc("save_pull_workloads", { p_wh: wh, p_date: date, p_shift: shift, p_items: items });
        if (error) throw error;
        setLoads(await loadWorkloads(wh, from, to));
      }
      setVersion((v) => v + 1);
      const missing = items.filter((i) => i.volume === null).length;
      setMsg(
        missing
          ? { tone: "warning", text: `บันทึกแล้ว แต่ยังไม่ได้กรอก ${missing} ประเภทงาน (ทักษะที่ใช้ยอดนั้นยังคำนวณไม่ได้ ถ้าไม่มีงานให้ใส่ 0)${demo ? " · โหมดตัวอย่าง" : ""}` }
          : { tone: "success", text: `บันทึกยอดงาน ${shortDay(date)} ${SHIFT_LABEL[shift]} แล้ว ระบบคำนวณคนให้อัตโนมัติ${demo ? " (โหมดตัวอย่าง ไม่ได้บันทึกจริง)" : ""}` },
      );
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
      return false;
    }
  }

  const header = (
    <PullBar title="บันทึกปริมาณงานประจำวัน" sub="กรอกเพียงยอดงานคาดการณ์ ที่เหลือระบบคิดให้">
      <BarSelect label="คลัง" value={wh} onChange={setWh}>
        {whs.map((w) => (
          <option key={w.id} value={w.id}>{w.code}</option>
        ))}
      </BarSelect>
      <BarDate value={date} onChange={setDate} max={maxDate} />
      <BarSelect label="กะ" value={shift} onChange={(v) => setShift(v as PullShift)}>
        <option value="morning">{SHIFT_LABEL.morning}{cfg && wh ? ` · ${num(hoursOf(cfg, wh, "morning", date)?.hours)} ชม.` : ""}</option>
        <option value="night">{SHIFT_LABEL.night}{cfg && wh ? ` · ${num(hoursOf(cfg, wh, "night", date)?.hours)} ชม.` : ""}</option>
      </BarSelect>
    </PullBar>
  );

  if (!cfg) return <AppShell title="บันทึกปริมาณงาน" minRole="supervisor" wide>{header}{msg ? <Alert tone="error">{msg.text}</Alert> : <Loading />}</AppShell>;
  if (!wh) return <AppShell title="บันทึกปริมาณงาน" minRole="supervisor" wide>{header}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;

  const ready = readiness(cfg, wh, date);
  const saved = volumesFor(loads, date, shift);

  return (
    <AppShell title="บันทึกปริมาณงาน" minRole="supervisor" wide>
      {header}
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!(ready.skills && ready.productivity && ready.mapping && ready.hours) && (
        <div className="mb-4">
          <Alert tone="warning">
            การตั้งค่าของคลังนี้ยังไม่ครบ บางทักษะจะยังไม่มีตัวเลข
            {ROLE_RANK[profile.role] >= ROLE_RANK.supervisor ? <> · <Link href="/pull/settings" className="font-semibold underline">ไปตั้งค่า Pull</Link></> : " · แจ้งแอดมินคลังให้ตั้งค่า"}
          </Alert>
        </div>
      )}
      {!canEdit && (
        <div className="mb-4"><Alert tone="info">วันที่ผ่านไปแล้ว ดูได้อย่างเดียว (แก้ย้อนหลังได้เฉพาะแอดมินคลัง)</Alert></div>
      )}

      <WorkloadForm key={`${wh}-${date}-${shift}-${version}`} cfg={cfg} wh={wh} date={date} shift={shift} saved={saved} canEdit={canEdit} unitLabel={unitLabel} onSave={save} />

      <PlanStrip
        cfg={cfg}
        wh={wh}
        today={today}
        loads={loads}
        selected={{ date, shift }}
        onPick={(d, s) => {
          setDate(d);
          setShift(s);
          setMsg(null);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </AppShell>
  );
}

const TYPE_ICON = (t: WorkloadType): IconName => (/เช็ค|ตรวจ/.test(t.name) ? "clipboard" : /โหลด/.test(t.name) ? "truck" : /จ่าย|หยิบ/.test(t.name) ? "cart" : /เติม/.test(t.name) ? "forklift" : "box");

function WorkloadForm({
  cfg, wh, date, shift, saved, canEdit, unitLabel, onSave,
}: {
  cfg: PullConfig; wh: string; date: string; shift: PullShift; saved: Record<string, number>; canEdit: boolean; unitLabel: (v: string) => string;
  onSave: (v: Record<string, number | null>) => Promise<boolean>;
}) {
  const types = cfg.types.filter((t) => t.warehouse_id === wh && t.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const tasks = activeTasks(cfg, wh);
  const initial = Object.fromEntries(types.map((t) => [t.id, saved[t.id] !== undefined ? formatTyping(String(saved[t.id])) : ""]));
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  // ตำแหน่งเคอร์เซอร์ที่ต้องวางคืนหลังใส่คอมมา (วางหลังหน้าจออัปเดต)
  const caret = useRef<{ id: string; pos: number } | null>(null);
  useLayoutEffect(() => {
    const c = caret.current;
    if (!c) return;
    caret.current = null;
    const el = document.getElementById(`v-${c.id}`) as HTMLInputElement | null;
    if (el && document.activeElement === el) el.setSelectionRange(c.pos, c.pos);
  });

  const parsed = Object.fromEntries(types.map((t) => [t.id, parseVolume(vals[t.id] ?? "")]));
  const bad = types.filter((t) => !parsed[t.id].ok);
  const dirty = types.some((t) => (vals[t.id] ?? "") !== initial[t.id]);
  const volumes = Object.fromEntries(types.map((t) => [t.id, parsed[t.id].value]));
  const reqs = skillRequirements(cfg, wh, requirementRows(cfg, wh, date, shift, volumes));
  const total = totalRequired(reqs);
  const hours = hoursOf(cfg, wh, shift, date)?.hours;

  async function submit() {
    if (bad.length) return;
    setBusy(true);
    await onSave(volumes);
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Card>
        <h2 className="text-xl font-bold text-brand">กรอกปริมาณงาน {shortDay(date)}</h2>
        <p className="text-[14px] text-muted">
          {thaiDate(date)} · {SHIFT_LABEL[shift]} {num(hours)} ชม. · กรอกเฉพาะปริมาณงาน ระบบคำนวณจำนวนคนที่ต้องการให้อัตโนมัติ (ไม่มีงานให้ใส่ 0)
        </p>
        {types.length === 0 && <div className="mt-4"><Alert tone="warning">ยังไม่มีประเภทงานของคลังนี้ (ตั้งที่ ตั้งค่า Pull → ผูกประเภทงาน)</Alert></div>}
        <ul className="mt-4 space-y-3">
          {types.map((t) => {
            const st = skillStyle(t.name);
            const users = tasks.filter((k) => k.workload_type_id === t.id).map((k) => k.skill_name);
            const invalid = !parsed[t.id].ok;
            return (
              <li key={t.id} className="rounded-2xl p-3 ring-1" style={{ background: st.tint, borderColor: st.color, boxShadow: `inset 0 0 0 1px ${st.color}33` }}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white" style={{ background: st.color }}>
                    <Icon name={TYPE_ICON(t)} size={26} />
                  </span>
                  <label htmlFor={`v-${t.id}`} className="min-w-0 flex-1 text-[17px] font-bold text-ink">{t.name}</label>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <input
                      id={`v-${t.id}`}
                      inputMode="decimal"
                      className={`${inputCls} min-w-0 text-center text-2xl font-bold sm:w-44 ${invalid ? "ring-2 ring-bad" : ""}`}
                      value={vals[t.id] ?? ""}
                      disabled={!canEdit}
                      placeholder="ยังไม่กรอก"
                      onChange={(e) => {
                        // ใส่คอมมาคั่นหลักพันขณะพิมพ์ แล้ววางเคอร์เซอร์หลังตัวเลขตัวเดิม
                        const el = e.target;
                        const digits = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^d.]/g, "").length;
                        const next = formatTyping(el.value);
                        caret.current = { id: t.id, pos: caretAfterDigits(next, digits) };
                        setVals((v) => ({ ...v, [t.id]: next }));
                      }}
                    />
                    <span className="w-14 shrink-0 text-[17px] font-semibold text-ink">{unitLabel(t.unit)}</span>
                  </div>
                </div>
                <p className="mt-1.5 pl-[3.75rem] text-[13px] text-muted">
                  {invalid ? <span className="font-semibold text-bad">ใส่ตัวเลข 0 ขึ้นไป</span> : users.length ? `ใช้คำนวณ: ${users.join(", ")}` : "ยังไม่ได้ผูกทักษะ (ไม่นำไปคำนวณ)"}
                </p>
              </li>
            );
          })}
        </ul>
        {canEdit && types.length > 0 && (
          <Button size="lg" className="mt-4 w-full" onClick={submit} disabled={busy || bad.length > 0}>
            <Icon name="check" size={22} /> {busy ? "กำลังบันทึก…" : dirty ? "บันทึก & คำนวณอัตโนมัติ" : "บันทึก & คำนวณอัตโนมัติ (ไม่มีการเปลี่ยนแปลง)"}
          </Button>
        )}
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold text-brand">ผลคำนวณทันที</h2>
            <p className="text-[14px] text-muted">จำนวนคนที่ต้องการ ตามปริมาณงานและ Productivity Target{dirty ? " · ยังไม่บันทึก" : ""}</p>
          </div>
          <Link href="/pull/requirements" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-2 text-[15px] font-semibold text-brand hover:bg-brand/6">
            วิธีคำนวณ <Icon name="next" size={18} />
          </Link>
        </div>
        <ul className="mt-3 space-y-2.5">
          {reqs.map((r) => {
            const st = skillStyle(r.skill_name);
            return (
              <li key={r.skill_name} className="flex items-center gap-3 rounded-2xl p-3 ring-1 ring-line" style={{ background: st.tint }}>
                <SkillIcon name={r.skill_name} size={44} />
                <span className="min-w-0 flex-1 text-[16px] leading-snug font-bold break-words text-ink">{r.skill_name}</span>
                {r.complete ? (
                  <span className="flex shrink-0 items-baseline gap-1.5 border-l border-line pl-3">
                    <span className="text-[14px] text-muted">ต้องการ</span>
                    <span className="text-4xl leading-none font-bold text-ok">{r.required}</span>
                    <span className="font-semibold text-ink">คน</span>
                  </span>
                ) : (
                  <span className="shrink-0 rounded-lg bg-[#fff6d6] px-2 py-1 text-right text-[13px] font-semibold text-[#8a6500]">— {r.missing}</span>
                )}
              </li>
            );
          })}
          {reqs.length === 0 && <li className="py-6 text-center text-muted">ยังไม่ได้เปิดทักษะที่ดึงได้</li>}
        </ul>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#e6f4ec] p-4 ring-1 ring-[#bfe3cf]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok text-white"><Icon name="users" size={26} /></span>
          <span className="flex-1 text-xl font-bold text-ink">รวมต้องการ</span>
          <span className="text-5xl leading-none font-bold text-ok">{total ?? "—"}</span>
          <span className="text-lg font-semibold text-ink">คน</span>
        </div>
        {total === null && reqs.length > 0 && <p className="mt-2 text-[13px] text-muted">รวมจะแสดงเมื่อคำนวณได้ครบทุกทักษะ (ไม่ตีค่าที่ยังไม่รู้เป็น 0)</p>}
      </Card>
    </div>
  );
}

/** แผน 7 วัน: ดูว่าวัน/กะไหนกรอกยอดแล้ว และต้องการกี่คน กดเพื่อเลือก */
function PlanStrip({ cfg, wh, today, loads, selected, onPick }: { cfg: PullConfig; wh: string; today: string; loads: WorkloadRow[]; selected: { date: string; shift: PullShift }; onPick: (d: string, s: PullShift) => void }) {
  const types = cfg.types.filter((t) => t.warehouse_id === wh && t.is_active);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 1));
  return (
    <Card className="mt-4">
      <h2 className="text-lg font-bold text-brand">แผนยอดงาน 7 วัน</h2>
      <p className="text-[14px] text-muted">กดช่องเพื่อเปิดวัน/กะนั้น · ตัวเลข = คนที่ต้องการ</p>
      <div className="-mx-1 mt-3 overflow-x-auto px-1 pb-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-1.5 text-center">
          <thead>
            <tr>
              <th className="w-16" />
              {days.map((d) => (
                <th key={d} className={`text-[14px] font-semibold ${d === today ? "text-brand" : "text-muted"}`}>{d === today ? "วันนี้" : shortDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["morning", "night"] as const).map((s) => (
              <tr key={s}>
                <th className="text-left text-[14px] font-semibold text-ink">{SHIFT_LABEL[s]}</th>
                {days.map((d) => {
                  const vols = volumesFor(loads, d, s);
                  const filled = types.filter((t) => vols[t.id] !== undefined).length;
                  const total = filled ? totalRequired(skillRequirements(cfg, wh, requirementRows(cfg, wh, d, s, vols))) : null;
                  const on = selected.date === d && selected.shift === s;
                  const tone = !filled ? "bg-paper text-muted ring-line" : filled < types.length ? "bg-[#fff6d6] text-[#8a6500] ring-[#f2dc8f]" : "bg-[#e6f4ec] text-ok ring-[#bfe3cf]";
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        onClick={() => onPick(d, s)}
                        aria-label={`${shortDay(d)} ${SHIFT_LABEL[s]}`}
                        aria-pressed={on}
                        className={`flex min-h-14 w-full flex-col items-center justify-center rounded-xl ring-1 ${tone} ${on ? "outline-3 outline-brand outline-offset-1" : ""}`}
                      >
                        <span className="text-xl leading-none font-bold">{total ?? (filled ? "—" : "·")}</span>
                        <span className="text-[11px] font-semibold">{!filled ? "ยังไม่กรอก" : filled < types.length ? `กรอก ${filled}/${types.length}` : "ครบ"}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
