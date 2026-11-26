"use client";

// ช่องกรอกข้อความหัวฟอร์มใบลงเวลา (หน้าตั้งค่า → กฎและอัตรา → ใบลงเวลา)
import { Field, inputCls } from "./ui";
import type { FormTexts, TimesheetForm, WhTexts } from "@/lib/timesheet";

const EMPTY_WH: WhTexts = { mou_dept: "", mou_ul: "", thai_dept: "", thai_ul: "" };

export function TimesheetFormFields({ value, onChange, warehouses }: { value: TimesheetForm; onChange: (v: TimesheetForm) => void; warehouses: { code: string; name: string }[] }) {
  const setForm = (k: "mou" | "thai", patch: Partial<FormTexts>) => onChange({ ...value, [k]: { ...value[k], ...patch } });
  const setWh = (code: string, patch: Partial<WhTexts>) => onChange({ ...value, wh: { ...value.wh, [code]: { ...EMPTY_WH, ...value.wh[code], ...patch } } });
  const notes = (k: "mou" | "thai") => (
    <Field label="หมายเหตุท้ายฟอร์ม (บรรทัดละ 1 ข้อ)">
      <textarea className={`${inputCls} min-h-28`} value={value[k].notes.join("\n")} onChange={(e) => setForm(k, { notes: e.target.value.split("\n").slice(0, 8) })} />
    </Field>
  );
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2 rounded-xl p-3 ring-1 ring-line">
        <legend className="px-1 font-semibold">ฟอร์ม MOU (ครึ่งเดือน)</legend>
        <Field label="ชื่อบริษัท (บรรทัดแรก)"><input className={inputCls} maxLength={200} value={value.mou.company} onChange={(e) => setForm("mou", { company: e.target.value })} /></Field>
        <Field label="ชื่อฟอร์ม"><input className={inputCls} maxLength={300} value={value.mou.title} onChange={(e) => setForm("mou", { title: e.target.value })} /></Field>
        <Field label="เรื่อง"><input className={inputCls} maxLength={200} value={value.mou.subject ?? ""} onChange={(e) => setForm("mou", { subject: e.target.value })} /></Field>
        <Field label="เรียน"><input className={inputCls} maxLength={200} value={value.mou.to ?? ""} onChange={(e) => setForm("mou", { to: e.target.value })} /></Field>
        {notes("mou")}
      </fieldset>
      <fieldset className="space-y-2 rounded-xl p-3 ring-1 ring-line">
        <legend className="px-1 font-semibold">ฟอร์มคนไทย (เต็มเดือน)</legend>
        <Field label="ชื่อบริษัท (บรรทัดแรก)"><input className={inputCls} maxLength={200} value={value.thai.company} onChange={(e) => setForm("thai", { company: e.target.value })} /></Field>
        <Field label="ชื่อฟอร์ม"><input className={inputCls} maxLength={300} value={value.thai.title} onChange={(e) => setForm("thai", { title: e.target.value })} /></Field>
        {notes("thai")}
      </fieldset>
      {warehouses.map((w) => {
        const v = { ...EMPTY_WH, ...value.wh[w.code] };
        return (
          <fieldset key={w.code} className="rounded-xl p-3 ring-1 ring-line">
            <legend className="px-1 font-semibold">{w.name}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Field label="MOU: ฝ่าย/แผนก"><input className={inputCls} maxLength={100} value={v.mou_dept} onChange={(e) => setWh(w.code, { mou_dept: e.target.value })} /></Field>
              <Field label="MOU: UL"><input className={inputCls} maxLength={30} value={v.mou_ul} onChange={(e) => setWh(w.code, { mou_ul: e.target.value })} /></Field>
              <Field label="คนไทย: สังกัดแผนก/ฝ่าย"><input className={inputCls} maxLength={100} value={v.thai_dept} onChange={(e) => setWh(w.code, { thai_dept: e.target.value })} /></Field>
              <Field label="คนไทย: UL"><input className={inputCls} maxLength={30} value={v.thai_ul} onChange={(e) => setWh(w.code, { thai_ul: e.target.value })} /></Field>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
