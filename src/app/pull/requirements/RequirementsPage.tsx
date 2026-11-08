"use client";

// ผลคำนวณกำลังคนที่ต้องการ (สไลด์ "ตรรกะก่อนดึงคน" ขั้นที่ 6): สูตร + ตารางรายทักษะ ตรวจสอบย้อนกลับได้ทุกตัวเลข
// ตัวเลขมาจากฟังก์ชัน pull_requirement_rows / pull_requirements ในฐานข้อมูล (โหมดตัวอย่างใช้สูตรเดียวกันในหน้าเว็บ)
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Card, Loading } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { BarDate, BarSelect, PullBar, SkillIcon } from "@/components/pull/PullUI";
import { usePullSelection } from "@/components/pull/usePullSelection";
import { errText, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { shortDay, thaiDate } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays, volumesFor } from "@/lib/pull-data";
import { SHIFT_LABEL, hoursOf, num, requirementRows, skillRequirements, totalRequired, type PullShift, type ReqRow, type SkillReq } from "@/lib/pull";

type Result = { rows: ReqRow[]; reqs: SkillReq[] };

export default function RequirementsPage() {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const today = todayIso();
  const opts = useOptions(["pull_unit"]);
  const unitLabel = (v: string) => opts.pull_unit?.find((u) => u.value === v)?.label ?? v;
  const whs = useMemo(() => {
    const act = warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true }));
    return isGlobal(profile.role) ? act : act.filter((w) => myWarehouseIds.includes(w.id));
  }, [warehouses, myWarehouseIds, profile.role]);
  const { wh, date, shift, setWh, setDate, setShift } = usePullSelection(whs, profile.warehouse_id);
  const [res, setRes] = useState<Result | null>(null);
  const [hoursLabel, setHoursLabel] = useState<Record<PullShift, number | null>>({ morning: null, night: null });
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!wh) return;
    let live = true;
    (async () => {
      try {
        let r: Result;
        let h: Record<PullShift, number | null>;
        if (demo) {
          const cfg = demo.previewPullConfig();
          const rows = requirementRows(cfg, wh, date, shift, volumesFor(demo.previewPullWorkloads(today), date, shift));
          r = { rows, reqs: skillRequirements(cfg, wh, rows) };
          h = { morning: hoursOf(cfg, wh, "morning", date)?.hours ?? null, night: hoursOf(cfg, wh, "night", date)?.hours ?? null };
        } else {
          const [a, b, hm, hn] = await Promise.all([
            sb().rpc("pull_requirement_rows", { p_wh: wh, p_date: date, p_shift: shift }),
            sb().rpc("pull_requirements", { p_wh: wh, p_date: date, p_shift: shift }),
            sb().rpc("pull_hours_at", { p_wh: wh, p_shift: "morning", p_date: date }),
            sb().rpc("pull_hours_at", { p_wh: wh, p_shift: "night", p_date: date }),
          ]);
          const e = a.error ?? b.error ?? hm.error ?? hn.error;
          if (e) throw e;
          const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
          r = {
            rows: ((a.data ?? []) as ReqRow[]).map((x) => ({ ...x, volume: n(x.volume), hours: n(x.hours), per_hour: n(x.per_hour), fte: n(x.fte) })),
            reqs: ((b.data ?? []) as SkillReq[]).map((x) => ({ ...x, fte: n(x.fte), required: n(x.required) })),
          };
          h = { morning: n(hm.data), night: n(hn.data) };
        }
        if (live) {
          setRes(r);
          setHoursLabel(h);
          setErr("");
        }
      } catch (e) {
        if (live) setErr(errText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, wh, date, shift, today]);

  const header = (
    <PullBar title="ผลคำนวณกำลังคนที่ต้องการ" sub={`${thaiDate(date)} · ${SHIFT_LABEL[shift]}`}>
      <BarSelect label="คลัง" value={wh} onChange={setWh}>
        {whs.map((w) => (
          <option key={w.id} value={w.id}>{w.code}</option>
        ))}
      </BarSelect>
      <BarDate value={date} onChange={setDate} max={addDays(today, 90)} />
      <BarSelect label="กะ" value={shift} onChange={(v) => setShift(v as PullShift)}>
        <option value="morning">{SHIFT_LABEL.morning}{hoursLabel.morning ? ` · ${num(hoursLabel.morning)} ชม.` : ""}</option>
        <option value="night">{SHIFT_LABEL.night}{hoursLabel.night ? ` · ${num(hoursLabel.night)} ชม.` : ""}</option>
      </BarSelect>
    </PullBar>
  );

  if (!wh) return <AppShell title="ผลคำนวณกำลังคน" minRole="supervisor" wide>{header}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;

  const total = res ? totalRequired(res.reqs) : null;
  const anyVolume = !!res?.rows.some((r) => r.volume !== null);

  return (
    <AppShell title="ผลคำนวณกำลังคน" minRole="supervisor" wide>
      {header}
      <Formula />
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {!res ? (
        <Loading />
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-brand">ผลการคำนวณรายทักษะ · {shortDay(date)} {SHIFT_LABEL[shift]}</h2>
            <Link href="/pull/workload" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 font-semibold text-brand ring-1 ring-line hover:bg-brand/6">
              <Icon name="leave" size={20} /> {anyVolume ? "แก้ยอดงาน" : "กรอกยอดงาน"}
            </Link>
          </div>
          {!anyVolume && <div className="mt-3"><Alert tone="warning">ยังไม่ได้กรอกยอดงานของวัน/กะนี้ (ยังไม่แสดงจำนวนแทนค่า 0)</Alert></div>}

          <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-line">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_4.5rem_6.5rem_6.5rem_8rem] items-center gap-3 bg-sky px-4 py-3 text-center text-[15px] font-bold text-ink md:grid">
              <span className="text-left">ทักษะ</span>
              <span>ปริมาณงาน</span>
              <span>ชม./กะ</span>
              <span>Productivity</span>
              <span>ผลคำนวณ</span>
              <span>ต้องการ</span>
            </div>
            {res.reqs.map((q) => {
              const rows = res.rows.filter((r) => r.skill_name === q.skill_name);
              const multi = rows.length > 1;
              return (
                <div key={q.skill_name} className="border-t border-line first:border-t-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_4.5rem_6.5rem_6.5rem_8rem]">
                    <span className="flex min-w-0 items-center gap-3">
                      <SkillIcon name={q.skill_name} size={42} />
                      <span className="min-w-0">
                        <span className="block text-[17px] leading-snug font-bold break-words text-ink">{q.skill_name}</span>
                        {multi && <span className="block text-[13px] text-muted">รวม {rows.length} งาน แล้วปัดขึ้นครั้งเดียว</span>}
                      </span>
                    </span>
                    {!multi && rows[0] ? (
                      <Cells r={rows[0]} unitLabel={unitLabel} />
                    ) : (
                      <>
                        <span className="hidden md:block" />
                        <span className="hidden md:block" />
                        <span className="hidden md:block" />
                      </>
                    )}
                    <span className="hidden text-center md:block">
                      <Fte value={q.fte} required={q.required} />
                    </span>
                    <Need q={q} />
                    {!multi && rows[0] && <MobileCalc r={rows[0]} unitLabel={unitLabel} />}
                  </div>
                  {multi &&
                    rows.map((r) => (
                      <div key={r.workload_type_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-dashed border-line bg-paper/60 px-4 py-2 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_4.5rem_6.5rem_6.5rem_8rem]">
                        <span className="pl-[3.25rem] text-[14px] text-muted">↳ {r.type_name}</span>
                        <Cells r={r} unitLabel={unitLabel} />
                        <span className="hidden text-center text-[15px] text-muted md:block">{r.fte === null ? "—" : num(Math.round(r.fte * 100) / 100)}</span>
                        <span className="hidden md:block" />
                        <MobileCalc r={r} unitLabel={unitLabel} />
                      </div>
                    ))}
                </div>
              );
            })}
            {res.reqs.length === 0 && <p className="px-4 py-8 text-center text-muted">ยังไม่ได้ตั้งค่าทักษะที่ดึงได้ของคลังนี้</p>}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line bg-[#f2f9f5] px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_4.5rem_6.5rem_6.5rem_8rem]">
              <span className="flex items-center gap-3 text-xl font-bold text-ink"><Icon name="users" size={30} className="text-brand" /> รวม</span>
              <span className="hidden text-center text-muted md:block">-</span>
              <span className="hidden text-center text-muted md:block">-</span>
              <span className="hidden text-center text-muted md:block">-</span>
              <span className="hidden text-center text-muted md:block">-</span>
              <span className="text-center">
                <span className="text-4xl font-bold text-ok">{total ?? "—"}</span> <span className="font-semibold text-ink">คน</span>
              </span>
            </div>
          </div>
          {total === null && res.reqs.length > 0 && <p className="mt-2 text-[14px] text-muted">รวมจะแสดงเมื่อคำนวณได้ครบทุกทักษะ ทักษะที่ยังไม่ครบแสดง — พร้อมเหตุผล</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl bg-[#fff8e1] p-4 ring-1 ring-[#f2dc8f]">
              <Icon name="bulb" size={24} className="shrink-0 text-warn" />
              <p className="text-[15px] text-ink">
                <b className="text-[#b45309]">หมายเหตุ:</b> ผลลัพธ์ปัดขึ้นเสมอ เพื่อให้มีจำนวนคนเพียงพอต่อการทำงานจริง (คนแบ่งครึ่งไม่ได้ และงานต้องจบภายในกะ)
              </p>
            </div>
            <Link href="/pull" className="inline-flex min-h-14 items-center gap-2 rounded-[14px] border-b-[3px] border-[#146b43] bg-ok px-5 text-[17px] font-semibold text-white hover:bg-[#1a7d50]">
              <Icon name="arrow" size={22} /> ไปหน้าดึงกำลังคน (Pull Board)
            </Link>
          </div>
        </Card>
      )}
    </AppShell>
  );
}

function Formula() {
  const box = (icon: IconName, text: string, dark?: boolean) => (
    <span className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-[15px] font-bold ${dark ? "bg-brand text-white" : "bg-white text-ink ring-1 ring-line"}`}>
      <Icon name={icon} size={22} /> {text}
    </span>
  );
  const op = (s: string) => <span className="text-2xl font-bold text-brand">{s}</span>;
  return (
    <Card className="mb-4 bg-sky">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="mr-2 min-w-0">
          <p className="text-xl font-bold text-ink">สูตรการคำนวณ</p>
          <p className="text-[14px] text-muted">คำนวณจากปริมาณงาน และมาตรฐานผลผลิต (Productivity)</p>
        </div>
        {box("users", "คนที่ต้องการ", true)}
        {op("=")}
        {box("leave", "ปริมาณงาน")}
        {op("÷ (")}
        {box("clock", "ชั่วโมงต่อกะ")}
        {op("×")}
        {box("chart", "Productivity")}
        {op(")")}
        <span className="inline-flex min-h-11 items-center gap-1 rounded-full bg-[#f97316] px-4 font-bold text-white">↑ ปัดขึ้นเสมอ</span>
      </div>
    </Card>
  );
}

function Cells({ r, unitLabel }: { r: ReqRow; unitLabel: (v: string) => string }) {
  return (
    <>
      <span className="hidden text-center md:block">
        {r.volume === null ? <span className="text-[14px] font-semibold text-[#8a6500]">ยังไม่กรอก</span> : <><span className="text-xl font-bold text-ink">{num(r.volume)}</span> <span className="text-[14px]">{unitLabel(r.unit)}</span></>}
        <span className="block text-[12px] text-muted">{r.type_name}</span>
      </span>
      <span className="hidden text-center text-lg font-semibold md:block">{r.hours === null ? <span className="text-[14px] text-[#8a6500]">ยังไม่ตั้ง</span> : num(r.hours)}</span>
      <span className="hidden text-center text-lg font-semibold md:block">{r.per_hour === null ? <span className="text-[14px] text-[#8a6500]">ยังไม่ตั้ง</span> : num(r.per_hour)}</span>
    </>
  );
}

/** มือถือ: แสดงการคำนวณเป็นบรรทัดเดียว เช่น 1,200 ลัง ÷ (8 × 45) = 3.33 */
function MobileCalc({ r, unitLabel }: { r: ReqRow; unitLabel: (v: string) => string }) {
  return (
    <span className="col-span-2 pl-[3.25rem] text-[14px] text-muted md:hidden">
      {r.volume === null ? "ยังไม่กรอกยอด" : `${num(r.volume)} ${unitLabel(r.unit)}`} ÷ ({r.hours === null ? "?" : num(r.hours)} ชม. × {r.per_hour === null ? "?" : num(r.per_hour)}) ={" "}
      <b className="text-ink">{r.fte === null ? "—" : num(Math.round(r.fte * 100) / 100)}</b>
    </span>
  );
}

function Fte({ value, required }: { value: number | null; required: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  const shown = Math.round(value * 100) / 100;
  const rounded = required !== null && required !== shown;
  return (
    <span className="inline-flex flex-col items-center">
      <span className="text-xl font-bold text-muted">{shown.toFixed(2)}</span>
      {rounded && <span className="rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">→ ปัดขึ้นเป็น {required}</span>}
    </span>
  );
}

function Need({ q }: { q: SkillReq }) {
  return (
    <span className={`flex min-h-14 items-center justify-center rounded-xl px-2 text-center ${q.complete ? "bg-[#e6f4ec]" : "bg-[#fff6d6]"}`}>
      {q.complete ? (
        <span><span className="text-4xl leading-none font-bold text-ok">{q.required}</span> <span className="font-semibold text-ink">คน</span></span>
      ) : (
        <span className="text-[13px] leading-tight font-semibold text-[#8a6500]">— {q.missing}</span>
      )}
    </span>
  );
}

