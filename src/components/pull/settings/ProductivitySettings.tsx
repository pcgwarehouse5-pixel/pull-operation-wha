"use client";

// ขั้นที่ 2 ตั้งค่า Productivity Target: มาตรฐานผลผลิตต่อคน ต่อชั่วโมง (บันทึกพร้อมวันที่เริ่มใช้ ค่าเก่าเก็บเป็นประวัติ)
import { useMemo, useState } from "react";
import { Alert, Button, Card, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SkillIcon, fromLabel } from "@/components/pull/PullUI";
import { SaveBar } from "@/components/pull/SaveBar";
import { activeTasks, hoursOf, nextChange, num, parsePositive, perShift, rateOf, skillStyle, type PullConfig, type PullTask } from "@/lib/pull";

export function ProductivitySettings({
  cfg,
  wh,
  today,
  canEdit,
  unitLabel,
  onSave,
  onDeleteFuture,
  onGoMapping,
}: {
  cfg: PullConfig;
  wh: string;
  today: string;
  canEdit: boolean;
  unitLabel: (v: string) => string;
  onSave: (from: string, rates: { task_id: string; per_hour: number }[], note: string) => Promise<boolean>;
  onDeleteFuture: (taskId: string, from: string) => Promise<boolean>;
  onGoMapping: () => void;
}) {
  const typeOf = useMemo(() => new Map(cfg.types.map((t) => [t.id, t])), [cfg]);
  const order = useMemo(() => new Map(cfg.pullSkills.filter((s) => s.warehouse_id === wh).map((s) => [s.skill_name, s.sort_order])), [cfg, wh]);
  const tasks = useMemo(
    () =>
      activeTasks(cfg, wh).sort(
        (a, b) => (order.get(a.skill_name) ?? 0) - (order.get(b.skill_name) ?? 0) || (typeOf.get(a.workload_type_id)?.sort_order ?? 0) - (typeOf.get(b.workload_type_id)?.sort_order ?? 0),
      ),
    [cfg, wh, order, typeOf],
  );
  const initial = useMemo(() => Object.fromEntries(tasks.map((k) => [k.id, rateOf(cfg, k.id, today)?.per_hour?.toString() ?? ""])), [tasks, cfg, today]);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<PullTask | null>(null);

  const morning = hoursOf(cfg, wh, "morning", today)?.hours ?? null;
  const night = hoursOf(cfg, wh, "night", today)?.hours ?? null;
  const changed = tasks.filter((k) => (vals[k.id] ?? "") !== (initial[k.id] ?? ""));
  const invalid = changed.filter((k) => parsePositive(vals[k.id] ?? "", 100000) === null);
  const pulledNoTask = cfg.pullSkills.filter((s) => s.warehouse_id === wh && !tasks.some((k) => k.skill_name === s.skill_name)).map((s) => s.skill_name);

  async function save() {
    if (invalid.length) return;
    setBusy(true);
    const ok = await onSave(from, changed.map((k) => ({ task_id: k.id, per_hour: parsePositive(vals[k.id], 100000)! })), note);
    setBusy(false);
    if (ok) setNote("");
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-brand">มาตรฐานผลผลิตต่อคน ต่อชั่วโมง</h2>
            <p className="text-[14px] text-muted">
              1 คน ทำได้กี่หน่วยต่อชั่วโมง ใช้เป็นตัวหารหลักของการคำนวณคน · ตั้งสูงเกินจริง = คนขาด · ตั้งต่ำเกินจริง = คนล้น
            </p>
          </div>
          <p className="rounded-xl bg-paper px-3 py-2 text-[14px] text-ink">
            ชั่วโมงต่อกะ: <b>เช้า {num(morning)}</b> · <b>ดึก {num(night)}</b> ชม.
          </p>
        </div>

        {tasks.length === 0 ? (
          <div className="mt-4">
            <Alert tone="warning">
              ยังไม่มีงานให้ตั้ง Productivity · ไปขั้นที่ 3 ผูกประเภทงานกับทักษะก่อน{" "}
              <button type="button" className="font-semibold underline" onClick={onGoMapping}>ไปขั้นที่ 3</button>
            </Alert>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-line">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_5rem_9rem_minmax(0,1.3fr)_3rem] items-center gap-3 bg-sky px-4 py-3 text-[14px] font-bold text-ink lg:grid">
              <span>ทักษะ</span>
              <span>ประเภทงาน</span>
              <span>หน่วยนับ</span>
              <span className="text-center">เป้าหมาย / ชม. / คน</span>
              <span>1 คน ทำได้ / กะ</span>
              <span className="sr-only">ประวัติ</span>
            </div>
            <ul>
              {tasks.map((k) => {
                const type = typeOf.get(k.workload_type_id)!;
                const unit = unitLabel(type.unit);
                const cur = rateOf(cfg, k.id, today);
                const next = nextChange(cfg.rates.filter((r) => r.task_id === k.id), today);
                const typed = vals[k.id] ?? "";
                const v = parsePositive(typed, 100000);
                const bad = typed !== (initial[k.id] ?? "") && v === null;
                const color = skillStyle(k.skill_name).color;
                return (
                  <li key={k.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_5rem_9rem_minmax(0,1.3fr)_3rem]">
                    <span className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                      <SkillIcon name={k.skill_name} size={42} />
                      <span className="min-w-0">
                        <span className="block truncate text-[17px] font-bold text-ink">{k.skill_name}</span>
                        <span className="block text-[13px] text-muted lg:hidden">{type.name} · {unit}</span>
                      </span>
                    </span>
                    <span className="hidden truncate text-[15px] lg:block">{type.name}</span>
                    <span className="hidden text-[15px] lg:block">{unit}</span>
                    <button type="button" onClick={() => setHistory(k)} className="row-start-1 col-start-3 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-paper lg:col-start-6 lg:row-start-auto" aria-label={`ประวัติ Productivity ${k.skill_name}`}>
                      <Icon name="history" size={22} />
                    </button>
                    <label className="col-span-3 flex items-center gap-2 lg:col-span-1 lg:col-start-4 lg:row-start-1">
                      <span className="w-24 shrink-0 text-[14px] text-muted lg:sr-only">เป้าหมาย/ชม.</span>
                      <input
                        inputMode="decimal"
                        className={`${inputCls} text-center text-xl font-bold ${bad ? "ring-2 ring-bad" : ""}`}
                        style={{ color }}
                        value={typed}
                        disabled={!canEdit}
                        placeholder="ยังไม่ตั้ง"
                        aria-label={`Productivity ${k.skill_name} ${type.name} (${unit}/ชม.)`}
                        onChange={(e) => setVals((s) => ({ ...s, [k.id]: e.target.value }))}
                      />
                    </label>
                    <span className="col-span-3 text-[15px] lg:col-span-1 lg:col-start-5 lg:row-start-1">
                      <span className="text-xl font-bold text-muted">{num(perShift(v ?? cur?.per_hour, morning))}</span> {unit}
                      <span className="block text-[13px] text-muted">
                        กะเช้า {num(morning)} ชม.{night !== morning ? ` · ดึก ${num(perShift(v ?? cur?.per_hour, night))}` : ""}
                        {cur ? ` · เริ่มใช้ ${fromLabel(cur.effective_from)}` : ""}
                      </span>
                      {next && (
                        <span className="mt-1 inline-block rounded-lg bg-[#fff6d6] px-2 py-0.5 text-[13px] font-semibold text-[#8a6500]">
                          ตั้งล่วงหน้า {num(next.per_hour)} เริ่ม {fromLabel(next.effective_from)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {pulledNoTask.length > 0 && tasks.length > 0 && (
          <div className="mt-3">
            <Alert tone="warning">
              ทักษะที่เปิดให้ดึงแต่ยังไม่ได้ผูกกับประเภทงาน (คำนวณคนไม่ได้): {pulledNoTask.join(", ")}{" "}
              <button type="button" className="font-semibold underline" onClick={onGoMapping}>ไปผูกงาน</button>
            </Alert>
          </div>
        )}
      </Card>

      <Card className="bg-sky">
        <div className="flex gap-3">
          <Icon name="bulb" size={28} className="shrink-0 text-warn" />
          <p className="text-[15px] text-ink">
            <b>ที่มาของตัวเลข:</b> ค่าเริ่มต้นมาจาก Excel “Merge WHA 2025” ชีตสรุปคน Avg (ผลงานจริง ม.ค.–ต.ค. 68) ทบทวนเป็นระยะ ·
            ค่าใหม่มีผลตั้งแต่วันที่เริ่มใช้ ผลคำนวณของวันก่อนหน้ายังใช้ค่าเดิม
          </p>
        </div>
      </Card>

      {changed.length > 0 && canEdit && (
        <SaveBar
          text={invalid.length ? `ตัวเลขไม่ถูกต้อง ${invalid.length} ช่อง (ต้องมากกว่า 0)` : `แก้ไข ${changed.length} รายการ`}
          busy={busy || invalid.length > 0}
          onCancel={() => setVals(initial)}
          onSave={save}
        >
          <label className="flex items-center gap-2 text-[14px] font-semibold whitespace-nowrap text-muted">
            เริ่มใช้
            <input type="date" className={`${inputCls} min-h-10 w-40`} min={today} value={from} onChange={(e) => setFrom(e.target.value || today)} />
          </label>
          <input className={`${inputCls} min-h-10 w-full sm:w-48`} placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </SaveBar>
      )}

      {history && (
        <RateHistory
          task={history}
          cfg={cfg}
          today={today}
          unit={unitLabel(typeOf.get(history.workload_type_id)?.unit ?? "")}
          canEdit={canEdit}
          onClose={() => setHistory(null)}
          onDelete={async (f) => {
            if (await onDeleteFuture(history.id, f)) setHistory(null);
          }}
        />
      )}
    </div>
  );
}

function RateHistory({ task, cfg, today, unit, canEdit, onClose, onDelete }: { task: PullTask; cfg: PullConfig; today: string; unit: string; canEdit: boolean; onClose: () => void; onDelete: (from: string) => void }) {
  const list = cfg.rates.filter((r) => r.task_id === task.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const cur = rateOf(cfg, task.id, today);
  return (
    <Modal title={`ประวัติ Productivity · ${task.skill_name}`} onClose={onClose}>
      {list.length === 0 && <p className="text-muted">ยังไม่เคยตั้งค่า</p>}
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.effective_from} className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${r === cur ? "bg-sky ring-brand/30" : "ring-line"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">{num(r.per_hour)} {unit}/ชม.</p>
              <p className="text-[14px] text-muted">
                เริ่มใช้ {fromLabel(r.effective_from)}
                {r === cur ? " · ใช้อยู่ตอนนี้" : r.effective_from > today ? " · ตั้งล่วงหน้า" : " · ค่าเก่า"}
                {r.note ? ` · ${r.note}` : ""}
              </p>
            </div>
            {canEdit && r.effective_from > today && (
              <Button variant="ghost" size="sm" onClick={() => onDelete(r.effective_from)} aria-label="ลบค่าที่ตั้งล่วงหน้า">
                <Icon name="trash" size={18} /> ลบ
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[14px] text-muted">ค่าที่เริ่มใช้แล้วลบไม่ได้ ถ้าจะเปลี่ยนให้บันทึกค่าใหม่พร้อมวันที่เริ่มใช้</p>
    </Modal>
  );
}
