"use client";

// ขั้นที่ 3 ผูกประเภทงานกับทักษะ: งานแต่ละประเภท ใช้คนทักษะไหน นับด้วยหน่วยอะไร
// Productivity ตั้งเป็นหน่วยเดียวกับประเภทงานเสมอ ระบบจึงกันกรอกผิดหน่วยให้
// ลบประเภทงานได้ (เก็บประวัติ: ยอดงานเดิมไม่หาย แค่ไม่แสดงและไม่ใช้คำนวณ)
// แตกยอด (migration 0037): ประเภทงานคิดยอดจาก "ยอดหลัก" × % ÷ ตัวหาร ได้ เช่น ยอดจ่ายรวม (ชิ้น) 60% ÷ 32 = พาเลท
import { useState } from "react";
import { Alert, Button, Card, Field, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SkillIcon, Toggle } from "@/components/pull/PullUI";
import { latestSplit, num, parsePositive, rateOf, readiness, skillStyle, type PullConfig, type TypeSplit, type WorkloadType } from "@/lib/pull";
import { thaiDate } from "@/lib/format";
import type { DropdownOption } from "@/lib/types";

/** กฎแตกยอดที่จะบันทึก (null = ไม่เปลี่ยน) · source = null คือกรอกเอง */
export type SplitChange = { source: string | null; share: number | null; divisor: number | null; from: string };
export type TypeForm = { id: string | null; name: string; unit: string; sort_order: number; is_active: boolean; skills: string[]; split: SplitChange | null };

/** "ยอดจ่ายรวม 60% ÷ 32" */
function splitText(cfg: PullConfig, s: TypeSplit): string {
  if (!s.source_type_id) return "กรอกเอง";
  const src = cfg.types.find((t) => t.id === s.source_type_id)?.name ?? "ยอดหลัก";
  return `${src} ${num(s.share_pct)}%${s.divisor !== 1 ? ` ÷ ${num(s.divisor)}` : ""}`;
}

export function WorkloadMapping({
  cfg,
  wh,
  today,
  units,
  canEdit,
  onSave,
  onDelete,
  onDeleteSplit,
  onGoSkills,
}: {
  cfg: PullConfig;
  wh: string;
  today: string;
  units: DropdownOption[];
  canEdit: boolean;
  onSave: (f: TypeForm) => Promise<boolean>;
  onDelete: (t: WorkloadType) => Promise<boolean>;
  onDeleteSplit: (typeId: string, from: string) => Promise<boolean>;
  onGoSkills: () => void;
}) {
  const [form, setForm] = useState<TypeForm | null>(null);
  // ลบแบบเก็บประวัติ: ถามยืนยันพร้อมบอกผลที่ตามมาก่อนทุกครั้ง
  const askDelete = async (t: WorkloadType) => {
    const ok = window.confirm(
      `ลบประเภทงาน “${t.name}”?\n\n` +
        "• จะหายจากหน้ากรอกยอดงาน และไม่นำไปคำนวณคนอีก\n" +
        "• ยอดงานที่เคยบันทึกไว้ยังเก็บในประวัติ ไม่ถูกลบ\n" +
        "• ถ้าจะใช้อีก ให้เพิ่มประเภทงานใหม่ แล้วตั้ง Productivity ใหม่",
    );
    if (ok && (await onDelete(t))) setForm(null);
  };
  const unitLabel = (v: string) => units.find((u) => u.value === v)?.label ?? v;
  const types = cfg.types.filter((t) => t.warehouse_id === wh).sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.sort_order - b.sort_order);
  const pulled = cfg.pullSkills.filter((s) => s.warehouse_id === wh).sort((a, b) => a.sort_order - b.sort_order).map((s) => s.skill_name);
  const tasksOf = (t: WorkloadType) => cfg.tasks.filter((k) => k.workload_type_id === t.id && k.is_active);
  const r = readiness(cfg, wh, today);

  const edit = (t: WorkloadType | null) =>
    setForm(
      t
        ? { id: t.id, name: t.name, unit: t.unit, sort_order: t.sort_order, is_active: t.is_active, skills: tasksOf(t).map((k) => k.skill_name), split: null }
        : { id: null, name: "", unit: units[0]?.value ?? "", sort_order: (types.at(-1)?.sort_order ?? 0) + 1, is_active: true, skills: [], split: null },
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
                      {!t.is_active && <span className="block text-[13px] text-muted">ปิดใช้งาน (ไม่นำไปคำนวณ)</span>}
                      <SplitBadge cfg={cfg} type={t} today={today} />
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 flex-row gap-1 lg:flex-col">
                        <Button variant="ghost" size="sm" onClick={() => edit(t)} aria-label={`แก้ไข ${t.name}`}>
                          แก้ไข
                        </Button>
                        <Button variant="ghost" size="sm" className="!text-bad" onClick={() => askDelete(t)} aria-label={`ลบ ${t.name}`}>
                          <Icon name="trash" size={18} /> ลบ
                        </Button>
                      </span>
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
          cfg={cfg}
          wh={wh}
          today={today}
          onDeleteSplit={onDeleteSplit}
          onClose={() => setForm(null)}
          onSave={async (f) => {
            if (await onSave(f)) setForm(null);
          }}
          onDelete={
            form.id
              ? () => {
                  const t = types.find((x) => x.id === form.id);
                  if (t) void askDelete(t);
                }
              : undefined
          }
          onGoSkills={onGoSkills}
        />
      )}
    </div>
  );
}

/** ป้ายใต้ชื่อประเภทงาน: แตกยอดจากไหน / เป็นยอดหลักของงานไหน / กฎที่ตั้งล่วงหน้า */
function SplitBadge({ cfg, type, today }: { cfg: PullConfig; type: WorkloadType; today: string }) {
  const mine = (cfg.splits ?? []).filter((s) => s.type_id === type.id);
  const now = mine.filter((s) => s.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const next = mine.filter((s) => s.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
  const kids = cfg.types.filter((t) => t.is_active && latestSplit(cfg, t.id)?.source_type_id === type.id);
  return (
    <>
      {now?.source_type_id && <span className="mt-0.5 block text-[13px] font-semibold text-brand">แตกยอดจาก {splitText(cfg, now)}</span>}
      {next && (
        <span className="mt-0.5 block text-[13px] font-semibold text-[#8a6500]">
          ตั้งแต่ {thaiDate(next.effective_from)}: {next.source_type_id ? `แตกยอดจาก ${splitText(cfg, next)}` : "กลับไปกรอกเอง"}
        </span>
      )}
      {kids.length > 0 && <span className="mt-0.5 block text-[13px] font-semibold text-ok">ยอดหลัก · แตกให้ {kids.map((k) => k.name).join(", ")}</span>}
    </>
  );
}

function TypeEditor({
  form, pulled, units, locked, cfg, wh, today, onClose, onSave, onDelete, onDeleteSplit, onGoSkills,
}: {
  form: TypeForm; pulled: string[]; units: DropdownOption[]; locked: boolean; cfg: PullConfig; wh: string; today: string;
  onClose: () => void; onSave: (f: TypeForm) => Promise<void>; onDelete?: () => void; onDeleteSplit: (typeId: string, from: string) => Promise<boolean>; onGoSkills: () => void;
}) {
  const [f, setF] = useState(form);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const extra = f.skills.filter((s) => !pulled.includes(s)); // ทักษะที่ผูกไว้แต่ปิดในขั้นที่ 1 แล้ว

  // ---- ที่มาของยอด (แตกยอดจากยอดหลัก) ----
  const splits = cfg.splits ?? [];
  const latest = form.id ? latestSplit(cfg, form.id) : null;
  const future = splits.filter((s) => s.type_id === form.id && s.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const hasSplit = (id: string) => splits.some((s) => s.type_id === id && s.source_type_id);
  const isSourceOf = form.id ? cfg.types.filter((t) => splits.some((s) => s.type_id === t.id && s.source_type_id === form.id)).map((t) => t.name) : [];
  // ยอดหลักได้เฉพาะประเภทงานที่กรอกเอง (ไม่แตกต่อเป็นทอดๆ)
  const sources = cfg.types.filter((t) => t.warehouse_id === wh && t.is_active && t.id !== form.id && !hasSplit(t.id)).sort((a, b) => a.sort_order - b.sort_order);
  const [src, setSrc] = useState<string>(latest?.source_type_id ?? "");
  const [share, setShare] = useState(latest?.share_pct ? String(latest.share_pct) : "100");
  const [div, setDiv] = useState(latest?.divisor ? String(latest.divisor) : "1");
  const [from, setFrom] = useState(today);
  const srcType = cfg.types.find((t) => t.id === src);
  const shareN = parsePositive(share, 100);
  const divN = parsePositive(div, 100000);
  const unitOf = (v?: string) => units.find((u) => u.value === v)?.label ?? v ?? "";

  async function submit() {
    if (!f.name.trim()) return setErr("กรุณาใส่ชื่อประเภทงาน");
    if (!f.unit) return setErr("กรุณาเลือกหน่วยนับ");
    let split: SplitChange | null = null;
    if (src) {
      if (shareN === null) return setErr("สัดส่วนต้องมากกว่า 0 และไม่เกิน 100");
      if (divN === null) return setErr("ตัวหารต้องมากกว่า 0 (ใส่ 1 ถ้าใช้ยอดเดิมไม่แปลงหน่วย)");
      if (src !== latest?.source_type_id || shareN !== latest?.share_pct || divN !== latest?.divisor) split = { source: src, share: shareN, divisor: divN, from };
    } else if (latest?.source_type_id) {
      split = { source: null, share: null, divisor: null, from };
    }
    if (split && (!from || from < today)) return setErr("วันที่เริ่มใช้ต้องเป็นวันนี้หรือวันถัดไป");
    setErr("");
    setBusy(true);
    await onSave({ ...f, name: f.name.trim(), skills: f.skills.filter((s) => pulled.includes(s)), split });
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
        <div className="rounded-2xl bg-paper p-3 ring-1 ring-line">
          <p className="font-semibold text-ink">ที่มาของยอดงาน</p>
          {isSourceOf.length > 0 ? (
            <p className="mt-1 text-[14px] text-muted">เป็นยอดหลักที่หัวหน้ากรอก และแตกยอดให้: {isSourceOf.join(", ")}</p>
          ) : (
            <>
              <select className={`${inputCls} mt-2`} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="ที่มาของยอดงาน">
                <option value="">หัวหน้ากรอกยอดเอง</option>
                {sources.map((t) => (
                  <option key={t.id} value={t.id}>
                    แตกยอดจาก “{t.name}” ({unitOf(t.unit)})
                  </option>
                ))}
              </select>
              {src && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="สัดส่วน (%)">
                    <input className={inputCls} inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} />
                  </Field>
                  <Field label="หารด้วย" hint="1 = ไม่แปลงหน่วย">
                    <input className={inputCls} inputMode="decimal" value={div} onChange={(e) => setDiv(e.target.value)} />
                  </Field>
                  <p className="col-span-2 rounded-xl bg-white p-2 text-[14px] text-ink">
                    ตัวอย่าง: {srcType?.name} 10,000 {unitOf(srcType?.unit)} × {num(shareN)}%{divN && divN !== 1 ? ` ÷ ${num(divN)}` : ""} ={" "}
                    <b>
                      {shareN !== null && divN !== null ? num((10000 * shareN) / 100 / divN) : "—"} {unitOf(f.unit)}
                    </b>
                  </p>
                </div>
              )}
              {(src || latest?.source_type_id) && (
                <div className="mt-3">
                  <Field label="เริ่มใช้ตั้งแต่" hint="ยอดของวันก่อนหน้านี้คิดแบบเดิม">
                    <input type="date" className={inputCls} value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                </div>
              )}
            </>
          )}
          {future.map((s) => (
            <div key={s.effective_from} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#fff6d6] p-2 text-[14px] text-[#8a6500]">
              <span className="min-w-0 flex-1">
                ตั้งล่วงหน้า: ตั้งแต่ {thaiDate(s.effective_from)} · {s.source_type_id ? `แตกยอดจาก ${splitText(cfg, s)}` : "กลับไปกรอกเอง"}
              </span>
              <Button variant="ghost" size="sm" className="!text-bad" disabled={busy} onClick={() => form.id && void onDeleteSplit(form.id, s.effective_from)}>
                <Icon name="trash" size={16} /> ลบ
              </Button>
            </div>
          ))}
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onDelete && (
            <Button variant="ghost" className="mr-auto !text-bad" onClick={onDelete} disabled={busy}>
              <Icon name="trash" size={18} /> ลบประเภทงานนี้
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</Button>
        </div>
      </div>
    </Modal>
  );
}
