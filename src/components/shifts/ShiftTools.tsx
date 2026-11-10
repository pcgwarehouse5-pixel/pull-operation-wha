"use client";

// เครื่องมือวางกะ: คัดลอกเดือนก่อน ทำซ้ำรูปแบบ เติมช่วงวันที่ วันนักขัตฤกษ์ วางกะอัตโนมัติ นำเข้า/ส่งออก ล้างเดือน ประวัติ
// ทุกเครื่องมือ (ยกเว้นล้างเดือน/ย้อนกลับ) ใส่ผลลงตารางเป็น "ยังไม่บันทึก" ให้ตรวจก่อนกดบันทึก
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../AuthProvider";
import { Alert, Badge, Button, Field, Loading, Modal, inputCls } from "../ui";
import { DayRange, PeoplePicker, type Emp, type Holiday } from "./common";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { readXlsx } from "@/lib/xlsx-read";
import { thaiDate, thaiDateTime } from "@/lib/format";
import { exportRows, parseShiftImport, templateRows, type ImportResult } from "@/lib/shift-file";
import {
  THAI_DAYS_SHORT, addMonths, copyFromPrevious, fillRange, generatePlan, holidayFill, monthDates, planChanges, repeatPattern,
  shiftTimeText, thaiMonthLabel, weekday, type Change, type Grid, type PlanResult, type ShiftDef, type ShiftNeed,
} from "@/lib/shifts";

export type ToolKey = "menu" | "copy" | "repeat" | "fill" | "holiday" | "auto" | "import" | "export" | "clear" | "history";

type Props = {
  tool: ToolKey;
  setTool: (t: ToolKey | null) => void;
  wh: string;
  whName: string;
  ym: string;
  dates: string[];
  emps: Emp[]; // คนที่แสดงอยู่ (ตามตัวกรอง)
  allEmps: Emp[];
  base: Grid;
  grid: Grid;
  defs: Map<string, ShiftDef>;
  activeDefs: ShiftDef[];
  holidays: Holiday[];
  nChanges: number;
  applyChanges: (c: Change[], onlyEmpty: boolean, source: string) => void;
  reload: () => Promise<void>;
  setMsg: (m: { tone: "success" | "error" | "warning"; text: string } | null) => void;
  scope: "staff" | "lead";
};

const MENU: { key: ToolKey; label: string; desc: string; danger?: boolean }[] = [
  { key: "auto", label: "วางกะอัตโนมัติ", desc: "ใส่จำนวนคนที่ต้องการต่อกะต่อตำแหน่ง ระบบจัดให้ เว้นวันหยุดและเวลาพัก" },
  { key: "copy", label: "คัดลอกจากเดือนก่อน", desc: "ใช้กะของ 4 สัปดาห์ก่อน (วันในสัปดาห์ตรงกัน)" },
  { key: "repeat", label: "ทำซ้ำรูปแบบ", desc: "เช่น เช้า 5 วัน หยุด 2 วัน วนจนสิ้นเดือน" },
  { key: "fill", label: "เติมกะหลายคน", desc: "กะเดียวกัน ช่วงวันที่/วันในสัปดาห์ที่เลือก เช่น หยุดทุกวันอาทิตย์" },
  { key: "holiday", label: "เติมวันนักขัตฤกษ์", desc: "ใส่ HOL ตามปฏิทินวันหยุดในหน้าตั้งค่า" },
  { key: "import", label: "นำเข้าจาก Excel/CSV", desc: "ตารางผลัดแบบเดิม (ชื่อ + เวลาเข้า เช่น 8, 20) แม่แบบ หรือไฟล์ที่ส่งออกจากแอป" },
  { key: "export", label: "ส่งออกเป็น CSV", desc: "เปิดใน Excel ได้ (เฉพาะคนที่แสดงอยู่)" },
  { key: "history", label: "ประวัติและย้อนกลับ", desc: "ย้อนการบันทึกหลายช่อง หรือคืนเดือนที่ล้างไป" },
  { key: "clear", label: "ล้างตารางกะทั้งเดือน", desc: "ลบทุกช่องของเดือนนี้ในคลังนี้ (เก็บสำเนาไว้ ย้อนคืนได้)", danger: true },
];

export function ShiftTools(p: Props) {
  const close = () => p.setTool(null);
  const done = (c: Change[], onlyEmpty: boolean, text: string) => {
    p.applyChanges(c, onlyEmpty, p.tool);
    p.setMsg({ tone: "warning", text: `${text} ตรวจในตารางแล้วกด "บันทึก" (ยังไม่บันทึก)` });
    close();
  };
  switch (p.tool) {
    case "menu":
      return (
        <Modal title="เครื่องมือวางกะ" onClose={close}>
          <ul className="space-y-2">
            {MENU.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  onClick={() => (m.key === "export" ? exportCsv(p) : p.setTool(m.key))}
                  className={`w-full rounded-2xl px-4 py-3 text-left ring-1 ring-line hover:bg-paper ${m.danger ? "text-bad" : ""}`}
                >
                  <span className="block font-semibold">{m.label}</span>
                  <span className="block text-[14px] text-muted">{m.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      );
    case "copy":
      return <CopyTool {...p} close={close} done={done} />;
    case "repeat":
      return <RepeatTool {...p} close={close} done={done} />;
    case "fill":
      return <FillTool {...p} close={close} done={done} />;
    case "holiday":
      return <HolidayTool {...p} close={close} done={done} />;
    case "auto":
      return <AutoPlanTool {...p} close={close} done={done} />;
    case "import":
      return <ImportTool {...p} close={close} done={done} />;
    case "clear":
      return <ClearTool {...p} close={close} />;
    case "history":
      return <HistoryTool {...p} close={close} />;
    default:
      return null;
  }
}

type ToolProps = Props & { close: () => void; done: (c: Change[], onlyEmpty: boolean, text: string) => void };

function Footer({ onCancel, onOk, ok, disabled }: { onCancel: () => void; onOk: () => void; ok: string; disabled?: boolean }) {
  return (
    <div className="mt-5 flex gap-2">
      <Button variant="secondary" className="flex-1" onClick={onCancel}>ยกเลิก</Button>
      <Button className="flex-1" onClick={onOk} disabled={disabled}>{ok}</Button>
    </div>
  );
}

function OnlyEmpty({ value, onChange, children }: { value: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input type="checkbox" className="h-5 w-5 accent-brand" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{children ?? "เติมเฉพาะช่องที่ยังว่าง (ไม่ทับกะที่มีอยู่)"}</span>
    </label>
  );
}

function ShiftSelect({ defs, value, onChange, allowDelete, label = "กะ" }: { defs: ShiftDef[]; value: string; onChange: (v: string) => void; allowDelete?: boolean; label?: string }) {
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {defs.map((d) => (
          <option key={d.code} value={d.code}>
            {d.code} {shiftTimeText(d) || (d.label !== d.code ? d.label : "")}
          </option>
        ))}
        {allowDelete && <option value="">(ลบกะ)</option>}
      </select>
    </Field>
  );
}

// ---------- ส่งออก ----------
function exportCsv(p: Props) {
  const rows = exportRows(p.emps, p.dates, p.grid, (c) => !!p.defs.get(c)?.working);
  downloadCsv(`ตารางกะ_${p.whName.replace(/\s+/g, "")}_${p.ym}.csv`, rows);
  p.setMsg({ tone: "success", text: `ส่งออก ${p.emps.length} คนแล้ว${p.nChanges ? " (รวมช่องที่ยังไม่บันทึก)" : ""}` });
  p.setTool(null);
}

// ---------- คัดลอกจากเดือนก่อน ----------
function CopyTool(p: ToolProps) {
  const { demo } = useApp();
  const [people, setPeople] = useState(p.emps.map((e) => e.id));
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const prev = addMonths(p.ym, -1);

  async function run() {
    setBusy(true);
    setErr("");
    try {
      const prevDates = monthDates(prev);
      const rows = demo
        ? demo.previewShifts(prevDates)
        : await fetchAll<{ user_id: string; work_date: string; shift_code: string; holiday_work: "OFF" | "HOL" | null; is_volunteer: boolean }>((f, t) =>
            sb()
              .from("shift_schedules")
              .select("user_id, work_date, shift_code, holiday_work, is_volunteer, profiles!inner(warehouse_id)")
              .eq("profiles.warehouse_id", p.wh)
              .gte("work_date", prevDates[0])
              .lt("work_date", p.ym + "-01")
              .order("user_id")
              .order("work_date")
              .range(f, t),
          );
      const src: Grid = {};
      for (const r of rows) (src[r.user_id] ??= {})[r.work_date] = { shift_code: r.shift_code, holiday_work: r.holiday_work, is_volunteer: r.is_volunteer };
      const changes = copyFromPrevious(src, people, p.dates);
      if (!changes.length) {
        setBusy(false);
        return setErr(`ไม่พบตารางกะของ${thaiMonthLabel(prev)}สำหรับคนที่เลือก`);
      }
      p.done(changes, onlyEmpty, `คัดลอกจาก${thaiMonthLabel(prev)}แล้ว`);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`คัดลอกจาก${thaiMonthLabel(prev)}`} onClose={p.close}>
      <p className="mb-3 text-[15px] text-muted">แต่ละวันใช้กะของวันเดียวกันเมื่อ 4 สัปดาห์ก่อน วันในสัปดาห์จึงตรงกัน และรอบหมุนกะต่อเนื่อง</p>
      <div className="space-y-3">
        <PeoplePicker emps={p.emps} value={people} onChange={setPeople} />
        <OnlyEmpty value={onlyEmpty} onChange={setOnlyEmpty} />
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <Footer onCancel={p.close} onOk={run} ok={busy ? "กำลังคัดลอก..." : "คัดลอก"} disabled={busy || !people.length} />
    </Modal>
  );
}

// ---------- ทำซ้ำรูปแบบ ----------
function RepeatTool(p: ToolProps) {
  const first = p.activeDefs.find((d) => d.working)?.code ?? p.activeDefs[0]?.code ?? "";
  const off = p.activeDefs.find((d) => d.code === "OFF")?.code ?? p.activeDefs.find((d) => !d.working)?.code ?? first;
  const [people, setPeople] = useState(p.emps.map((e) => e.id));
  const [start, setStart] = useState(0);
  const [pattern, setPattern] = useState([{ code: first, days: 5 }, { code: off, days: 2 }]);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const total = pattern.reduce((s, x) => s + (x.days || 0), 0);
  const set = (i: number, v: Partial<{ code: string; days: number }>) => setPattern(pattern.map((x, j) => (j === i ? { ...x, ...v } : x)));

  return (
    <Modal title="ทำซ้ำรูปแบบ" onClose={p.close}>
      <div className="space-y-3">
        <PeoplePicker emps={p.emps} value={people} onChange={setPeople} />
        <Field label="เริ่มวันที่">
          <select className={inputCls} value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {p.dates.map((d, i) => (
              <option key={d} value={i}>{i + 1} ({THAI_DAYS_SHORT[weekday(d)]})</option>
            ))}
          </select>
        </Field>
        <div>
          <p className="mb-1.5 text-[15px] font-semibold">รูปแบบ (วนซ้ำ {total} วัน)</p>
          <ul className="space-y-2">
            {pattern.map((x, i) => (
              <li key={i} className="flex items-center gap-2">
                <select className={`${inputCls} flex-1`} value={x.code} onChange={(e) => set(i, { code: e.target.value })} aria-label={`กะที่ ${i + 1}`}>
                  {p.activeDefs.map((d) => (
                    <option key={d.code} value={d.code}>{d.code} {shiftTimeText(d)}</option>
                  ))}
                </select>
                <input type="number" min={1} max={31} className={`${inputCls} !w-20`} value={x.days} onChange={(e) => set(i, { days: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} aria-label="จำนวนวัน" />
                <span className="text-[14px]">วัน</span>
                <Button size="sm" variant="ghost" onClick={() => setPattern(pattern.filter((_, j) => j !== i))} disabled={pattern.length < 2} aria-label="ลบ">✕</Button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setPattern([...pattern, { code: first, days: 1 }])}>+ เพิ่มขั้น</Button>
        </div>
        <OnlyEmpty value={onlyEmpty} onChange={setOnlyEmpty} />
      </div>
      <Footer
        onCancel={p.close}
        ok="ใส่ลงตาราง"
        disabled={!people.length || !total}
        onOk={() => p.done(repeatPattern(pattern, people, p.dates, start), onlyEmpty, "ใส่รูปแบบแล้ว")}
      />
    </Modal>
  );
}

// ---------- เติมกะหลายคน ----------
function FillTool(p: ToolProps) {
  const [people, setPeople] = useState(p.emps.map((e) => e.id));
  const [code, setCode] = useState(p.activeDefs[0]?.code ?? "");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(p.dates.length - 1);
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const picked = p.dates.slice(from, to + 1).filter((d) => days.includes(weekday(d)));

  return (
    <Modal title="เติมกะหลายคน" onClose={p.close}>
      <div className="space-y-3">
        <PeoplePicker emps={p.emps} value={people} onChange={setPeople} />
        <ShiftSelect defs={p.activeDefs} value={code} onChange={setCode} allowDelete />
        <DayRange dates={p.dates} from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <div>
          <p className="mb-1.5 text-[15px] font-semibold">เฉพาะวัน</p>
          <div className="flex flex-wrap gap-1.5">
            {THAI_DAYS_SHORT.map((n, i) => (
              <button
                key={n}
                type="button"
                aria-pressed={days.includes(i)}
                onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                className={`h-11 w-11 rounded-xl font-semibold ${days.includes(i) ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {code && <OnlyEmpty value={onlyEmpty} onChange={setOnlyEmpty} />}
        <p className="text-[14px] text-muted">{picked.length} วัน × {people.length} คน</p>
      </div>
      <Footer
        onCancel={p.close}
        ok="ใส่ลงตาราง"
        disabled={!people.length || !picked.length}
        onOk={() => p.done(fillRange(code || null, people, picked), !!code && onlyEmpty, code ? `เติม ${code} แล้ว` : "ลบกะช่วงที่เลือกแล้ว")}
      />
    </Modal>
  );
}

// ---------- เติมวันนักขัตฤกษ์ ----------
function HolidayTool(p: ToolProps) {
  const nonWork = p.activeDefs.filter((d) => !d.working);
  const [people, setPeople] = useState(p.emps.map((e) => e.id));
  const [code, setCode] = useState(nonWork.find((d) => d.code === "HOL")?.code ?? nonWork[0]?.code ?? "");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  return (
    <Modal title="เติมวันนักขัตฤกษ์" onClose={p.close}>
      {!p.holidays.length ? (
        <>
          <Alert tone="info">{thaiMonthLabel(p.ym)}ไม่มีวันหยุดในปฏิทิน (แอดมินเพิ่มได้ที่ ตั้งค่าตัวเลือก → วันหยุดนักขัตฤกษ์)</Alert>
          <Button variant="secondary" className="mt-4 w-full" onClick={p.close}>ปิด</Button>
        </>
      ) : (
        <>
          <ul className="mb-3 space-y-1">
            {p.holidays.map((h) => (
              <li key={h.holiday_date} className="flex gap-2">
                <Badge tone="red">{thaiDate(`${h.holiday_date}T12:00:00+07:00`)}</Badge> {h.name}
              </li>
            ))}
          </ul>
          <div className="space-y-3">
            <PeoplePicker emps={p.emps} value={people} onChange={setPeople} />
            <ShiftSelect defs={nonWork.length ? nonWork : p.activeDefs} value={code} onChange={setCode} label="รหัสที่ใส่" />
            <OnlyEmpty value={onlyEmpty} onChange={setOnlyEmpty} />
            <p className="text-[14px] text-muted">คนที่ต้องมาทำงานวันนั้น ให้แก้เป็นกะทำงานและเลือก &quot;ทำงานวันนักขัตฤกษ์&quot; ภายหลัง</p>
          </div>
          <Footer
            onCancel={p.close}
            ok="ใส่ลงตาราง"
            disabled={!people.length || !code}
            onOk={() => p.done(holidayFill(p.holidays.map((h) => h.holiday_date), people, p.dates, code), onlyEmpty, "เติมวันนักขัตฤกษ์แล้ว")}
          />
        </>
      )}
    </Modal>
  );
}

// ---------- วางกะอัตโนมัติ ----------
type NeedRow = { shift: string; rows: { position: string; count: number }[] };
const planKey = (wh: string) => `wha-autoplan-${wh}`;

function AutoPlanTool(p: ToolProps) {
  const { demo } = useApp();
  const workDefs = p.activeDefs.filter((d) => d.working);
  const offCodes = p.activeDefs.filter((d) => !d.working);
  const positions = [...new Set(p.emps.map((e) => e.position ?? "").filter(Boolean))];
  const [people, setPeople] = useState(p.emps.map((e) => e.id));
  const [needs, setNeeds] = useState<NeedRow[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(planKey(p.wh)) ?? "null");
      if (Array.isArray(saved?.needs)) return saved.needs;
    } catch {}
    return workDefs[0] ? [{ shift: workDefs[0].code, rows: positions.slice(0, 1).map((x) => ({ position: x, count: 1 })) }] : [];
  });
  const [offCode, setOffCode] = useState(offCodes.find((d) => d.code === "OFF")?.code ?? offCodes[0]?.code ?? "");
  const [daysOff, setDaysOff] = useState(1);
  const [rotate, setRotate] = useState(true);
  const [rotationWeeks, setRotationWeeks] = useState(2);
  const [minRest, setMinRest] = useState(12);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const upd = (n: NeedRow[]) => {
    setNeeds(n);
    setPlan(null);
  };
  const toNeed = (code: string, counts: Record<string, number> = {}): ShiftNeed => {
    const d = p.defs.get(code);
    return { shift: code, start: d?.start ?? null, end: d?.end ?? null, counts };
  };

  async function run() {
    setErr("");
    if (!offCode) return setErr("ต้องมีรหัสวันหยุด (เช่น OFF) ในหน้าตั้งค่า → รหัสกะ");
    const list = needs
      .filter((n) => n.shift)
      .map((n) => toNeed(n.shift, n.rows.reduce<Record<string, number>>((a, r) => (r.position && r.count > 0 ? ((a[r.position] = (a[r.position] ?? 0) + r.count), a) : a), {})));
    if (!list.some((n) => Object.keys(n.counts).length)) return setErr("ใส่จำนวนคนที่ต้องการอย่างน้อย 1 ตำแหน่ง");
    setBusy(true);
    try {
      localStorage.setItem(planKey(p.wh), JSON.stringify({ needs }));
    } catch {}
    // กะวันสุดท้ายของเดือนก่อน (ตรวจเวลาพักข้ามเดือน)
    const prevDay = monthDates(addMonths(p.ym, -1)).at(-1)!;
    const previousLast: Record<string, ShiftNeed> = {};
    if (!demo) {
      const { data } = await sb()
        .from("shift_schedules")
        .select("user_id, shift_code, profiles!inner(warehouse_id)")
        .eq("profiles.warehouse_id", p.wh)
        .eq("work_date", prevDay);
      for (const r of (data ?? []) as { user_id: string; shift_code: string }[]) if (p.defs.get(r.shift_code)?.working) previousLast[r.user_id] = toNeed(r.shift_code);
    }
    const employees = p.emps.filter((e) => people.includes(e.id)).map((e) => ({ id: e.id, code: e.employee_code, position: e.position }));
    setPlan(generatePlan({ employees, dates: p.dates, needs: list, offCode, daysOffPerWeek: daysOff, rotateWeekly: rotate, rotationWeeks, minRestHours: minRest, previousLast }));
    setBusy(false);
  }

  const short = plan?.shortages.reduce((s, x) => s + x.missing, 0) ?? 0;
  const wd = plan ? Object.values(plan.workDays) : [];

  return (
    <Modal title={`วางกะอัตโนมัติ ${thaiMonthLabel(p.ym)}`} onClose={p.close}>
      <p className="mb-3 text-[15px] text-muted">ระบบจัดคนให้พอดีจำนวนที่ต้องการในแต่ละกะ คนที่เหลือเป็นวันหยุด (ไม่จัดเกินจำนวน จึงไม่เกิด OT จากตาราง) ผลจะใส่ทับทั้งเดือนของคนที่เลือก</p>
      {!workDefs.length ? (
        <Alert tone="warning">ยังไม่มีรหัสกะที่มีเวลาเข้า-ออก (ตั้งค่าตัวเลือก → รหัสกะ)</Alert>
      ) : (
        <div className="space-y-3">
          <PeoplePicker emps={p.emps} value={people} onChange={(v) => (setPeople(v), setPlan(null))} />
          <div className="space-y-2">
            <p className="text-[15px] font-semibold">จำนวนคนที่ต้องการต่อวัน</p>
            {needs.map((n, i) => (
              <div key={i} className="rounded-xl p-3 ring-1 ring-line">
                <div className="mb-2 flex items-center gap-2">
                  <select
                    className={`${inputCls} flex-1`}
                    value={n.shift}
                    aria-label="กะ"
                    onChange={(e) => upd(needs.map((x, j) => (j === i ? { ...x, shift: e.target.value } : x)))}
                  >
                    {workDefs.map((d) => (
                      <option key={d.code} value={d.code}>{d.code} {shiftTimeText(d)}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" aria-label="ลบกะนี้" onClick={() => upd(needs.filter((_, j) => j !== i))}>✕</Button>
                </div>
                {n.rows.map((r, k) => (
                  <div key={k} className="mb-2 flex items-center gap-2">
                    <select
                      className={`${inputCls} flex-1`}
                      value={r.position}
                      aria-label="ตำแหน่ง"
                      onChange={(e) => upd(needs.map((x, j) => (j === i ? { ...x, rows: x.rows.map((y, m) => (m === k ? { ...y, position: e.target.value } : y)) } : x)))}
                    >
                      {[...new Set([...positions, r.position])].filter(Boolean).map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      className={`${inputCls} !w-20`}
                      value={r.count}
                      aria-label="จำนวนคน"
                      onChange={(e) => upd(needs.map((x, j) => (j === i ? { ...x, rows: x.rows.map((y, m) => (m === k ? { ...y, count: Math.max(0, Math.min(500, Number(e.target.value) || 0)) } : y)) } : x)))}
                    />
                    <span className="text-[14px]">คน</span>
                    <Button size="sm" variant="ghost" aria-label="ลบตำแหน่ง" onClick={() => upd(needs.map((x, j) => (j === i ? { ...x, rows: x.rows.filter((_, m) => m !== k) } : x)))}>✕</Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!positions.length}
                  onClick={() => upd(needs.map((x, j) => (j === i ? { ...x, rows: [...x.rows, { position: positions.find((q) => !x.rows.some((y) => y.position === q)) ?? positions[0], count: 1 }] } : x)))}
                >
                  + ตำแหน่ง
                </Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => upd([...needs, { shift: workDefs.find((d) => !needs.some((n) => n.shift === d.code))?.code ?? workDefs[0].code, rows: [] }])}>
              + เพิ่มกะ
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="หยุดต่อสัปดาห์ (วัน)">
              <input type="number" min={0} max={6} className={inputCls} value={daysOff} onChange={(e) => (setDaysOff(Math.max(0, Math.min(6, Number(e.target.value) || 0))), setPlan(null))} />
            </Field>
            <Field label="พักระหว่างกะอย่างน้อย (ชม.)">
              <input type="number" min={0} max={24} className={inputCls} value={minRest} onChange={(e) => (setMinRest(Math.max(0, Math.min(24, Number(e.target.value) || 0))), setPlan(null))} />
            </Field>
            <ShiftSelect defs={offCodes} value={offCode} onChange={(v) => (setOffCode(v), setPlan(null))} label="รหัสวันหยุด" />
            <Field label="สลับกะทุก (สัปดาห์)">
              <input type="number" min={1} max={8} className={inputCls} disabled={!rotate} value={rotationWeeks} onChange={(e) => (setRotationWeeks(Math.max(1, Math.min(8, Number(e.target.value) || 1))), setPlan(null))} />
            </Field>
          </div>
          <OnlyEmpty value={rotate} onChange={(v) => (setRotate(v), setPlan(null))}>หมุนกะ (เช้า ↔ ดึก) ตามรอบสัปดาห์</OnlyEmpty>
          <p className="text-[13px] text-muted">ตัวเลขข้างบนเป็นค่าเริ่มต้นของการวางแผน แก้ได้ตามนโยบายบริษัท (เวลาทำงาน/วันหยุดต้องเป็นไปตามข้อบังคับการทำงานและ พ.ร.บ.คุ้มครองแรงงาน)</p>
          {err && <Alert tone="error">{err}</Alert>}
          {plan && (
            <Alert tone={short || plan.missingPositions.length ? "warning" : "success"}>
              <p className="font-semibold">ผลการวาง: {people.length} คน · วันทำงานต่อคน {Math.min(...wd)}–{Math.max(...wd)} วัน</p>
              {plan.missingPositions.length > 0 && <p>ไม่มีพนักงานตำแหน่ง: {plan.missingPositions.join(", ")}</p>}
              {short > 0 ? (
                <p>
                  คนไม่พอ รวม {short} คน-กะ ใน {new Set(plan.shortages.map((s) => s.date)).size} วัน
                  {plan.restBlocked > 0 ? ` (ติดเวลาพัก ${plan.restBlocked})` : ""}
                </p>
              ) : (
                !plan.missingPositions.length && <p>คนพอทุกกะทุกวัน</p>
              )}
            </Alert>
          )}
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={p.close}>ยกเลิก</Button>
        {plan ? (
          <Button className="flex-1" onClick={() => p.done(planChanges(plan), false, "วางกะอัตโนมัติแล้ว")}>ใส่ลงตาราง</Button>
        ) : (
          <Button className="flex-1" onClick={run} disabled={busy || !people.length || !workDefs.length}>{busy ? "กำลังคำนวณ..." : "ลองวาง"}</Button>
        )}
      </div>
    </Modal>
  );
}

// ---------- นำเข้า ----------
function ImportTool(p: ToolProps) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [err, setErr] = useState("");
  const validCodes = new Set(p.defs.keys());
  const holidaySet = new Set(p.holidays.map((h) => h.holiday_date));

  const parse = (table: string[][]) => setRes(parseShiftImport(table, p.dates, p.allEmps, validCodes, holidaySet, p.activeDefs));
  // แม่แบบ: เฉพาะคนที่แสดงอยู่ (เลือกตำแหน่งที่ตัวกรองก่อน = แม่แบบทีละตำแหน่ง)
  const posNames = [...new Set(p.emps.map((e) => e.position ?? "").filter(Boolean))];
  function downloadTemplate() {
    const tag = posNames.length === 1 ? `_${posNames[0].replace(/\s+/g, "")}` : "";
    downloadCsv(`แม่แบบตารางกะ_${p.whName.replace(/\s+/g, "")}${tag}_${p.ym}.csv`, templateRows(p.emps, p.dates, p.activeDefs));
  }

  async function onFile(f?: File) {
    if (!f) return;
    setErr("");
    setFileName(f.name);
    try {
      const t = /\.xlsx$/i.test(f.name) ? await readXlsx(await f.arrayBuffer()) : /\.(csv|txt)$/i.test(f.name) ? parseCsv(await f.text()) : null;
      if (!t) return setErr("รองรับไฟล์ .xlsx .csv .txt (ถ้าเป็น .xls ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx)");
      parse(t);
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <Modal title={`นำเข้าตารางกะ ${thaiMonthLabel(p.ym)}`} onClose={p.close}>
      <p className="mb-3 text-[15px] text-muted">
        ใช้ตารางผลัดแบบเดิมได้เลย: คอลัมน์ <b>ชื่อ</b> (หรือรหัสพนักงาน) แถวเลขวันที่ 1, 2, 3 ... ในช่องใส่<b>เวลาเข้างาน</b> เช่น 8 = เข้า 08:00, 20 = เข้า 20:00 หรือรหัสกะ · OFF = หยุด · ลา/ป่วย/พักร้อน = วันลา (ไม่ใส่กะ) · อบรม = กะ 08:00 · ช่องว่างไม่ลบกะเดิม · นำเข้าทีละตำแหน่งได้ (แก้เฉพาะคนที่อยู่ในไฟล์)
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-sky px-3 py-2.5">
        <span className="min-w-0 flex-1 text-[14px]">
          แม่แบบ {p.emps.length} คน{posNames.length === 1 ? ` (ตำแหน่ง ${posNames[0]})` : posNames.length > 1 ? ` (${posNames.length} ตำแหน่ง · เลือกตำแหน่งที่ตัวกรองก่อนถ้าจะแยกไฟล์)` : ""}
        </span>
        <Button size="sm" variant="secondary" onClick={downloadTemplate} disabled={!p.emps.length}>
          ดาวน์โหลดแม่แบบ
        </Button>
      </div>
      <div className="space-y-3">
        <input type="file" accept=".xlsx,.csv,.txt" className={`${inputCls} py-2.5`} onChange={(e) => onFile(e.target.files?.[0])} aria-label="เลือกไฟล์" />
        {fileName && <p className="text-[14px] text-muted">ไฟล์: {fileName}</p>}
        <Field label="หรือวางข้อมูลจาก Excel">
          <textarea className={`${inputCls} min-h-24 py-2 font-mono text-[13px]`} value={text} onChange={(e) => (setText(e.target.value), setRes(null))} placeholder={"รหัสพนักงาน\t1\t2\t3 ..."} />
        </Field>
        {text.trim() && !res && (
          <Button variant="secondary" size="sm" onClick={() => parse(parseCsv(text))}>ตรวจข้อมูลที่วาง</Button>
        )}
        {err && <Alert tone="error">{err}</Alert>}
        {res && (
          <Alert tone={res.problems.length ? "warning" : "success"}>
            <p className="font-semibold">พบ {res.people} คน · {res.changes.length} ช่อง</p>
            {res.problems.slice(0, 8).map((x) => (
              <p key={x} className="text-[14px]">• {x}</p>
            ))}
            {res.problems.length > 8 && <p className="text-[14px]">... และอีก {res.problems.length - 8} รายการ</p>}
          </Alert>
        )}
        {res && res.leaves.length > 0 && <LeaveList leaves={res.leaves} />}
        {res && <OnlyEmpty value={onlyEmpty} onChange={setOnlyEmpty} />}
      </div>
      <Footer onCancel={p.close} ok="ใส่ลงตาราง" disabled={!res?.changes.length} onOk={() => res && p.done(res.changes, onlyEmpty, `นำเข้า ${res.changes.length} ช่องแล้ว`)} />
    </Modal>
  );
}

// วันลาในไฟล์: ไม่ใส่กะ ให้หัวหน้ายื่นใบลาแทนในระบบลา (โควตา/เบี้ยขยันจะคิดถูก)
function LeaveList({ leaves }: { leaves: ImportResult["leaves"] }) {
  const byPerson = new Map<string, typeof leaves>();
  for (const l of leaves) byPerson.set(l.name, [...(byPerson.get(l.name) ?? []), l]);
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-line">
      <p className="mb-1.5 text-[15px] font-semibold">วันลาในไฟล์ ({leaves.length} วัน) — ไม่ได้ใส่กะ</p>
      <ul className="space-y-1 text-[14px]">
        {[...byPerson.entries()].map(([name, list]) => (
          <li key={name}>
            <b>{name}</b>: {list.map((l) => `${Number(l.work_date.slice(8))} ${l.text}`).join(", ")}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-muted">
        ยื่นใบลาแทนพนักงานได้ที่ <Link href="/leave/approvals" className="font-semibold text-brand underline">อนุมัติใบลา</Link> → ยื่นใบลาแทนพนักงาน
      </p>
    </div>
  );
}

// ---------- ล้างทั้งเดือน ----------
function ClearTool(p: Props & { close: () => void }) {
  const { demo } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    if (!reason.trim()) return setErr("กรุณาระบุเหตุผล");
    if (!confirm(`ยืนยันล้างตารางกะ ${thaiMonthLabel(p.ym)} ของ${p.whName} ทั้งหมด?`)) return;
    if (demo) return p.close();
    setBusy(true);
    const { data, error } = await sb().rpc("clear_schedule_scope", { p_wh: p.wh, p_month: p.dates[0], p_reason: reason.trim(), p_scope: p.scope });
    setBusy(false);
    if (error) return setErr(errText(error));
    await p.reload();
    p.setMsg({ tone: "success", text: `ล้างแล้ว ${data} ช่อง (ย้อนคืนได้ที่ เครื่องมือ → ประวัติและย้อนกลับ)` });
    p.close();
  }
  return (
    <Modal title="ล้างตารางกะทั้งเดือน" onClose={p.close}>
      <Alert tone="warning">
        ลบกะทุกช่องของ {thaiMonthLabel(p.ym)} ใน{p.whName} (ทุกคน ไม่ขึ้นกับตัวกรอง) ระบบเก็บสำเนาไว้ในประวัติ กดย้อนคืนได้
        {p.nChanges > 0 && ` · การแก้ไขที่ยังไม่บันทึก ${p.nChanges} ช่องจะหายไป`}
      </Alert>
      <div className="mt-3">
        <Field label="เหตุผล (บังคับ)">
          <input className={inputCls} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น วางกะใหม่ทั้งเดือน" />
        </Field>
      </div>
      {err && <div className="mt-3"><Alert tone="error">{err}</Alert></div>}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={p.close}>ยกเลิก</Button>
        <Button variant="danger" className="flex-1" onClick={run} disabled={busy}>{busy ? "กำลังล้าง..." : "ล้างทั้งเดือน"}</Button>
      </div>
    </Modal>
  );
}

// ---------- ประวัติและย้อนกลับ ----------
type Hist = { id: number; created_at: string; action: string; actor_name: string; count: number; source: string | null; reason: string | null; undone: boolean };
const SOURCE: Record<string, string> = {
  manual: "แก้ในตาราง", undo: "ย้อนกลับ", import: "นำเข้าไฟล์", migrate: "ย้ายจากแอปเดิม", auto: "วางกะอัตโนมัติ",
  copy: "คัดลอกเดือนก่อน", repeat: "ทำซ้ำรูปแบบ", fill: "เติมกะหลายคน", holiday: "เติมวันนักขัตฤกษ์",
};

function HistoryTool(p: Props & { close: () => void }) {
  const { demo } = useApp();
  const [rows, setRows] = useState<Hist[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์ไม่มีประวัติจริง
      setRows([]);
      return;
    }
    sb()
      .rpc("schedule_history", { p_wh: p.wh, p_month: p.dates[0] })
      .then(({ data, error }) => {
        if (error) setErr(errText(error));
        setRows((data ?? []) as Hist[]);
      });
  }, [demo, p.wh, p.dates]);

  async function undo(h: Hist) {
    const text = h.action === "schedule_clear" ? `คืนตารางกะที่ล้างไป ${h.count} ช่อง? (ใส่กลับเฉพาะช่องที่ยังว่าง)` : `ย้อนกลับการบันทึก ${h.count} ช่อง? (ช่องที่มีคนแก้ต่อแล้วจะไม่ถูกแตะ)`;
    if (!confirm(text + (p.nChanges ? `\nการแก้ไขที่ยังไม่บันทึก ${p.nChanges} ช่องจะหายไป` : ""))) return;
    setBusy(true);
    const { data, error } = await sb().rpc(h.action === "schedule_clear" ? "restore_schedule_month" : "undo_shift_bulk", { p_audit_id: h.id });
    setBusy(false);
    if (error) return setErr(errText(error));
    await p.reload();
    p.setMsg({ tone: "success", text: `ย้อนกลับแล้ว ${data} ช่อง` });
    p.close();
  }

  return (
    <Modal title={`ประวัติตารางกะ ${thaiMonthLabel(p.ym)}`} onClose={p.close}>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <p className="py-6 text-center text-muted">ยังไม่มีประวัติการบันทึกหลายช่องในเดือนนี้</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((h) => (
            <li key={h.id} className="rounded-xl p-3 ring-1 ring-line">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {h.action === "schedule_clear" ? "ล้างทั้งเดือน" : SOURCE[h.source ?? ""] ?? "บันทึก"} · {h.count} ช่อง
                  </p>
                  <p className="text-[14px] text-muted">
                    {thaiDateTime(h.created_at)} · {h.actor_name}
                    {h.reason ? ` · เหตุผล: ${h.reason}` : ""}
                  </p>
                </div>
                {h.undone ? (
                  <Badge>ย้อนแล้ว</Badge>
                ) : (
                  h.source !== "undo" && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => undo(h)}>
                      {h.action === "schedule_clear" ? "คืนข้อมูล" : "ย้อนกลับ"}
                    </Button>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-muted">การแก้ทีละช่องผ่านช่องทางอื่นดูได้ที่หน้าประวัติการใช้งาน (แอดมิน)</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={p.close}>ปิด</Button>
    </Modal>
  );
}

