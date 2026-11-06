"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageIntro, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SkillsManager } from "@/components/SkillsManager";
import { HolidaysManager } from "@/components/HolidaysManager";
import { RulesManager } from "@/components/RulesManager";
import { errText, fetchAll, sb } from "@/lib/supabase";
import type { DropdownOption } from "@/lib/types";

// หมวดที่แก้ได้ในหน้านี้ (ผังองค์กรและการตั้งค่าช่องข้อมูลจะมีหน้าของตัวเองในโมดูลถัดไป)
const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: "position", label: "ตำแหน่ง", hint: "ตำแหน่งงานที่เลือกได้ในข้อมูลพนักงาน" },
  { key: "__skills", label: "ทักษะ", hint: "ทักษะแยกตามตำแหน่ง ใช้ติ๊กในข้อมูลพนักงาน และใช้จัดกำลังคน" },
  { key: "employment_type", label: "ประเภทพนักงาน", hint: "เช่น พนักงานรายเดือน คนงานรายวัน MOU" },
  { key: "shift_type", label: "รหัสกะ", hint: "รหัสกะพร้อมเวลาเริ่ม-เลิก และสีในตารางกะ (รหัสที่ไม่มีเวลา เช่น OFF HOL นับเป็นวันหยุด)" },
  { key: "__holidays", label: "วันหยุดนักขัตฤกษ์", hint: "ปฏิทินวันหยุดของบริษัท ใช้เติม HOL ในตารางกะ" },
  { key: "__rules", label: "กฎลงเวลา/ลา", hint: "เวลาผ่อนผัน ขั้นอนุมัติลา โควตาวันลา (ทุกค่ามีวันที่เริ่มใช้)" },
  { key: "leave_type", label: "ประเภทการลา", hint: "ใช้ในใบลา" },
  { key: "ot_reason", label: "เหตุผล OT", hint: "ตัวเลือกเหตุผลตอนขอ OT" },
  { key: "kpi_category", label: "หัวข้อ KPI", hint: "หัวข้อประเมินรายเดือน" },
  { key: "subcontractor_company", label: "บริษัทรับเหมา", hint: "บริษัทต้นสังกัดของแรงงานรับเหมา" },
];

type Form = { id?: string; value: string; label: string; sort_order: string; is_active: boolean; start_time: string; end_time: string; bg: string; extra: Record<string, unknown> };

export default function SettingsPage() {
  const { preview, demo } = useApp();
  const [cat, setCat] = useState(CATEGORIES[0].key);
  const [rows, setRows] = useState<DropdownOption[] | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const meta = CATEGORIES.find((c) => c.key === cat)!;
  const isShift = cat === "shift_type";
  const isSkills = cat === "__skills";
  const isHolidays = cat === "__holidays";
  const isRules = cat === "__rules";

  const load = useCallback(async () => {
    setRows(null);
    if (cat.startsWith("__")) return;
    if (demo) {
      setRows([...demo.PREVIEW_OPTIONS, ...demo.PREVIEW_EXTRA_OPTIONS].filter((o) => o.category === cat));
      return;
    }
    try {
      setRows(await fetchAll<DropdownOption>((from, to) => sb().from("dropdown_options").select("*").eq("category", cat).order("sort_order").order("label").range(from, to)));
    } catch (e) {
      setErr(errText(e));
    }
  }, [cat, demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนหมวด
    load();
  }, [load]);

  const openNew = () =>
    setForm({ value: "", label: "", sort_order: String((rows?.length ?? 0) + 1), is_active: true, start_time: "", end_time: "", bg: "#3b82f6", extra: {} });
  const openEdit = (o: DropdownOption) =>
    setForm({
      id: o.id,
      value: o.value,
      label: o.label,
      sort_order: String(o.sort_order),
      is_active: o.is_active,
      start_time: String(o.extra.start_time ?? ""),
      end_time: String(o.extra.end_time ?? ""),
      bg: String(o.extra.bg ?? "#3b82f6"),
      extra: o.extra,
    });

  return (
    <AppShell title="ตั้งค่าตัวเลือก" minRole="admin">
      <PageIntro
        title="ตั้งค่าตัวเลือก"
        action={
          !isSkills && !isHolidays && !isRules && (
            <Button onClick={openNew}>
              <Icon name="plus" size={20} /> เพิ่ม{meta.label}
            </Button>
          )
        }
      >
        รายการตัวเลือกที่ใช้ทั้งแอป (มีผลกับทุกคลัง)
      </PageIntro>

      <div className="-mx-3 mb-3 overflow-x-auto px-3">
        <div className="flex w-max gap-2" role="tablist" aria-label="หมวด">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={cat === c.key}
              onClick={() => setCat(c.key)}
              className={`min-h-11 rounded-full px-4 text-[15px] font-semibold ${cat === c.key ? "bg-brand text-white" : "bg-white text-ink ring-1 ring-line"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 px-1 text-[14px] text-muted">{meta.hint}</p>

      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {isSkills ? (
        <SkillsManager />
      ) : isHolidays ? (
        <HolidaysManager />
      ) : isRules ? (
        <RulesManager />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>ยังไม่มีรายการในหมวดนี้</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.id}>
              <Card className="!p-3.5">
                <div className="flex items-center gap-3">
                  {isShift && <span className="h-8 w-2 shrink-0 rounded-full" style={{ background: String(o.extra.bg ?? "#94a3b8") }} aria-hidden="true" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {o.label} {o.value !== o.label && <span className="font-normal text-muted">({o.value})</span>}
                    </p>
                    {isShift && o.extra.start_time ? (
                      <p className="text-[14px] text-muted">เวลา {String(o.extra.start_time)} - {String(o.extra.end_time)}</p>
                    ) : null}
                  </div>
                  {!o.is_active && <Badge tone="red">ปิดใช้งาน</Badge>}
                  <Button size="sm" variant="secondary" onClick={() => openEdit(o)}>แก้ไข</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {form && <OptionForm category={cat} categoryLabel={meta.label} isShift={isShift} initial={form} preview={preview} onClose={() => setForm(null)} onSaved={load} />}
    </AppShell>
  );
}

function OptionForm({ category, categoryLabel, isShift, initial, preview, onClose, onSaved }: { category: string; categoryLabel: string; isShift: boolean; initial: Form; preview: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Form, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

  async function save() {
    if (!f.value.trim() || !f.label.trim()) return setErr("กรุณาใส่รหัสและชื่อที่แสดง");
    const sort = Number(f.sort_order);
    if (!Number.isInteger(sort)) return setErr("ลำดับต้องเป็นตัวเลข");
    if (isShift && (f.start_time || f.end_time) && (!TIME.test(f.start_time) || !TIME.test(f.end_time))) return setErr("เวลาต้องเป็นแบบ 08:00");
    const extra = isShift
      ? { ...f.extra, bg: f.bg, text: "#fff", ...(f.start_time ? { start_time: f.start_time, end_time: f.end_time } : { start_time: undefined, end_time: undefined }) }
      : f.extra;
    const row = { category, value: f.value.trim(), label: f.label.trim(), sort_order: sort, is_active: f.is_active, extra: JSON.parse(JSON.stringify(extra)) };
    setBusy(true);
    setErr("");
    try {
      if (!preview) {
        const { error } = f.id
          ? await sb().from("dropdown_options").update({ label: row.label, sort_order: row.sort_order, is_active: row.is_active, extra: row.extra }).eq("id", f.id)
          : await sb().from("dropdown_options").insert(row);
        if (error) throw error;
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={f.id ? `แก้ไข${categoryLabel}` : `เพิ่ม${categoryLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="รหัส" hint={f.id ? "แก้ไม่ได้ เพราะข้อมูลเดิมอ้างถึง" : "ใช้เก็บในระบบ"}>
            <input className={inputCls} value={f.value} onChange={(e) => set("value", e.target.value)} disabled={!!f.id} maxLength={40} />
          </Field>
          <Field label="ชื่อที่แสดง">
            <input className={inputCls} value={f.label} onChange={(e) => set("label", e.target.value)} maxLength={80} />
          </Field>
        </div>
        {isShift && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="เริ่ม">
              <input type="time" className={inputCls} value={f.start_time} onChange={(e) => set("start_time", e.target.value)} />
            </Field>
            <Field label="เลิก">
              <input type="time" className={inputCls} value={f.end_time} onChange={(e) => set("end_time", e.target.value)} />
            </Field>
            <Field label="สี">
              <input type="color" className={`${inputCls} p-1`} value={f.bg} onChange={(e) => set("bg", e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="ลำดับการแสดง">
          <input className={inputCls} value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} inputMode="numeric" />
        </Field>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          เปิดใช้งาน (ปิดแล้วจะไม่แสดงให้เลือก แต่ข้อมูลเก่ายังอยู่)
        </label>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
        </div>
      </div>
    </Modal>
  );
}
