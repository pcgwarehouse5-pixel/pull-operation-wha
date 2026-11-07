"use client";

// รายงาน (หัวหน้างานขึ้นไป): ภาพรวม / OT / เบี้ยขยัน / ค่าเดินทาง / การลา — ส่งออก CSV และพิมพ์ A4
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHelper } from "@/components/Puinun";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { errText, sb } from "@/lib/supabase";
import { downloadCsv } from "@/lib/csv";
import { shortDay, thaiDate, thaiTime } from "@/lib/format";
import { useOptions, labelOf } from "@/lib/useOptions";
import { isGlobal } from "@/lib/types";
import { addMonths, currentMonth, monthDates, thaiMonthLabel, todayIso } from "@/lib/shifts";
import { DAY_TYPE, fmtHours, otBuckets, rateLabel, ratesOf, type TeamOtRow } from "@/lib/ot";

type Tab = "overview" | "ot" | "diligence" | "travel" | "leave";
type Person = { user_id: string; employee_code: string; first_name_th: string; last_name_th: string | null; nickname: string | null; position: string | null; salary_code?: string | null };
type Period = { start: string; end: string };
const fullName = (p: Person) => [p.first_name_th, p.last_name_th].filter(Boolean).join(" ");
const thai = (d: string) => thaiDate(`${d}T12:00:00+07:00`);
const money = (n: number) => Number(n).toLocaleString("th-TH");

export default function ReportsPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const visible = useMemo(() => warehouses.filter((w) => w.is_active && (isGlobal(me.role) || myWarehouseIds.includes(w.id))), [warehouses, me.role, myWarehouseIds]);
  const [tab, setTab] = useState<Tab>("overview");
  const [wh, setWh] = useState((visible.find((w) => w.id === me.warehouse_id) ?? visible[0])?.id ?? "");
  const [ym, setYm] = useState(currentMonth);
  const [period, setPeriod] = useState<Period | null>(null);
  const whName = visible.find((w) => w.id === wh)?.name ?? "";

  // รอบเงินเดือนของเดือนที่เลือก (ตามวันตัดรอบในหน้าตั้งค่า)
  useEffect(() => {
    const dates = monthDates(ym);
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setPeriod({ start: dates[0], end: dates.at(-1)! });
      return;
    }
    let live = true;
    sb()
      .rpc("payroll_period", { p_month: dates[0] })
      .then(({ data }) => {
        const r = (Array.isArray(data) ? data[0] : data) as { p_start: string; p_end: string } | null;
        if (live) setPeriod(r ? { start: r.p_start, end: r.p_end } : { start: dates[0], end: dates.at(-1)! });
      });
    return () => {
      live = false;
    };
  }, [ym, demo]);

  // ช่วงที่ดึงข้อมูลได้จริง (ไม่เกินวันนี้)
  const range = period ? { start: period.start, end: period.end < todayIso() ? period.end : todayIso() } : null;

  return (
    <AppShell title="รายงาน" minRole="supervisor" wide>
      <PageHelper pose="paper" title="รายงาน">
        สรุปภาพรวม OT เบี้ยขยัน ค่าเดินทาง และการลา ส่งออก CSV หรือพิมพ์ A4
      </PageHelper>
      <div className="mb-3 -mx-3 overflow-x-auto px-3 print:hidden">
        <div className="flex w-max gap-1.5" role="tablist">
          {(
            [
              ["overview", "ภาพรวม"],
              ["ot", "สรุป OT"],
              ["diligence", "เบี้ยขยัน"],
              ["travel", "ค่าเดินทาง"],
              ["leave", "สรุปการลา"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 rounded-full px-4 text-[15px] font-semibold whitespace-nowrap ${tab === k ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {tab !== "overview" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          {visible.length > 1 && (
            <select className={`${inputCls} !w-auto`} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
              {visible.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" aria-label="เดือนก่อน" onClick={() => setYm(addMonths(ym, -1))}>
            <Icon name="back" size={18} />
          </Button>
          <span className="min-w-32 text-center font-bold text-brand">{thaiMonthLabel(ym)}</span>
          <Button variant="secondary" size="sm" aria-label="เดือนถัดไป" disabled={ym >= currentMonth()} onClick={() => setYm(addMonths(ym, 1))}>
            <Icon name="next" size={18} />
          </Button>
          {period && (
            <span className="text-[14px] text-muted">
              รอบ {thai(period.start)} – {thai(period.end)}
              {range && range.end < period.end ? ` (ข้อมูลถึง ${thai(range.end)})` : ""}
            </span>
          )}
        </div>
      )}

      {tab === "overview" && <Overview />}
      {tab !== "overview" && (!range || !wh) && <Loading />}
      {tab === "ot" && range && wh && <OtReport wh={wh} whName={whName} range={range} period={period!} />}
      {tab === "diligence" && range && wh && <DiligenceReport wh={wh} whName={whName} month={`${ym}-01`} period={period!} />}
      {tab === "travel" && range && wh && <TravelReport wh={wh} whName={whName} range={range} period={period!} />}
      {tab === "leave" && range && wh && <LeaveReport wh={wh} whName={whName} period={period!} />}
    </AppShell>
  );
}

// ---------- ตัวช่วยร่วม ----------
function useRpc<T>(fn: string, args: Record<string, unknown>, demoRows: () => T[]) {
  const { demo } = useApp();
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify(args);
  const load = useCallback(async () => {
    setRows(null);
    setErr("");
    if (demo) return setRows(demoRows());
    const { data, error } = await sb().rpc(fn, JSON.parse(key));
    if (error) setErr(errText(error));
    setRows((data ?? []) as T[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- demoRows เป็นค่าคงที่ของแต่ละรายงาน
  }, [demo, fn, key]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนเงื่อนไข
    load();
  }, [load]);
  return { rows, err };
}

function Toolbar({ onCsv, prints, note }: { onCsv?: () => void; prints: { label: string; onClick: () => void }[]; note?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
      {note && <span className="text-[14px] text-muted">{note}</span>}
      <span className="ml-auto" />
      {onCsv && <Button size="sm" variant="secondary" onClick={onCsv}>ส่งออก CSV</Button>}
      {prints.map((p) => (
        <Button key={p.label} size="sm" variant="secondary" onClick={p.onClick}>{p.label}</Button>
      ))}
    </div>
  );
}

function PrintHead({ title, whName, period }: { title: string; whName: string; period: Period }) {
  return (
    <div className="mb-3 hidden text-center print:block">
      <p className="text-[16px] font-bold">{title}</p>
      <p className="text-[13px]">
        {whName} · รอบ {thai(period.start)} – {thai(period.end)}
      </p>
    </div>
  );
}

function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="mt-8 grid gap-6 text-center text-[12px]" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((l) => (
        <div key={l}>
          <p className="mb-1">ลงชื่อ ............................................</p>
          <p>(............................................)</p>
          <p className="mt-1 font-semibold">{l}</p>
          <p>วันที่ ......../......../........</p>
        </div>
      ))}
    </div>
  );
}

const printNow = () => setTimeout(() => window.print(), 50);
const tableCls = "print-table w-full min-w-[640px] border-collapse text-[14px]";
const thCls = "border-b border-line bg-[#f6f8fc] px-2 py-2 text-left font-semibold";
const tdCls = "border-b border-line px-2 py-1.5";

// ---------- ภาพรวม ----------
type Dash = { warehouse_id: string; code: string; name: string; headcount: number; scheduled: number; present: number; late: number; waiting: number; absent: number; on_leave: number; mtd_absent: number; mtd_leave_days: number; mtd_ot_hours: number; mtd_ot_pending: number };

function Overview() {
  const { demo } = useApp();
  const [day] = useState(todayIso);
  const { rows, err } = useRpc<Dash>("dashboard_summary", { p_date: day }, () => (demo?.PREVIEW_DASHBOARD ?? []) as Dash[]);
  const total = (k: keyof Dash) => (rows ?? []).reduce((s, r) => s + Number(r[k]), 0);
  return (
    <>
      <p className="mb-3 px-1 text-[15px] text-muted">วันนี้ {shortDay(day)} · ตั้งแต่ต้นเดือน {thaiMonthLabel(day.slice(0, 7))}</p>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ไม่มีคลังที่ดูแล</Empty>
      ) : (
        <>
          {rows.length > 1 && (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="พนักงานทั้งหมด" value={total("headcount")} />
              <Stat label="มาทำงานวันนี้" value={`${total("present")}/${total("scheduled")}`} tone="text-ok" />
              <Stat label="ขาด/ยังไม่เข้า" value={total("absent") + total("waiting")} tone={total("absent") + total("waiting") ? "text-bad" : "text-muted"} />
              <Stat label="OT อนุมัติแล้ว (ชม.)" value={fmtHours(total("mtd_ot_hours"))} tone="text-brand" />
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => (
              <Card key={r.warehouse_id}>
                <div className="mb-3 flex items-center gap-2">
                  <p className="text-lg font-bold text-brand">{r.name}</p>
                  <Badge>{r.headcount} คน</Badge>
                </div>
                <p className="mb-1 text-[13px] font-semibold text-muted">วันนี้</p>
                <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                  <Mini label="มาแล้ว" value={`${r.present}/${r.scheduled}`} tone="text-ok" />
                  <Mini label="สาย" value={r.late} tone={r.late ? "text-[#7a5410]" : ""} />
                  <Mini label="ขาด/ยังไม่เข้า" value={r.absent + r.waiting} tone={r.absent + r.waiting ? "text-bad" : ""} />
                  <Mini label="ลา" value={r.on_leave} />
                </div>
                <p className="mb-1 text-[13px] font-semibold text-muted">ตั้งแต่ต้นเดือน</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Mini label="ขาด (คน-วัน)" value={r.mtd_absent} tone={r.mtd_absent ? "text-bad" : ""} />
                  <Mini label="ลา (วัน)" value={Number(r.mtd_leave_days)} />
                  <Mini label="OT (ชม.)" value={fmtHours(Number(r.mtd_ot_hours))} />
                  <Mini label="OT/คน" value={r.headcount ? fmtHours(Math.round((Number(r.mtd_ot_hours) / r.headcount) * 10) / 10) : "-"} />
                </div>
                {r.mtd_ot_pending > 0 && <p className="mt-2 text-[13px] text-[#7a5410]">OT รออนุมัติ {r.mtd_ot_pending} รายการ (ยังไม่นับในยอด)</p>}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone = "text-ink" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 text-center ring-1 ring-line">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}
function Mini({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-paper px-1 py-2">
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[12px] leading-tight text-muted">{label}</p>
    </div>
  );
}

// ---------- สรุป OT ----------
function OtReport({ wh, whName, range, period }: { wh: string; whName: string; range: Period; period: Period }) {
  const { demo } = useApp();
  const { rows, err } = useRpc<TeamOtRow>("warehouse_ot", { p_wh: wh, p_from: range.start, p_to: range.end }, () => (demo?.previewOt(range.start) ?? []) as TeamOtRow[]);
  const [mode, setMode] = useState<"table" | "forms">("table");
  const approved = (rows ?? []).filter((r) => r.approval === "approved");
  const pending = (rows ?? []).filter((r) => r.approval === "pending" || r.approval === "changed").length;
  const rates = ratesOf(approved);
  const people = useMemo(() => {
    const m = new Map<string, { p: TeamOtRow; days: TeamOtRow[] }>();
    for (const r of approved) {
      const x = m.get(r.user_id) ?? { p: r, days: [] };
      x.days.push(r);
      m.set(r.user_id, x);
    }
    return [...m.values()];
  }, [approved]);
  const grand = otBuckets(approved);

  function csv() {
    downloadCsv(`สรุปOT_${whName.replace(/\s+/g, "")}_${period.start}_${period.end}.csv`, [
      ["รหัสพนักงาน", "รหัสเงินเดือน", "ชื่อ-นามสกุล", "ตำแหน่ง", ...rates.map((r) => `${rateLabel(r)} (ชม.)`), "รวม (ชม.)"],
      ...people.map(({ p, days }) => {
        const b = otBuckets(days);
        return [p.employee_code, p.salary_code ?? "", fullName(p), p.position ?? "", ...rates.map((r) => b.get(r) ?? 0), [...b.values()].reduce((s, h) => s + h, 0)];
      }),
    ]);
  }

  return (
    <>
      <Toolbar
        note={pending > 0 ? <span className="text-[#7a5410]">มี OT รออนุมัติ {pending} รายการ (ไม่นับในรายงาน)</span> : "นับเฉพาะ OT ที่อนุมัติแล้ว"}
        onCsv={people.length ? csv : undefined}
        prints={
          people.length
            ? [
                { label: "พิมพ์สรุป", onClick: () => (setMode("table"), printNow()) },
                { label: "พิมพ์ใบ OT รายคน (A4)", onClick: () => (setMode("forms"), printNow()) },
              ]
            : []
        }
      />
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !people.length ? (
        <Empty>ยังไม่มี OT ที่อนุมัติในรอบนี้</Empty>
      ) : (
        <>
          <div className={mode === "forms" ? "print:hidden" : ""}>
            <PrintHead title="สรุปชั่วโมงทำงานล่วงเวลา (OT)" whName={whName} period={period} />
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line print:overflow-visible print:ring-0">
              <table className={tableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>#</th>
                    <th className={thCls}>พนักงาน</th>
                    <th className={thCls}>รหัสเงินเดือน</th>
                    {rates.map((r) => (
                      <th key={r} className={`${thCls} text-right`}>{rateLabel(r)}</th>
                    ))}
                    <th className={`${thCls} text-right`}>รวม ชม.</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(({ p, days }, i) => {
                    const b = otBuckets(days);
                    return (
                      <tr key={p.user_id}>
                        <td className={tdCls}>{i + 1}</td>
                        <td className={tdCls}>
                          <span className="font-semibold">{fullName(p)}</span>
                          <span className="block text-[12px] text-muted">{p.employee_code} · {p.position ?? "-"}</span>
                        </td>
                        <td className={tdCls}>{p.salary_code ?? "-"}</td>
                        {rates.map((r) => (
                          <td key={r} className={`${tdCls} text-right`}>{b.get(r) ? fmtHours(b.get(r)!) : "-"}</td>
                        ))}
                        <td className={`${tdCls} text-right font-bold`}>{fmtHours([...b.values()].reduce((s, h) => s + h, 0))}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#f6f8fc] font-bold">
                    <td className={tdCls} colSpan={3}>รวม {people.length} คน</td>
                    {rates.map((r) => (
                      <td key={r} className={`${tdCls} text-right`}>{fmtHours(grand.get(r) ?? 0)}</td>
                    ))}
                    <td className={`${tdCls} text-right`}>{fmtHours([...grand.values()].reduce((s, h) => s + h, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="hidden print:block">
              <Signatures labels={["ผู้จัดทำ", "หัวหน้างาน", "ผู้อนุมัติ"]} />
            </div>
          </div>

          {/* ใบ OT รายคน (พิมพ์เท่านั้น) */}
          {mode === "forms" && (
            <div className="hidden print:block">
              {people.map(({ p, days }) => {
                const b = otBuckets(days);
                return (
                  <section key={p.user_id} className="print-page">
                    <p className="text-center text-[16px] font-bold">แบบสรุปการทำงานล่วงเวลา (OT)</p>
                    <p className="mb-2 text-center text-[13px]">{whName} · รอบ {thai(period.start)} – {thai(period.end)}</p>
                    <p className="mb-2 text-[13px]">
                      ชื่อ-นามสกุล <b>{fullName(p)}</b> · รหัสพนักงาน {p.employee_code} · รหัสเงินเดือน {p.salary_code ?? "-"} · ตำแหน่ง {p.position ?? "-"}
                    </p>
                    <table className="print-table w-full border-collapse">
                      <thead>
                        <tr>
                          <th>วันที่</th>
                          <th>ประเภทวัน</th>
                          <th>กะ</th>
                          <th>เข้า</th>
                          <th>ออก</th>
                          {rates.map((r) => (
                            <th key={r}>{rateLabel(r)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {days.map((d) => {
                          const bd = otBuckets([d]);
                          return (
                            <tr key={d.work_date}>
                              <td>{shortDay(d.work_date)}</td>
                              <td>{DAY_TYPE[d.day_type]}</td>
                              <td>{d.shift_code ?? "-"}</td>
                              <td>{thaiTime(d.first_in)}</td>
                              <td>{thaiTime(d.last_out)}</td>
                              {rates.map((r) => (
                                <td key={r} style={{ textAlign: "right" }}>{bd.get(r) ? fmtHours(bd.get(r)!) : ""}</td>
                              ))}
                            </tr>
                          );
                        })}
                        <tr>
                          <td colSpan={5} style={{ fontWeight: 700 }}>รวม</td>
                          {rates.map((r) => (
                            <td key={r} style={{ textAlign: "right", fontWeight: 700 }}>{b.get(r) ? fmtHours(b.get(r)!) : ""}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                    <Signatures labels={["พนักงาน", "หัวหน้างาน", "ผู้อนุมัติ"]} />
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---------- เบี้ยขยัน ----------
type DilRow = Person & { absent: number; late: number; no_punch: number; leave_days: number; streak: number; amount: number; qualified: boolean; period_start: string; period_end: string };

function DiligenceReport({ wh, whName, month, period }: { wh: string; whName: string; month: string; period: Period }) {
  const { demo } = useApp();
  const { rows, err } = useRpc<DilRow>("warehouse_diligence", { p_wh: wh, p_month: month }, () => (demo?.previewDiligence(period.start, period.end) ?? []) as DilRow[]);
  const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const got = (rows ?? []).filter((r) => Number(r.amount) > 0).length;
  function csv() {
    downloadCsv(`เบี้ยขยัน_${whName.replace(/\s+/g, "")}_${period.start}_${period.end}.csv`, [
      ["รหัสพนักงาน", "รหัสเงินเดือน", "ชื่อ-นามสกุล", "ตำแหน่ง", "ขาด", "สาย", "ลืมลงเวลา", "ลา (วัน)", "เดือนติดต่อกัน", "เบี้ยขยัน (บาท)"],
      ...(rows ?? []).map((r) => [r.employee_code, r.salary_code ?? "", fullName(r), r.position ?? "", r.absent, r.late, r.no_punch, Number(r.leave_days), r.streak, Number(r.amount)]),
    ]);
  }
  return (
    <>
      <Toolbar note={`ได้รับ ${got}/${(rows ?? []).length} คน · รวม ${money(total)} บาท`} onCsv={rows?.length ? csv : undefined} prints={rows?.length ? [{ label: "พิมพ์", onClick: printNow }] : []} />
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ไม่มีพนักงานที่เข้าเงื่อนไข</Empty>
      ) : (
        <>
          <PrintHead title="รายงานเบี้ยขยัน" whName={whName} period={period} />
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line print:overflow-visible print:ring-0">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>พนักงาน</th>
                  <th className={thCls}>รหัสเงินเดือน</th>
                  <th className={`${thCls} text-center`}>ขาด</th>
                  <th className={`${thCls} text-center`}>สาย</th>
                  <th className={`${thCls} text-center`}>ลืมลงเวลา</th>
                  <th className={`${thCls} text-center`}>ลา (วัน)</th>
                  <th className={`${thCls} text-center`}>เดือนติดต่อกัน</th>
                  <th className={`${thCls} text-right`}>บาท</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.user_id} className={Number(r.amount) ? "" : "text-muted"}>
                    <td className={tdCls}>{i + 1}</td>
                    <td className={tdCls}>
                      <span className="font-semibold text-ink">{fullName(r)}</span>
                      <span className="block text-[12px]">{r.employee_code} · {r.position ?? "-"}</span>
                    </td>
                    <td className={tdCls}>{r.salary_code ?? "-"}</td>
                    <td className={`${tdCls} text-center ${r.absent ? "font-bold text-bad" : ""}`}>{r.absent || "-"}</td>
                    <td className={`${tdCls} text-center ${r.late ? "font-bold text-[#7a5410]" : ""}`}>{r.late || "-"}</td>
                    <td className={`${tdCls} text-center`}>{r.no_punch || "-"}</td>
                    <td className={`${tdCls} text-center`}>{Number(r.leave_days) || "-"}</td>
                    <td className={`${tdCls} text-center`}>{r.streak}</td>
                    <td className={`${tdCls} text-right font-bold text-ink`}>{money(Number(r.amount))}</td>
                  </tr>
                ))}
                <tr className="bg-[#f6f8fc] font-bold">
                  <td className={tdCls} colSpan={8}>รวม (ได้รับ {got} คน)</td>
                  <td className={`${tdCls} text-right`}>{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-[13px] text-muted print:hidden">ขั้นบันไดและเหตุที่ไม่ได้ ตั้งที่ ตั้งค่าตัวเลือก → กฎและอัตรา → เบี้ยขยัน/ค่าเดินทาง</p>
          <div className="hidden print:block">
            <Signatures labels={["ผู้จัดทำ", "หัวหน้างาน", "ผู้อนุมัติ"]} />
          </div>
        </>
      )}
    </>
  );
}

// ---------- ค่าเดินทาง ----------
type TravelRow = Person & { days: number; amount: number };

function TravelReport({ wh, whName, range, period }: { wh: string; whName: string; range: Period; period: Period }) {
  const { demo } = useApp();
  const { rows, err } = useRpc<TravelRow>("warehouse_travel", { p_wh: wh, p_from: range.start, p_to: range.end }, () => (demo?.previewTravel() ?? []) as TravelRow[]);
  const total = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  function csv() {
    downloadCsv(`ค่าเดินทาง_${whName.replace(/\s+/g, "")}_${period.start}_${period.end}.csv`, [
      ["รหัสพนักงาน", "รหัสเงินเดือน", "ชื่อ-นามสกุล", "ตำแหน่ง", "วันที่มาทำงาน", "ค่าเดินทาง (บาท)"],
      ...(rows ?? []).map((r) => [r.employee_code, r.salary_code ?? "", fullName(r), r.position ?? "", r.days, Number(r.amount)]),
    ]);
  }
  return (
    <>
      <Toolbar note={`${(rows ?? []).length} คน · รวม ${money(total)} บาท`} onCsv={rows?.length ? csv : undefined} prints={rows?.length ? [{ label: "พิมพ์", onClick: printNow }] : []} />
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ยังไม่มีพนักงานที่ติ๊ก &quot;ได้ค่าเดินทาง&quot; ในทะเบียน</Empty>
      ) : (
        <>
          <PrintHead title="รายงานค่าเดินทาง" whName={whName} period={period} />
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line print:overflow-visible print:ring-0">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>พนักงาน</th>
                  <th className={thCls}>รหัสเงินเดือน</th>
                  <th className={`${thCls} text-center`}>วันที่มาทำงาน</th>
                  <th className={`${thCls} text-right`}>บาท</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.user_id}>
                    <td className={tdCls}>{i + 1}</td>
                    <td className={tdCls}>
                      <span className="font-semibold">{fullName(r)}</span>
                      <span className="block text-[12px] text-muted">{r.employee_code} · {r.position ?? "-"}</span>
                    </td>
                    <td className={tdCls}>{r.salary_code ?? "-"}</td>
                    <td className={`${tdCls} text-center`}>{r.days}</td>
                    <td className={`${tdCls} text-right font-bold`}>{money(Number(r.amount))}</td>
                  </tr>
                ))}
                <tr className="bg-[#f6f8fc] font-bold">
                  <td className={tdCls} colSpan={4}>รวม</td>
                  <td className={`${tdCls} text-right`}>{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-[13px] text-muted print:hidden">นับวันที่มีเวลาเข้าหรือออกงาน × อัตรา ณ วันนั้น (ตั้งค่าตัวเลือก → กฎและอัตรา)</p>
          <div className="hidden print:block">
            <Signatures labels={["ผู้จัดทำ", "หัวหน้างาน", "ผู้อนุมัติ"]} />
          </div>
        </>
      )}
    </>
  );
}

// ---------- สรุปการลา ----------
type LeaveSumRow = Person & { leave_type: string; days: number; requests: number };

function LeaveReport({ wh, whName, period }: { wh: string; whName: string; period: Period }) {
  const { demo } = useApp();
  const opts = useOptions(["leave_type"]);
  const typeOpts = demo ? demo.PREVIEW_LEAVE_TYPES : opts.leave_type;
  const { rows, err } = useRpc<LeaveSumRow>("warehouse_leave_summary", { p_wh: wh, p_from: period.start, p_to: period.end }, () => (demo?.previewLeaveSummary() ?? []) as LeaveSumRow[]);
  const types = [...new Set((rows ?? []).map((r) => r.leave_type))];
  const people = useMemo(() => {
    const m = new Map<string, { p: LeaveSumRow; by: Record<string, number> }>();
    for (const r of rows ?? []) {
      const x = m.get(r.user_id) ?? { p: r, by: {} };
      x.by[r.leave_type] = Number(r.days);
      m.set(r.user_id, x);
    }
    return [...m.values()];
  }, [rows]);
  function csv() {
    downloadCsv(`สรุปการลา_${whName.replace(/\s+/g, "")}_${period.start}_${period.end}.csv`, [
      ["รหัสพนักงาน", "ชื่อ-นามสกุล", "ตำแหน่ง", ...types.map((t) => `ลา${labelOf(typeOpts, t)} (วัน)`), "รวม (วัน)"],
      ...people.map(({ p, by }) => [p.employee_code, fullName(p), p.position ?? "", ...types.map((t) => by[t] ?? 0), Object.values(by).reduce((s, d) => s + d, 0)]),
    ]);
  }
  return (
    <>
      <Toolbar note="นับเฉพาะใบลาที่อนุมัติแล้ว ส่วนที่อยู่ในรอบนี้" onCsv={people.length ? csv : undefined} prints={people.length ? [{ label: "พิมพ์", onClick: printNow }] : []} />
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !people.length ? (
        <Empty>ไม่มีการลาที่อนุมัติในรอบนี้</Empty>
      ) : (
        <>
          <PrintHead title="สรุปการลา" whName={whName} period={period} />
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line print:overflow-visible print:ring-0">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>#</th>
                  <th className={thCls}>พนักงาน</th>
                  {types.map((t) => (
                    <th key={t} className={`${thCls} text-center`}>ลา{labelOf(typeOpts, t)}</th>
                  ))}
                  <th className={`${thCls} text-center`}>รวม</th>
                </tr>
              </thead>
              <tbody>
                {people.map(({ p, by }, i) => (
                  <tr key={p.user_id}>
                    <td className={tdCls}>{i + 1}</td>
                    <td className={tdCls}>
                      <span className="font-semibold">{fullName(p)}</span>
                      <span className="block text-[12px] text-muted">{p.employee_code} · {p.position ?? "-"}</span>
                    </td>
                    {types.map((t) => (
                      <td key={t} className={`${tdCls} text-center`}>{by[t] ?? "-"}</td>
                    ))}
                    <td className={`${tdCls} text-center font-bold`}>{Object.values(by).reduce((s, d) => s + d, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 px-1 text-[13px] text-muted print:hidden">ดูรายละเอียดแต่ละใบได้ที่หน้าอนุมัติใบลา → ประวัติ</p>
        </>
      )}
    </>
  );
}
