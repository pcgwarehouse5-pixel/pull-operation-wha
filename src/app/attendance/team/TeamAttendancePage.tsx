"use client";

// ติดตามการเข้างาน (หัวหน้างานขึ้นไป): รายวัน / สรุปรายเดือน / อนุมัติคำขอแก้เวลา
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { CorrectionModal } from "@/components/attendance/CorrectionModal";
import { RejectModal } from "@/components/attendance/RejectModal";
import { empName } from "@/components/shifts/common";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { downloadCsv } from "@/lib/csv";
import { shortDay, thaiTime } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays, addMonths, currentMonth, monthDates, thaiMonthLabel, todayIso } from "@/lib/shifts";
import { PROBLEM, STATUS, hhmm, type AttendanceStatus, type Correction, type TeamAttendanceRow } from "@/lib/attendance";

type Tab = "day" | "month" | "fix";
type Msg = { tone: "success" | "error"; text: string };
type Fix = Correction & { profiles: { employee_code: string; first_name_th: string; nickname: string | null; position: string | null } };

export default function TeamAttendancePage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const visible = useMemo(() => warehouses.filter((w) => w.is_active && (isGlobal(me.role) || myWarehouseIds.includes(w.id))), [warehouses, me.role, myWarehouseIds]);
  const [wh, setWh] = useState((visible.find((w) => w.id === me.warehouse_id) ?? visible[0])?.id ?? "");
  const [tab, setTab] = useState<Tab>("day");
  const [msg, setMsg] = useState<Msg | null>(null);
  const [nFix, setNFix] = useState(0);

  return (
    <AppShell title="ติดตามการเข้างาน" minRole="supervisor" wide>
      {!visible.length ? (
        <Empty>คุณยังไม่ได้ดูแลคลังใด</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {visible.length > 1 && (
              <select className={`${inputCls} !w-auto`} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
                {visible.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            )}
            <div className="flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
              {([["day", "รายวัน"], ["month", "สรุปรายเดือน"], ["fix", `คำขอแก้เวลา${nFix ? ` (${nFix})` : ""}`]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 rounded-lg px-3 text-[15px] font-semibold ${tab === k ? "bg-brand text-white" : "text-ink"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
          {tab === "day" && <DayTab wh={wh} demo={!!demo} setMsg={setMsg} />}
          {tab === "month" && <MonthTab wh={wh} whName={visible.find((w) => w.id === wh)?.name ?? ""} setMsg={setMsg} />}
          <FixTab wh={wh} hidden={tab !== "fix"} setMsg={setMsg} setCount={setNFix} />
        </>
      )}
    </AppShell>
  );
}

function useTeamRows(wh: string, from: string, to: string) {
  const { demo } = useApp();
  const [rows, setRows] = useState<TeamAttendanceRow[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setRows(null);
    setErr("");
    if (demo) {
      const dates = monthDates(from.slice(0, 7)).filter((d) => d >= from && d <= to);
      return setRows(demo.previewTeamAttendance(dates, todayIso()) as TeamAttendanceRow[]);
    }
    const { data, error } = await sb().rpc("warehouse_attendance", { p_wh: wh, p_from: from, p_to: to });
    if (error) setErr(errText(error));
    setRows((data ?? []) as TeamAttendanceRow[]);
  }, [demo, wh, from, to]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนคลัง/วันที่
    if (wh) load();
  }, [load, wh]);
  return { rows, err, reload: load };
}

// ---------- รายวัน ----------
function DayTab({ wh, demo, setMsg }: { wh: string; demo: boolean; setMsg: (m: Msg | null) => void }) {
  const [day, setDay] = useState(todayIso);
  const [filter, setFilter] = useState<"all" | "problem" | AttendanceStatus>("all");
  const [fixFor, setFixFor] = useState<TeamAttendanceRow | null>(null);
  const { rows, err, reload } = useTeamRows(wh, day, day);

  const counts = useMemo(() => {
    const c: Partial<Record<AttendanceStatus, number>> = {};
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => filter === "all" || (filter === "problem" ? PROBLEM.includes(r.status) : r.status === filter));
  const present = (rows ?? []).filter((r) => r.first_in).length;
  const scheduled = (rows ?? []).filter((r) => r.shift_start).length;
  const problems = (rows ?? []).filter((r) => PROBLEM.includes(r.status)).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="วันก่อน" onClick={() => setDay(addDays(day, -1))}>
          <Icon name="back" size={18} />
        </Button>
        <input type="date" className={`${inputCls} !w-auto`} value={day} max={todayIso()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="วันที่" />
        <Button variant="secondary" size="sm" aria-label="วันถัดไป" disabled={day >= todayIso()} onClick={() => setDay(addDays(day, 1))}>
          <Icon name="next" size={18} />
        </Button>
        <span className="font-semibold text-brand">{shortDay(day)}</span>
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="มาแล้ว" value={`${present}/${scheduled}`} tone="text-ok" />
            <Stat label="ต้องตาม" value={String(problems)} tone={problems ? "text-bad" : "text-muted"} />
            <Stat label="ลา" value={String((counts.leave ?? 0) + (counts.leave_half ?? 0))} tone="text-brand" />
          </div>
          <div className="-mx-3 mb-3 overflow-x-auto px-3">
            <div className="flex w-max gap-1.5">
              <Chip on={filter === "all"} onClick={() => setFilter("all")}>ทั้งหมด {rows.length}</Chip>
              <Chip on={filter === "problem"} onClick={() => setFilter("problem")}>ต้องตาม {problems}</Chip>
              {(Object.keys(counts) as AttendanceStatus[]).map((s) => (
                <Chip key={s} on={filter === s} onClick={() => setFilter(s)}>{STATUS[s].label} {counts[s]}</Chip>
              ))}
            </div>
          </div>
          {!shown.length ? (
            <Empty>ไม่มีรายการ</Empty>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {shown.map((r) => (
                <li key={r.user_id}>
                  <Card className="!p-3">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{empName(r)}</p>
                        <p className="text-[13px] text-muted">
                          {r.employee_code} · {r.position ?? "-"} · กะ {r.shift_code ?? "-"}
                          {r.shift_start && ` ${thaiTime(r.shift_start)}–${thaiTime(r.shift_end)}`}
                        </p>
                      </div>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[14px]">
                      <span>
                        เข้า <b>{thaiTime(r.first_in)}</b> · ออก <b>{thaiTime(r.last_out)}</b>
                        {r.late_min > 0 && <span className="text-[#7a5410]"> · สาย {r.late_min} น.</span>}
                        {r.early_min > 0 && <span className="text-[#7a5410]"> · ออกก่อน {r.early_min} น.</span>}
                        {r.pending_correction && <span className="text-brand"> · มีคำขอแก้เวลา</span>}
                      </span>
                      {!r.pending_correction && ["no_out", "no_in", "absent", "waiting", "late"].includes(r.status) && (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setFixFor(r)}>แก้เวลาแทน</Button>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {fixFor && (
        <CorrectionModal
          date={fixFor.work_date}
          userId={fixFor.user_id}
          who={empName(fixFor)}
          onClose={() => setFixFor(null)}
          onDone={(text) => {
            setFixFor(null);
            setMsg({ tone: "success", text: demo ? text : `${text} (ต้องให้หัวหน้า/แอดมินอีกคนอนุมัติ หรืออนุมัติเองในแท็บคำขอแก้เวลา)` });
            reload();
          }}
        />
      )}
    </>
  );
}

// ---------- สรุปรายเดือน ----------
function MonthTab({ wh, whName, setMsg }: { wh: string; whName: string; setMsg: (m: Msg | null) => void }) {
  const [ym, setYm] = useState(currentMonth);
  const dates = monthDates(ym);
  const to = dates.at(-1)! < todayIso() ? dates.at(-1)! : todayIso();
  const { rows, err } = useTeamRows(wh, dates[0], to);

  const sum = useMemo(() => {
    const m = new Map<string, { r: TeamAttendanceRow; work: number; late: number; lateMin: number; early: number; absent: number; noPunch: number; leave: number; offWork: number }>();
    for (const r of rows ?? []) {
      const s = m.get(r.user_id) ?? { r, work: 0, late: 0, lateMin: 0, early: 0, absent: 0, noPunch: 0, leave: 0, offWork: 0 };
      if (r.first_in || r.last_out) s.work++;
      if (r.late_min > 0) {
        s.late++;
        s.lateMin += r.late_min;
      }
      if (r.early_min > 0) s.early++;
      if (r.status === "absent") s.absent++;
      if (r.status === "no_out" || r.status === "no_in") s.noPunch++;
      if (r.status === "leave") s.leave++;
      if (r.status === "leave_half") s.leave += 0.5;
      if (r.status === "off_worked") s.offWork++;
      m.set(r.user_id, s);
    }
    return [...m.values()];
  }, [rows]);

  function exportCsv() {
    const head = ["รหัสพนักงาน", "ชื่อ", "ตำแหน่ง", "วันที่มาทำงาน", "สาย (ครั้ง)", "สาย (นาที)", "ออกก่อน (ครั้ง)", "ขาด (วัน)", "ลืมเข้า/ออก", "ลา (วัน)", "ทำงานวันหยุด"];
    downloadCsv(`สรุปการเข้างาน_${whName.replace(/\s+/g, "")}_${ym}.csv`, [
      head,
      ...sum.map((s) => [s.r.employee_code, [s.r.first_name_th, s.r.last_name_th].filter(Boolean).join(" "), s.r.position ?? "", s.work, s.late, s.lateMin, s.early, s.absent, s.noPunch, s.leave, s.offWork]),
    ]);
    setMsg({ tone: "success", text: `ส่งออก ${sum.length} คนแล้ว` });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="เดือนก่อน" onClick={() => setYm(addMonths(ym, -1))}>
          <Icon name="back" size={18} />
        </Button>
        <span className="min-w-32 text-center font-bold text-brand">{thaiMonthLabel(ym)}</span>
        <Button variant="secondary" size="sm" aria-label="เดือนถัดไป" disabled={ym >= currentMonth()} onClick={() => setYm(addMonths(ym, 1))}>
          <Icon name="next" size={18} />
        </Button>
        <Button size="sm" variant="secondary" className="ml-auto" disabled={!sum.length} onClick={exportCsv}>ส่งออก CSV</Button>
      </div>
      <p className="mb-2 text-[14px] text-muted">นับถึงวันที่ {shortDay(to)}</p>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !sum.length ? (
        <Empty>ไม่มีข้อมูล</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead className="bg-[#f6f8fc] text-left">
              <tr>
                <th className="sticky left-0 bg-[#f6f8fc] px-3 py-2">พนักงาน</th>
                <th className="px-2 text-center">มาทำงาน</th>
                <th className="px-2 text-center">สาย (ครั้ง/นาที)</th>
                <th className="px-2 text-center">ออกก่อน</th>
                <th className="px-2 text-center">ขาด</th>
                <th className="px-2 text-center">ลืมเข้า/ออก</th>
                <th className="px-2 text-center">ลา</th>
                <th className="px-2 text-center">ทำงานวันหยุด</th>
              </tr>
            </thead>
            <tbody>
              {sum.map((s) => (
                <tr key={s.r.user_id} className="border-t border-line">
                  <td className="sticky left-0 bg-white px-3 py-2">
                    <span className="block font-semibold">{empName(s.r)}</span>
                    <span className="text-[12px] text-muted">{s.r.employee_code} · {s.r.position ?? "-"}</span>
                  </td>
                  <td className="text-center">{s.work}</td>
                  <td className={`text-center ${s.late ? "font-semibold text-[#7a5410]" : ""}`}>{s.late ? `${s.late} / ${s.lateMin}` : "-"}</td>
                  <td className="text-center">{s.early || "-"}</td>
                  <td className={`text-center ${s.absent ? "font-semibold text-bad" : ""}`}>{s.absent || "-"}</td>
                  <td className={`text-center ${s.noPunch ? "font-semibold text-bad" : ""}`}>{s.noPunch || "-"}</td>
                  <td className="text-center">{s.leave || "-"}</td>
                  <td className="text-center">{s.offWork || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- คำขอแก้เวลา ----------
function FixTab({ wh, hidden, setMsg, setCount }: { wh: string; hidden: boolean; setMsg: (m: Msg | null) => void; setCount: (n: number) => void }) {
  const { profile: me, demo } = useApp();
  const [rows, setRows] = useState<Fix[] | null>(null);
  const [reject, setReject] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (demo) {
      const r = demo.previewFixQueue();
      setRows(r);
      return setCount(r.length);
    }
    try {
      const r = await fetchAll<Fix>((f, t) =>
        sb()
          .from("attendance_corrections")
          .select("*, profiles!inner(employee_code, first_name_th, nickname, position, warehouse_id)")
          .eq("profiles.warehouse_id", wh)
          .eq("status", "pending")
          .order("work_date")
          .range(f, t),
      );
      setRows(r);
      setCount(r.length);
    } catch (e) {
      setRows([]);
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [demo, wh, setCount, setMsg]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนคลัง
    if (wh) load();
  }, [load, wh]);

  async function decide(c: Fix, ok: boolean, note?: string) {
    if (ok && !confirm(`อนุมัติแก้เวลา ${c.profiles.first_name_th} วันที่ ${shortDay(c.work_date)}?\nเข้า ${hhmm(c.check_in)} ออก ${hhmm(c.check_out)}`)) return;
    if (demo) return;
    setBusy(true);
    const { error } = await sb().rpc("decide_correction", { p_id: c.id, p_approve: ok, p_note: note ?? null });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setReject(null);
    setMsg({ tone: "success", text: ok ? "อนุมัติแล้ว เวลาถูกบันทึกและล็อก" : "ไม่อนุมัติแล้ว" });
    load();
  }

  if (hidden) return null;
  return (
    <>
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ไม่มีคำขอแก้เวลารออนุมัติ</Empty>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Card className="!p-3.5">
                <p className="font-semibold">{empName(c.profiles)} <span className="font-normal text-muted">· {c.profiles.employee_code} · {c.profiles.position ?? "-"}</span></p>
                <p className="mt-1">
                  {shortDay(c.work_date)} · เข้า <b>{hhmm(c.check_in)}</b> · ออก <b>{hhmm(c.check_out)}</b>
                </p>
                <p className="text-[14px] text-muted">เหตุผล: {c.reason}</p>
                {c.user_id === me.id ? (
                  <p className="mt-2 text-[14px] text-muted">คำขอของคุณเอง ต้องให้คนอื่นอนุมัติ</p>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => setReject(c)}>ไม่อนุมัติ</Button>
                    <Button size="sm" className="flex-1" disabled={busy} onClick={() => decide(c, true)}>อนุมัติ</Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {reject && <RejectModal title="ไม่อนุมัติคำขอแก้เวลา" onClose={() => setReject(null)} onOk={(n) => decide(reject, false, n)} busy={busy} />}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 text-center ring-1 ring-line">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-[13px] text-muted">{label}</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-10 rounded-full px-3.5 text-[14px] font-semibold whitespace-nowrap ${on ? "bg-brand text-white" : "bg-white ring-1 ring-line"}`}>
      {children}
    </button>
  );
}
