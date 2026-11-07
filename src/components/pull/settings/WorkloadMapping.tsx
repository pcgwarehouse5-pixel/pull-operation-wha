"use client";

// ขั้นที่ 3 ผูกประเภทงานกับทักษะ: งานแต่ละประเภท ใช้คนทักษะไหน นับด้วยหน่วยอะไร
// Productivity ตั้งเป็นหน่วยเดียวกับประเภทงานเสมอ ระบบจึงกันกรอกผิดหน่วยให้
import { useState } from "react";
import { Alert, Button, Card, Field, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SkillIcon, Toggle } from "@/components/pull/PullUI";
import { num, rateOf, readiness, skillStyle, type PullConfig, type WorkloadType } from "@/lib/pull";
import type { DropdownOption } from "@/lib/types";

export type TypeForm = { id: string | null; name: string; unit: string; sort_order: number; is_active: boolean; skills: string[] };

export function WorkloadMapping({
  cfg,
  wh,
  today,
  units,
  canEdit,
  onSave,
  onGoSkills,
}: {
  cfg: PullConfig;
  wh: string;
  today: string;
  units: DropdownOption[];
  canEdit: boolean;
  onSave: (f: TypeForm) => Promise<boolean>;
  onGoSkills: () => void;
}) {
  const [form, setForm] = useState<TypeForm | null>(null);
  const unitLabel = (v: string) => units.find((u) => u.value === v)?.label ?? v;
  const types = cfg.types.filter((t) => t.warehouse_id === wh).sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order);
  const pulled = cfg.pullSkills.filter((s) => s.warehouse_id === wh).sort((a, b) => a.sort_order - b.sort_order).map((s) => s.skill_name);
  const tasksOf = (t: WorkloadType) => cfg.tasks.filter((k) => k.workload_type_id === t.id && k.is_active);
  const r = readiness(cfg, wh, today);

  const edit = (t: WorkloadType | null) =>
    setForm(
      t
        ? { id: t.id, name: t.name, unit: t.unit, sort_order: t.sort_order, is_active: t.is_active, skills: tasksOf(t).map((k) => k.skill_name) }
        : { id: null, name: "", unit: units[0]?.value ?? "", sort_order: (types.at(-1)?.sort_order ?? 0) + 1, is_active: true, skills: [] },
    );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-brand">ประเภทงาน → หน่วยนับ → ทักษะที่ใช้ → Productivity</h2>
            <p className="text-[14px] text-muted">หัวหน้างานกรอกแค่ยอดงานตามประเภทงาน ระบบรู้เองว่าต้องใช้คนทักษะไหน และใช้ Productivity ตัวไหนคำนวณ</p>
          </div>
          {canEdit && (
            <Button onClick={() => edit(null)}>
              <Icon name="plus" size={20} /> เพิ่มประเภทงาน
            </Button>
          )}
        </div>

        <div className="mt-4 hidden grid-cols-[minmax(0,1.2fr)_1.5rem_6rem_1.5rem_minmax(0,2fr)] items-center gap-2 px-2 text-center text-[15px] font-bold text-ink lg:grid">
          <span>ประเภทงาน</span>
          <span />
          <span>หน่วยนับ</span>
          <span />
          <span>ทักษะที่ใช้ · Productivity</span>
        </div>

        <ul className="mt-2 space-y-3">
          {types.map((t) => {
            const tasks = tasksOf(t);
            return (
              <li key={t.id} className={`rounded-2xl p-3 ring-1 ring-line ${t.is_active ? "bg-white" : "bg-paper opacity-70"}`}>
                <div className="grid items-center gap-2 lg:grid-cols-[minmax(0,1.2fr)_1.5rem_6rem_1.5rem_minmax(0,2fr)]">
                  <div className="flex items-center gap-3 rounded-xl bg-paper p-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                      <Icon name={t.unit === "pallet" ? "box" : "cart"} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] leading-snug font-bold break-words text-ink">{t.name}</span>
                      {!t.is_active && <span className="text-[13px] text-muted">ปิดใช้งาน (ไม่นำไปคำนวณ)</span>}
                    </span>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => edit(t)} aria-label={`แก้ไข ${t.name}`}>
                        แก้ไข
                      </Button>
                    )}
                  </div>
                  <Icon name="arrow" size={22} className="mx-auto hidden text-muted lg:block" />
                  <span className="flex min-h-11 items-center justify-center rounded-xl bg-paper px-3 font-semibold text-ink">{unitLabel(t.unit)}</span>
                  <Icon name="arrow" size={22} className="mx-auto hidden text-muted lg:block" />
                  <div className="flex flex-wrap gap-2">
                    {tasks.length === 0 && <span className="rounded-xl bg-[#fff6d6] px-3 py-2 text-[14px] font-semibold text-[#8a6500]">ยังไม่ได้เลือกทักษะ</span>}
                    {tasks.map((k) => {
                      const rate = rateOf(cfg, k.id, today);
                      const st = skillStyle(k.skill_name);
                      return (
                        <span key={k.id} className="flex items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5 ring-1" style={{ background: st.tint, borderColor: st.color }}>
                          <SkillIcon name={k.skill_name} size={32} />
                          <span className="text-[15px] font-semibold text-ink">{k.skill_name}</span>
                          <span className="text-[15px] font-bold" style={{ color: st.color }}>
                            {rate ? `${num(rate.per_hour)} ${unitLabel(t.unit)}/ชม.` : "ยังไม่ตั้ง"}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
          {types.length === 0 && <li className="py-8 text-center text-muted">ยังไม่มีประเภทงาน กด “เพิ่มประเภทงาน”</li>}
        </ul>

        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[#fff3e6] p-4 ring-1 ring-[#f3c89a]">
          <Icon name="alert" size={26} className="shrink-0 text-[#d9480f]" />
          <p className="text-[15px] font-semibold text-[#9a3412]">
            หน่วยของปริมาณงาน ต้องตรงกับหน่วยของ Productivity — ระบบตั้ง Productivity เป็นหน่วยของประเภทงานให้อัตโนมัติ
            และล็อกหน่วยไว้เมื่อตั้ง Productivity แล้ว
          </p>
        </div>
      </Card>

      {r.skillsWithoutTask.length > 0 && (
        <Alert tone="warning">
          ทักษะที่เปิดให้ดึงแต่ยังไม่มีประเภทงาน: {r.skillsWithoutTask.join(", ")} · กด “แก้ไข” ที่ประเภทงานแล้วเลือกทักษะ หรือปิดทักษะนั้นใน{" "}
          <button type="button" className="font-semibold underline" onClick={onGoSkills}>ขั้นที่ 1</button>
        </Alert>
      )}

      {form && (
        <TypeEditor
          form={form}
          pulled={pulled}
          units={units}
          locked={!!form.id && cfg.rates.some((x) => cfg.tasks.some((k) => k.id === x.task_id && k.workload_type_id === form.id))}
          onClose={() => setForm(null)}
          onSave={async (f) => {
            if (await onSave(f)) setForm(null);
          }}
          onGoSkills={onGoSkills}
        />
      )}
    </div>
  );
}

function TypeEditor({ form, pulled, units, locked, onClose, onSave, onGoSkills }: { form: TypeForm; pulled: string[]; units: DropdownOption[]; locked: boolean; onClose: () => void; onSave: (f: TypeForm) => Promise<void>; onGoSkills: () => void }) {
  const [f, setF] = useState(form);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const extra = f.skills.filter((s) => !pulled.includes(s)); // ทักษะที่ผูกไว้แต่ปิดในขั้นที่ 1 แล้ว

  async function submit() {
    if (!f.name.trim()) return setErr("กรุณาใส่ชื่อประเภทงาน");
    if (!f.unit) return setErr("กรุณาเลือกหน่วยนับ");
    setErr("");
    setBusy(true);
    await onSave({ ...f, name: f.name.trim(), skills: f.skills.filter((s) => pulled.includes(s)) });
    setBusy(false);
  }

  return (
    <Modal title={f.id ? "แก้ไขประเภทงาน" : "เพิ่มประเภทงาน"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="ชื่อประเภทงาน" hint="เช่น งานรับสินค้าเข้า, งานหยิบจ่าย, งานโหลดสินค้า">
          <input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="หน่วยนับ" hint={locked ? "ล็อกแล้ว เพราะตั้ง Productivity ไว้แล้ว (ถ้าจะใช้หน่วยอื่น ให้สร้างประเภทงานใหม่)" : "หน่วยที่หัวหน้างานกรอกยอดงาน และหน่วยของ Productivity"}>
          <select className={inputCls} value={f.unit} disabled={locked} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {units.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </Field>
        <div>
          <p className="mb-2 font-semibold text-ink">ทักษะที่ใช้ทำงานนี้ (เลือกได้หลายทักษะ)</p>
          {pulled.length === 0 ? (
            <Alert tone="warning">
              ยังไม่ได้เปิดทักษะให้คลังนี้ดึง <button type="button" className="font-semibold underline" onClick={onGoSkills}>ไปขั้นที่ 1</button>
            </Alert>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {pulled.map((s) => {
                const on = f.skills.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF({ ...f, skills: on ? f.skills.filter((x) => x !== s) : [...f.skills, s] })}
                    className={`flex min-h-12 items-center gap-2 rounded-xl px-2 text-left ring-1 ${on ? "bg-sky ring-brand" : "bg-white ring-line"}`}
                  >
                    <SkillIcon name={s} size={32} />
                    <span className="min-w-0 flex-1 text-[15px] font-semibold">{s}</span>
                    {on && <Icon name="check" size={20} className="text-brand" />}
                  </button>
                );
              })}
            </div>
          )}
          {extra.length > 0 && <p className="mt-2 text-[14px] text-muted">ทักษะที่ปิดในขั้นที่ 1 แล้วจะถูกเอาออก: {extra.join(", ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 font-semibold">
            <Toggle on={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="เปิดใช้งาน" />
            {f.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
          </label>
          <label className="flex items-center gap-2 font-semibold">
            ลำดับ
            <input type="number" className={`${inputCls} w-24`} value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) || 0 })} />
          </label>
        </div>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
        </div>
      </div>
    </Modal>
  );
}
