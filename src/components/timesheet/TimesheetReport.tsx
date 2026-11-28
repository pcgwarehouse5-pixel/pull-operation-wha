"use client";

// รายงาน → ใบลงเวลา: หัวหน้าเลือกพนักงานหลายคน แล้วพิมพ์ใบลงเวลาตามฟอร์มบริษัท (คนละ 1 แผ่น A4)
//   ฟอร์ม MOU  = ประเภทพนักงาน mou · รอบครึ่งเดือนตามปฏิทิน (1–15 / 16–สิ้นเดือน)
//   ฟอร์มคนไทย = ประเภทอื่นทั้งหมด · เต็มเดือนเสมอ (วันที่ยังไม่ถึงเว้นว่าง)
// ข้อมูล: warehouse_attendance (เวลาเข้า-ออก/วันหยุด/ลา) + warehouse_ot (นับเฉพาะ OT ที่อนุมัติแล้ว)
// ข้อความหัวฟอร์ม/UL: ค่าตั้งค่า timesheet.form (ตั้งค่า → กฎและอัตรา → ใบลงเวลา)
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sarabun } from "next/font/google";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Empty, Loading, inputCls } from "@/components/ui";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { useWhModule } from "@/lib/useUnitModule";
import type { BreakRule } from "@/lib/ot-times";
import { buildDays, formOf, halfDays, monthDays, parseForm, personName, ratesFor, settingAt, unmappedMouRates, type TimesheetForm, type TsAtt, type TsDay, type TsOt, type WhTexts } from "@/lib/timesheet";
import { MouForm, ThaiForm, type TsPerson } from "./TimesheetForms";

const sarabun = Sarabun({ subsets: ["thai", "latin"], weight: ["400", "700"], variable: "--font-ts", display: "swap" });

type Att = TsAtt & { employee_code: string; first_name_th: string; last_name_th: string | null; position: string | null };
type Data = { att: Att[]; ot: TsOt[]; people: TsPerson[]; form: TimesheetForm; rates: unknown; brk: BreakRule };
type Kind = "mou" | "thai";

const ATT_COLS = "user_id,work_date,shift_code,shift_start,shift_end,first_in,last_out,leave_type,leave_period,status,late_min,employee_code,first_name_th,last_name_th,position";
const OT_COLS = "user_id,work_date,day_type,normal_hours,normal_rate,ot_hours,ot_rate,approval";
const EMPTY_WH: WhTexts = { mou_dept: "", mou_ul: "", thai_dept: "", thai_ul: "" };

/** โหลดข้อมูลทั้งเดือนของคลัง (คอมโพเนนต์นี้ถูกสร้างใหม่ทุกครั้งที่เปลี่ยนคลัง/เดือน ผ่าน key) */
export function TimesheetReport({ wh, whCode, ym }: { wh: string; whCode: string; ym: string }) {
  const lateNote = useWhModule(wh, "shop_forms");
  const { demo } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    const days = monthDays(ym);
    const first = days[0];
    const last = days[days.length - 1];
    const today = todayIso();
    (async (): Promise<Data> => {
      if (demo) {
        return {
          att: demo.previewTeamAttendance(days, today) as Att[],
          ot: demo.previewOt(first) as TsOt[],
          people: demo.previewTimesheetPeople(),
          form: parseForm(demo.PREVIEW_TIMESHEET_FORM),
          rates: { default: { workday: 1.5, holiday_normal: 1, holiday_ot: 3 } },
          brk: { minutes: 60, after: 480 },
        };
      }
      const otTo = last < today ? last : today;
      const [att, ot, people, sets] = await Promise.all([
        fetchAll<Att>((f, t) => sb().rpc("warehouse_attendance", { p_wh: wh, p_from: first, p_to: last }).select(ATT_COLS).order("user_id").order("work_date").range(f, t)),
        first <= today
          ? fetchAll<TsOt>((f, t) => sb().rpc("warehouse_ot", { p_wh: wh, p_from: first, p_to: otTo }).select(OT_COLS).order("user_id").order("work_date").range(f, t))
          : Promise.resolve([] as TsOt[]),
        fetchAll<TsPerson>((f, t) =>
          sb().from("profiles").select("id,employee_code,title,first_name_th,last_name_th,position,salary_code,employment_type").eq("warehouse_id", wh).order("employee_code").range(f, t),
        ),
        sb().from("app_settings").select("key,effective_from,value").in("key", ["timesheet.form", "ot.rates", "ot.break_minutes", "ot.break_after_minutes"]),
      ]);
      if (sets.error) throw sets.error;
      const rows = (sets.data ?? []) as { key: string; effective_from: string; value: unknown }[];
      return {
        att,
        ot,
        people,
        form: parseForm(settingAt(rows.filter((r) => r.key === "timesheet.form"), first)),
        rates: settingAt(rows.filter((r) => r.key === "ot.rates"), first),
        brk: {
          minutes: Number(settingAt(rows.filter((r) => r.key === "ot.break_minutes"), first) ?? 60),
          after: Number(settingAt(rows.filter((r) => r.key === "ot.break_after_minutes"), first) ?? 480),
        },
      };
    })()
      .then((d) => live && setData(d))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [demo, wh, ym]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!data) return <Loading />;
  return <Body data={data} ym={ym} whTexts={data.form.wh[whCode] ?? EMPTY_WH} lateNote={lateNote} />;
}

function Body({ data, ym, whTexts, lateNote }: { data: Data; ym: string; whTexts: WhTexts; lateNote: boolean }) {
  const now = todayIso();
  const [kind, setKind] = useState<Kind>("mou");
  // รอบที่น่าจะพิมพ์: เดือนนี้ก่อนวันที่ 28 = รอบแรก · นอกนั้น = รอบหลัง
  const [half, setHalf] = useState<1 | 2>(ym === now.slice(0, 7) && Number(now.slice(8)) < 28 ? 1 : 2);
  const seg = (on: boolean) => `min-h-11 rounded-full px-4 text-[15px] font-semibold ${on ? "bg-ink text-white" : "bg-white ring-1 ring-line"}`;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="radiogroup" aria-label="แบบฟอร์ม">
          <button role="radio" aria-checked={kind === "mou"} className={seg(kind === "mou")} onClick={() => setKind("mou")}>ฟอร์ม MOU</button>
          <button role="radio" aria-checked={kind === "thai"} className={seg(kind === "thai")} onClick={() => setKind("thai")}>ฟอร์มคนไทย</button>
        </div>
        {kind === "mou" ? (
          <div className="flex gap-1.5" role="radiogroup" aria-label="รอบครึ่งเดือน">
            <button role="radio" aria-checked={half === 1} className={seg(half === 1)} onClick={() => setHalf(1)}>วันที่ 1–15</button>
            <button role="radio" aria-checked={half === 2} className={seg(half === 2)} onClick={() => setHalf(2)}>วันที่ 16–สิ้นเดือน</button>
          </div>
        ) : (
          <span className="text-[14px] text-muted">พิมพ์เต็มเดือน · วันที่ยังไม่ถึงเว้นว่าง</span>
        )}
      </div>
      <Picker key={`${kind}-${half}`} data={data} ym={ym} kind={kind} days={kind === "mou" ? halfDays(ym, half) : monthDays(ym)} whTexts={whTexts} lateNote={lateNote} />
    </>
  );
}

function Picker({ data, ym, kind, days, whTexts, lateNote }: { data: Data; ym: string; kind: Kind; days: string[]; whTexts: WhTexts; lateNote: boolean }) {
  const { demo } = useApp();
  const opts = useOptions(["leave_type", "position"]);
  const leaveOpts = demo ? demo.PREVIEW_LEAVE_TYPES : opts.leave_type;
  const today = todayIso();

  // พนักงานในฟอร์มนี้ + แถวรายวันของแต่ละคน
  const list = useMemo(() => {
    const prof = new Map(data.people.map((p) => [p.id, p]));
    const att = new Map<string, Att[]>();
    for (const a of data.att) att.set(a.user_id, [...(att.get(a.user_id) ?? []), a]);
    const ot = new Map<string, TsOt[]>();
    for (const o of data.ot) ot.set(o.user_id, [...(ot.get(o.user_id) ?? []), o]);
    const leave = (c: string) => {
      const l = leaveOpts?.find((o) => o.value === c)?.label ?? c;
      return l.startsWith("ลา") || l.startsWith("ขาด") ? l : `ลา${l}`;
    };
    const posLabel = (v: string | null) => (v ? (opts.position?.find((o) => o.value === v)?.label ?? v) : null);
    const inDays = new Set(days);
    return [...att.entries()]
      .map(([id, rows]) => {
        const a = rows[0];
        const p: TsPerson = prof.get(id) ?? { id, employee_code: a.employee_code, title: null, first_name_th: a.first_name_th, last_name_th: a.last_name_th, position: a.position, salary_code: null, employment_type: null };
        const person = { ...p, position: posLabel(p.position) };
        const scheduled = rows.some((r) => inDays.has(r.work_date) && (r.shift_code || r.first_in));
        return { person, scheduled, rows: buildDays(days, rows, ot.get(id) ?? [], today, leave, { brk: data.brk, lateNote }) };
      })
      .filter((x) => formOf(x.person.employment_type) === kind)
      .sort((a, b) => a.person.employee_code.localeCompare(b.person.employee_code));
  }, [data, days, kind, leaveOpts, opts.position, today, lateNote]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(list.filter((x) => x.scheduled).map((x) => x.person.id)));
  const [q, setQ] = useState("");
  const [pv, setPv] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const chosen = list.filter((x) => picked.has(x.person.id));
  const shown = list.filter((x) => {
    const s = q.trim().toLowerCase();
    return !s || `${x.person.employee_code} ${personName(x.person)} ${x.person.position ?? ""}`.toLowerCase().includes(s);
  });
  const preview = list.find((x) => x.person.id === pv) ?? chosen[0] ?? list[0];
  const waiting = chosen.reduce((s, x) => s + x.rows.filter((r) => r.otWaiting).length, 0);
  const odd = kind === "mou" ? [...new Set(chosen.flatMap((x) => unmappedMouRates(x.rows)))] : [];
  const noUl = kind === "mou" ? !whTexts.mou_ul : !whTexts.thai_ul;

  const form = (x: { person: TsPerson; rows: TsDay[] }) =>
    kind === "mou" ? (
      <MouForm key={x.person.id} person={x.person} rows={x.rows} form={data.form} wh={whTexts} />
    ) : (
      <ThaiForm key={x.person.id} person={x.person} rows={x.rows} ym={ym} form={data.form} wh={whTexts} rates={ratesFor(data.rates, x.person.employment_type)} />
    );

  // พิมพ์: ต่อใบทั้งหมดท้าย body แล้วซ่อนส่วนอื่นของแอประหว่างพิมพ์
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ts-printing");
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => {
      document.fonts.ready.then(() => window.print());
    }, 200);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("ts-printing");
    };
  }, [printing]);

  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  if (!list.length) return <Empty>{kind === "mou" ? "ไม่มีพนักงาน MOU ในคลังนี้" : "ไม่มีพนักงานที่ใช้ฟอร์มคนไทยในคลังนี้"}</Empty>;

  return (
    <>
      <div className="mb-3 space-y-2">
        {waiting > 0 && <Alert tone="warning">มี OT ที่ยังไม่อนุมัติ {waiting} วัน ในคนที่เลือก · ชั่วโมงเหล่านี้จะไม่ขึ้นในใบ (อนุมัติก่อนที่หน้า OT แล้วค่อยพิมพ์)</Alert>}
        {odd.length > 0 && <Alert tone="error">มีชั่วโมง OT อัตรา {odd.join(", ")} เท่า ซึ่งฟอร์ม MOU ไม่มีช่อง (มีแค่ 1 / 1.5 / 2 / 3) · ตรวจอัตรา OT ในหน้าตั้งค่าก่อนพิมพ์</Alert>}
        {noUl && <Alert tone="info">ยังไม่ได้ตั้งเลข UL ของคลังนี้สำหรับฟอร์ม{kind === "mou" ? " MOU" : "คนไทย"} (ตั้งค่า → กฎและอัตรา → ใบลงเวลา) · ช่อง UL จะว่าง</Alert>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicked(new Set(list.map((x) => x.person.id)))}>เลือกทั้งหมด</Button>
            <Button size="sm" variant="secondary" onClick={() => setPicked(new Set())}>ไม่เลือก</Button>
            <span className="text-[14px] text-muted">เลือก {chosen.length}/{list.length} คน</span>
          </div>
          <input className={`${inputCls} mb-2`} placeholder="ค้นหาชื่อ / รหัส / ตำแหน่ง" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาพนักงาน" />
          <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto rounded-2xl bg-white ring-1 ring-line">
            {shown.map((x) => (
              <li key={x.person.id} className={`flex items-center gap-2 px-3 ${preview?.person.id === x.person.id ? "bg-brand/5" : ""}`}>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={picked.has(x.person.id)} onChange={() => toggle(x.person.id)} aria-label={`เลือก ${personName(x.person)}`} />
                <button className="min-h-12 min-w-0 flex-1 py-1.5 text-left" onClick={() => setPv(x.person.id)}>
                  <span className="block truncate font-semibold">{personName(x.person)}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {x.person.employee_code}
                    {x.person.position ? ` · ${x.person.position}` : ""}
                    {!x.scheduled ? " · ไม่มีกะในรอบนี้" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button className="mt-3 w-full" onClick={() => setPrinting(true)} disabled={!chosen.length || printing}>
            {printing ? "กำลังเตรียมพิมพ์..." : `พิมพ์ใบลงเวลา ${chosen.length} คน (A4)`}
          </Button>
          <p className="mt-2 text-[13px] text-muted">คนละ 1 แผ่น · ตั้งเครื่องพิมพ์เป็น A4 แนวตั้ง ขนาดจริง (100%) ไม่ย่อ/ขยาย · แถวสีเทา = วันหยุดของคนนั้น</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-[14px] text-muted">ตัวอย่างใบของ <b className="text-ink">{preview ? personName(preview.person) : "-"}</b> (กดชื่อในรายการเพื่อดูคนอื่น)</p>
          {preview && <A4Scaled>{form(preview)}</A4Scaled>}
        </div>
      </div>

      {printing && createPortal(<div className={`ts-print-root ${sarabun.variable}`}>{chosen.map(form)}</div>, document.body)}
    </>
  );
}

/** แสดงหน้า A4 ย่อให้พอดีความกว้างจอ */
function A4Scaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / 794)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`w-full ${sarabun.variable}`}>
      <div className="overflow-hidden rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.12)] ring-1 ring-line" style={{ width: 794 * scale, height: 1123 * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: 794 }}>{children}</div>
      </div>
    </div>
  );
}
