"use client";

// ส่วนที่ใช้ร่วมกันในหน้าตารางกะ
import { useMemo, useState } from "react";
import { inputCls } from "../ui";
import { fmtMinutes, type ShiftDef } from "@/lib/shifts";

export type Emp = {
  id: string;
  employee_code: string;
  title: string | null;
  first_name_th: string;
  last_name_th: string | null;
  nickname: string | null;
  position: string | null;
  status: "active" | "resigned";
  exclude_from_shift: boolean;
  warehouse_id: string | null;
  role?: string;
};

export const EMP_COLS = "id, employee_code, title, first_name_th, last_name_th, nickname, position, status, exclude_from_shift, warehouse_id, role";

/** อยู่ในตารางกะหัวหน้าคลังไหม (ตรงกับ public.is_lead ในฐานข้อมูล) */
export const isLeadEmp = (e: Pick<Emp, "position" | "role">, leadPositions: string[]) =>
  e.role === "dept_manager" || (!!e.position && leadPositions.includes(e.position));

export const empName = (e: Pick<Emp, "first_name_th" | "nickname">) => (e.nickname ? `${e.first_name_th} (${e.nickname})` : e.first_name_th);

export type Holiday = { holiday_date: string; name: string };

/** ป้ายรหัสกะแบบมีสี */
export function ShiftChip({ def, code, selected, onClick, title, showLabel }: { def?: ShiftDef; code: string; selected?: boolean; onClick?: () => void; title?: string; showLabel?: boolean }) {
  const style = def ? { background: def.bg, color: def.text } : { background: "#94a3b8", color: "#fff" };
  const cls = `inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-[15px] font-bold whitespace-nowrap ${selected ? "ring-4 ring-ink/70 ring-offset-2" : ""}`;
  const body = (
    <>
      {def && !def.working ? def.label : code}
      {showLabel && def?.working && <span className="text-[12px] font-medium opacity-90">{def.label !== code ? def.label : ""}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={selected} title={title}>
      {body}
    </button>
  ) : (
    <span className={cls} style={style} title={title}>
      {body}
    </span>
  );
}

/** เลือกพนักงานหลายคน (ค่าเริ่มต้น = ทุกคนที่แสดงอยู่) */
export function PeoplePicker({ emps, value, onChange }: { emps: Emp[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const set = useMemo(() => new Set(value), [value]);
  const list = emps.filter((e) => !q || `${e.employee_code} ${e.first_name_th} ${e.last_name_th ?? ""} ${e.nickname ?? ""} ${e.position ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(set.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="rounded-xl ring-1 ring-line">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-3.5 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-semibold">
          พนักงาน {value.length === emps.length ? `ทุกคน (${emps.length})` : `${value.length} จาก ${emps.length} คน`}
        </span>
        <span className="text-[14px] text-brand">{open ? "ซ่อน" : "เลือกเอง"}</span>
      </button>
      {open && (
        <div className="border-t border-line p-2">
          <div className="mb-2 flex gap-2">
            <input className={`${inputCls} !min-h-10`} placeholder="ค้นหา" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="shrink-0 rounded-lg px-2 text-[14px] font-semibold text-brand" onClick={() => onChange([...new Set([...value, ...list.map((e) => e.id)])])}>
              เลือกทั้งหมด
            </button>
            <button type="button" className="shrink-0 rounded-lg px-2 text-[14px] font-semibold text-brand" onClick={() => onChange(value.filter((v) => !list.some((e) => e.id === v)))}>
              ไม่เลือก
            </button>
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {list.map((e) => (
              <li key={e.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-paper">
                  <input type="checkbox" className="h-5 w-5 accent-brand" checked={set.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="min-w-0 flex-1 truncate">{empName(e)}</span>
                  <span className="text-[13px] text-muted">{e.position ?? "-"}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** เลือกช่วงวันที่ในเดือน */
export function DayRange({ dates, from, to, onChange }: { dates: string[]; from: number; to: number; onChange: (from: number, to: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        <span className="mb-1 block text-[14px] font-semibold">ตั้งแต่วันที่</span>
        <select className={inputCls} value={from} onChange={(e) => onChange(Number(e.target.value), Math.max(Number(e.target.value), to))}>
          {dates.map((d, i) => (
            <option key={d} value={i}>{i + 1}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[14px] font-semibold">ถึงวันที่</span>
        <select className={inputCls} value={to} onChange={(e) => onChange(Math.min(from, Number(e.target.value)), Number(e.target.value))}>
          {dates.map((d, i) => (
            <option key={d} value={i}>{i + 1}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** คำอธิบายสีช่องในตารางกะ: OFF 2 สี และการมาทำงานวันหยุด (ได้ OT) */
export function DayColorLegend() {
  const items: [string, string, string, string][] = [
    ["#ff0000", "#fff", "OFF", "วันหยุดประจำสัปดาห์ · ถ้าให้มาทำงาน = ได้ OT"],
    ["#facc15", "#16204a", "OFF", "วันหยุดที่บริษัทให้พิเศษ · เปลี่ยนเป็นวันทำงาน = ไม่ได้ OT"],
    ["#dc2626", "#fff", "08:00", "แดงทั้งช่อง = มาทำงานวัน OFF แดง (ได้ OT)"],
    ["#7c3aed", "#fff", "08:00", "ม่วง = วันหยุดประจำปี / มาทำงานวันหยุดประจำปี (ได้ OT อัตโนมัติ)"],
  ];
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[13px] text-muted" aria-label="ความหมายของสี">
      {items.map(([bg, fg, t, d]) => (
        <li key={d} className="flex items-center gap-1.5">
          <span className="num inline-flex h-6 min-w-11 items-center justify-center rounded-md px-1 text-[11px] font-bold" style={{ background: bg, color: fg }}>{t}</span>
          {d}
        </li>
      ))}
    </ul>
  );
}

/** ป้ายกะแบบเวลา สำหรับหน้าของพนักงาน: กะทำงาน = 08:00–17:00 · วันหยุด = ชื่อ (OFF) · ไม่แสดงรหัสกะ */
export function ShiftTimeChip({ def, code, color, big }: { def?: ShiftDef; code: string; color?: { bg: string; text: string }; big?: boolean }) {
  const c = color ?? (def ? { bg: def.bg, text: def.text } : { bg: "#94a3b8", text: "#fff" });
  const text = def?.working && def.start !== null && def.end !== null ? `${fmtMinutes(def.start)}–${fmtMinutes(def.end)}` : def?.label || code;
  return (
    <span className={`num inline-flex items-center rounded-xl px-3 font-bold whitespace-nowrap ${big ? "min-h-12 text-[20px]" : "min-h-10 text-[16px]"}`} style={{ background: c.bg, color: c.text }}>
      {text}
    </span>
  );
}
