"use client";

// แท็บรายงานของหน้าร้าน: แบบฟอร์มลางานรายคน (ทั้งปี) · ใบแจ้งตารางการปฏิบัติงาน (ทั้งเดือน)
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Empty, Loading, inputCls } from "@/components/ui";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { useShiftDefs } from "@/lib/useShiftDefs";
import { monthDates } from "@/lib/shifts";
import { leaveFormSheet, parseLeaveForm, parseShiftForm, shiftCell, type LeaveFormRow, type LeaveFormTexts, type ShiftFormTexts } from "@/lib/shop-forms";
import { LandscapeScaled, LeaveFormPage, ShiftPlanPages, fullName, usePrintPortal, type ShopPerson, type ShiftPlanRow } from "./ShopForms";

const PERSON_COLS = "id,employee_code,title,first_name_th,last_name_th,position,department,hire_date";
const setting = (k: string) => sb().rpc("setting", { p_key: k }).then(({ data }) => data as unknown);
const hhmm = (min: number | null) => (min === null ? null : `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

// ---------------- แบบฟอร์มลางาน ----------------
type LeaveData = { people: ShopPerson[]; rows: LeaveFormRow[]; texts: LeaveFormTexts; hpd: number };

export function LeaveFormReport({ wh, year }: { wh: string; year: number }) {
  const { demo } = useApp();
  const opts = useOptions(["leave_type", "position"]);
  const leaveOpts = demo ? demo.PREVIEW_LEAVE_TYPES : opts.leave_type;
  const [data, setData] = useState<LeaveData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    (async (): Promise<LeaveData> => {
      if (demo) {
        return {
          people: demo.previewShopPeople(),
          rows: demo.previewLeaveFormRows(year) as LeaveFormRow[],
          texts: { group: "กลุ่มธุรกิจ (ตัวอย่าง)", title: "แบบฟอร์มลางาน", company: "บริษัท ตัวอย่าง จำกัด", dept: "ฝ่ายขาย" },
          hpd: 8,
        };
      }
      const [people, rows, texts, hpd] = await Promise.all([
        fetchAll<ShopPerson>((f, t) => sb().from("profiles").select(PERSON_COLS).eq("warehouse_id", wh).eq("status", "active").order("employee_code").range(f, t)),
        fetchAll<LeaveFormRow>((f, t) => sb().rpc("leave_form_rows", { p_wh: wh, p_year: year }).range(f, t)),
        setting("shop.leave_form"),
        setting("leave.hours_per_day"),
      ]);
      return { people, rows, texts: parseLeaveForm(texts), hpd: Number(hpd) > 0 ? Number(hpd) : 8 };
    })()
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [demo, wh, year]);

  const list = useMemo(() => {
    if (!data) return [];
    const label = (c: string) => leaveOpts?.find((o) => o.value === c)?.label ?? c;
    const pos = (v: string | null) => (v ? (opts.position?.find((o) => o.value === v)?.label ?? v) : null);
    return data.people.map((p) => {
      const sheet = leaveFormSheet(data.rows.filter((r) => r.user_id === p.id), data.hpd, label);
      return { person: { ...p, position: pos(p.position) }, sheet };
    });
  }, [data, leaveOpts, opts.position]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Loading />;
  if (!list.length) return <Empty>ยังไม่มีพนักงานในคลังนี้</Empty>;
  return (
    <PickAndPrint
      items={list.map((x) => ({ id: x.person.id, person: x.person, note: `${x.sheet.lines.length} ใบ` }))}
      defaultAll
      printLabel={(n) => `พิมพ์แบบฟอร์มลางาน ${n} คน (A4 แนวนอน)`}
      hint={`ปี ${year + 543} · นับเฉพาะใบลาที่อนุมัติแล้ว · คนละ 1 แผ่น · ตั้งเครื่องพิมพ์ A4 แนวนอน 100%`}
      warn={list.some((x) => !x.person.hire_date) ? "บางคนยังไม่มีวันที่เริ่มงาน (กรอกได้ที่หน้าทะเบียนพนักงาน) · ช่องนั้นจะว่าง" : ""}
      render={(id) => {
        const x = list.find((y) => y.person.id === id)!;
        return <LeaveFormPage key={id} person={x.person} sheet={x.sheet} year={year} texts={data.texts} />;
      }}
    />
  );
}

// ---------------- ใบแจ้งตารางการปฏิบัติงาน ----------------
type PlanData = { people: ShopPerson[]; shifts: { user_id: string; work_date: string; shift_code: string }[]; texts: ShiftFormTexts };

export function ShiftPlanReport({ wh, ym }: { wh: string; ym: string }) {
  const { demo } = useApp();
  const defs = useShiftDefs();
  const days = useMemo(() => monthDates(ym), [ym]);
  const [data, setData] = useState<PlanData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    (async (): Promise<PlanData> => {
      if (demo) {
        return {
          people: demo.previewShopPeople(),
          shifts: demo.previewShopShifts(days),
          texts: parseShiftForm({ company: "บริษัท ตัวอย่าง จำกัด", title: "แบบแจ้งตารางการปฏิบัติงานพนักงาน", group: "ฝ่ายบริการลูกค้า", signer_name: "ผู้บังคับบัญชา ตัวอย่าง", signer_title: "ผู้จัดการ (ตัวอย่าง)", signer_role: "ผู้บังคับบัญชา", codes: { STD1: "1" }, legend: "กะ 2 (17.00 - 01.00 น.)    กะ 3 (01.00 - 08.00 น.)" }),
        };
      }
      const people = await fetchAll<ShopPerson>((f, t) =>
        sb().from("profiles").select(PERSON_COLS).eq("warehouse_id", wh).eq("status", "active").eq("exclude_from_shift", false).order("employee_code").range(f, t),
      );
      const ids = people.map((p) => p.id);
      const [shifts, texts] = await Promise.all([
        ids.length
          ? fetchAll<PlanData["shifts"][number]>((f, t) =>
              sb().from("shift_schedules").select("user_id,work_date,shift_code").in("user_id", ids).gte("work_date", days[0]).lte("work_date", days.at(-1)!).order("user_id").order("work_date").range(f, t),
            )
          : Promise.resolve([]),
        setting("shop.shift_form"),
      ]);
      return { people, shifts, texts: parseShiftForm(texts) };
    })()
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [demo, wh, days]);

  const rows = useMemo<ShiftPlanRow[]>(() => {
    if (!data) return [];
    const by = new Map(data.shifts.map((s) => [`${s.user_id}|${s.work_date}`, s.shift_code]));
    return data.people.map((p) => ({
      person: p,
      cells: days.map((d) => {
        const code = by.get(`${p.id}|${d}`) ?? null;
        const def = code ? defs.get(code) : undefined;
        return shiftCell(code, def?.working ? hhmm(def.start) : null, data.texts.codes);
      }),
    }));
  }, [data, days, defs]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Loading />;
  if (!rows.length) return <Empty>ยังไม่มีพนักงานในคลังนี้</Empty>;
  const noShift = rows.filter((r) => r.cells.every((c) => !c)).length;
  return (
    <PickAndPrint
      items={rows.map((r) => ({ id: r.person.id, person: r.person, note: r.cells.every((c) => !c) ? "ยังไม่มีกะเดือนนี้" : "" }))}
      defaultAll
      printLabel={(n) => `พิมพ์ใบแจ้งตารางการปฏิบัติงาน ${n} คน (A4 แนวนอน)`}
      hint="ตัวเลขในช่อง: รหัสกะที่ตั้งไว้ (เช่น 1 = กะปกติ) · กะอื่นแสดงชั่วโมงเข้างาน · - = วันหยุด · ว่าง = ยังไม่จัดกะ · แก้ข้อความหัวฟอร์ม/ผู้ลงนามได้ที่ ตั้งค่าตัวเลือก → กฎและอัตรา → แบบฟอร์มหน้าร้าน"
      warn={noShift ? `${noShift} คนยังไม่มีกะในเดือนนี้ (จัดกะก่อนพิมพ์)` : ""}
      whole={(ids) => <ShiftPlanPages ym={ym} days={days} rows={rows.filter((r) => ids.includes(r.person.id))} texts={data.texts} />}
    />
  );
}

// ---------------- เลือกคน + ตัวอย่าง + พิมพ์ ----------------
type Item = { id: string; person: ShopPerson; note: string };

function PickAndPrint({
  items,
  defaultAll,
  printLabel,
  hint,
  warn,
  render,
  whole,
}: {
  items: Item[];
  defaultAll?: boolean;
  printLabel: (n: number) => string;
  hint: string;
  warn?: string;
  /** แบบละ 1 แผ่นต่อคน */
  render?: (id: string) => React.ReactNode;
  /** แบบหลายคนในแผ่นเดียว */
  whole?: (ids: string[]) => React.ReactNode;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(defaultAll ? items.map((x) => x.id) : []));
  const [pv, setPv] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [printing, print, portal] = usePrintPortal();
  const chosen = items.filter((x) => picked.has(x.id)).map((x) => x.id);
  const shown = items.filter((x) => {
    const s = q.trim().toLowerCase();
    return !s || `${x.person.employee_code} ${fullName(x.person)} ${x.person.position ?? ""}`.toLowerCase().includes(s);
  });
  const previewId = pv ?? chosen[0] ?? items[0]?.id;
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pages = whole ? whole(chosen) : chosen.map((id) => render!(id));

  return (
    <>
      {warn && <div className="mb-3"><Alert tone="info">{warn}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicked(new Set(items.map((x) => x.id)))}>เลือกทั้งหมด</Button>
            <Button size="sm" variant="secondary" onClick={() => setPicked(new Set())}>ไม่เลือก</Button>
            <span className="text-[14px] text-muted">เลือก {chosen.length}/{items.length} คน</span>
          </div>
          <input className={`${inputCls} mb-2`} placeholder="ค้นหาชื่อ / รหัส / ตำแหน่ง" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาพนักงาน" />
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-2xl bg-white ring-1 ring-line">
            {shown.map((x) => (
              <li key={x.id} className={`flex items-center gap-2 px-3 ${previewId === x.id ? "bg-brand/5" : ""}`}>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={picked.has(x.id)} onChange={() => toggle(x.id)} aria-label={`เลือก ${fullName(x.person)}`} />
                <button className="min-h-12 min-w-0 flex-1 py-1.5 text-left" onClick={() => setPv(x.id)}>
                  <span className="block truncate font-semibold">{fullName(x.person)}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {x.person.employee_code}
                    {x.person.position ? ` · ${x.person.position}` : ""}
                    {x.note ? ` · ${x.note}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button className="mt-3 w-full" onClick={print} disabled={!chosen.length || printing}>
            {printing ? "กำลังเตรียมพิมพ์..." : printLabel(chosen.length)}
          </Button>
          <p className="mt-2 text-[13px] text-muted">{hint}</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-[14px] text-muted">ตัวอย่างก่อนพิมพ์{render ? " (กดชื่อในรายการเพื่อดูคนอื่น)" : ""}</p>
          {previewId && <LandscapeScaled>{whole ? whole(chosen.length ? chosen : [previewId]) : render!(previewId)}</LandscapeScaled>}
        </div>
      </div>
      {portal(pages)}
    </>
  );
}
