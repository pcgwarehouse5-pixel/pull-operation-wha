"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHelper } from "@/components/Puinun";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { EMP_COLS, empName, ShiftChip, type Emp, type Holiday } from "@/components/shifts/common";
import { ShiftTools, type ToolKey } from "@/components/shifts/ShiftTools";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { thaiDateTime } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import {
  THAI_DAYS_SHORT, addMonths, cellOf, currentMonth, keyOf, mergeGrid, monthDates, shiftDef, shiftTimeText, stage, thaiMonthLabel,
  toRows, todayIso, weekday, type Cell, type Change, type Grid, type ShiftDef,
} from "@/lib/shifts";

type Row = { user_id: string; work_date: string; shift_code: string; holiday_work: Cell["holiday_work"]; is_volunteer: boolean };
type Status = { status: "draft" | "published"; published_at: string | null };
type Brush = { code: string | null; holiday_work: Cell["holiday_work"] };

const HW_LABEL = { OFF: "ทำงานวันหยุดประจำสัปดาห์", HOL: "ทำงานวันนักขัตฤกษ์" } as const;
const WH_KEY = "wha-shifts-wh";

export default function ShiftsPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const opts = useOptions(["shift_type", "position"]);
  const visible = useMemo(
    () => warehouses.filter((w) => w.is_active && (isGlobal(me.role) || myWarehouseIds.includes(w.id))),
    [warehouses, me.role, myWarehouseIds],
  );
  const [wh, setWh] = useState(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(WH_KEY) ?? "";
    } catch {}
    return visible.some((w) => w.id === saved) ? saved : (visible.find((w) => w.id === me.warehouse_id) ?? visible[0])?.id ?? "";
  });
  const [ym, setYm] = useState(currentMonth);
  const dates = useMemo(() => monthDates(ym), [ym]);
  const [emps, setEmps] = useState<Emp[] | null>(null);
  const [base, setBase] = useState<Grid>({});
  const [pending, setPending] = useState<Record<string, Cell | null>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [view, setView] = useState<"month" | "day">("month");
  const [day, setDay] = useState(() => todayIso());
  const [pos, setPos] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [cellEdit, setCellEdit] = useState<{ emp: Emp; date: string } | null>(null);
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);
  const painting = useRef(false);
  const [source, setSource] = useState("manual"); // ที่มาของการแก้ล่าสุด (บันทึกในประวัติ)

  const defs = useMemo(() => new Map((opts.shift_type ?? []).map((o) => [o.value, shiftDef(o)])), [opts.shift_type]);
  const activeDefs = useMemo(() => (opts.shift_type ?? []).filter((o) => o.is_active).map(shiftDef), [opts.shift_type]);
  const posOrder = useMemo(() => new Map((opts.position ?? []).map((o, i) => [o.value, i])), [opts.position]);
  const nChanges = Object.keys(pending).length;

  const load = useCallback(async () => {
    if (!wh) return;
    setEmps(null);
    setPending({});
    setSource("manual");
    setMsg(null);
    const from = dates[0];
    const to = addMonths(ym, 1) + "-01";
    try {
      let people: Emp[];
      let rows: Row[];
      let st: Status | null = null;
      let hol: Holiday[];
      if (demo) {
        people = demo.previewRoster(wh);
        rows = demo.previewShifts(dates).filter((r) => people.some((p) => p.id === r.user_id));
        hol = demo.PREVIEW_HOLIDAYS.filter((h) => h.holiday_date >= from && h.holiday_date < to);
      } else {
        const [p, r, s, h] = await Promise.all([
          fetchAll<Emp>((f, t) => sb().from("profiles").select(EMP_COLS).eq("warehouse_id", wh).order("employee_code").range(f, t)),
          fetchAll<Row & { profiles: unknown }>((f, t) =>
            sb()
              .from("shift_schedules")
              .select("user_id, work_date, shift_code, holiday_work, is_volunteer, profiles!inner(warehouse_id)")
              .eq("profiles.warehouse_id", wh)
              .gte("work_date", from)
              .lt("work_date", to)
              .order("user_id")
              .order("work_date")
              .range(f, t),
          ),
          sb().from("schedule_months").select("status, published_at").eq("warehouse_id", wh).eq("month", from).maybeSingle(),
          sb().from("holidays").select("holiday_date, name").gte("holiday_date", from).lt("holiday_date", to).order("holiday_date"),
        ]);
        people = p;
        rows = r;
        st = (s.data as Status | null) ?? null;
        hol = (h.data ?? []) as Holiday[];
      }
      const g: Grid = {};
      for (const r of rows) (g[r.user_id] ??= {})[r.work_date] = { shift_code: r.shift_code, holiday_work: r.holiday_work, is_volunteer: r.is_volunteer };
      setEmps(people);
      setBase(g);
      setStatus(st);
      setHolidays(hol);
    } catch (e) {
      setEmps([]);
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [wh, ym, dates, demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนคลัง/เดือน
    load();
  }, [load]);

  // เตือนก่อนปิดหน้าถ้ายังไม่ได้บันทึก
  useEffect(() => {
    if (!nChanges) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [nChanges]);

  const grid = useMemo(() => mergeGrid(base, pending), [base, pending]);
  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.holiday_date, h.name])), [holidays]);
  const dayInMonth = dates.includes(day) ? day : dates[0];

  // คนที่แสดงในตาราง: ยังทำงานอยู่และไม่ได้ตั้ง "ไม่แสดงในตารางกะ" + คนที่มีกะในเดือนนี้อยู่แล้ว
  const roster = useMemo(
    () =>
      (emps ?? [])
        .filter((e) => (e.status === "active" && !e.exclude_from_shift) || base[e.id])
        .sort(
          (a, b) =>
            (posOrder.get(a.position ?? "") ?? 999) - (posOrder.get(b.position ?? "") ?? 999) ||
            (a.position ?? "").localeCompare(b.position ?? "", "th") ||
            a.employee_code.localeCompare(b.employee_code),
        ),
    [emps, base, posOrder],
  );
  const positions = useMemo(() => [...new Set(roster.map((e) => e.position ?? ""))].filter(Boolean), [roster]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return roster.filter(
      (e) => (!pos || e.position === pos) && (!t || `${e.employee_code} ${e.first_name_th} ${e.last_name_th ?? ""} ${e.nickname ?? ""}`.toLowerCase().includes(t)),
    );
  }, [roster, pos, q]);

  function changeScope(next: () => void) {
    if (nChanges && !confirm(`ยังไม่ได้บันทึก ${nChanges} ช่อง ต้องการทิ้งการแก้ไขหรือไม่?`)) return;
    next();
  }

  const applyChanges = useCallback(
    (changes: Change[], onlyEmpty = false) => setPending((p) => stage(p, base, changes, onlyEmpty)),
    [base],
  );

  function paint(emp: Emp, date: string) {
    if (!brush) return setCellEdit({ emp, date });
    applyChanges([{ user_id: emp.id, work_date: date, cell: brush.code ? cellOf(brush.code, brush.holiday_work) : null }]);
  }

  async function save() {
    if (!nChanges) return;
    if (demo) {
      setBase(grid);
      setPending({});
      return setMsg({ tone: "success", text: "โหมดดูดีไซน์: ไม่ได้บันทึกจริง" });
    }
    setBusy(true);
    const { data, error } = await sb().rpc("apply_shifts", { p_wh: wh, p_rows: toRows(pending), p_source: source });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: errText(error) });
    await load();
    setMsg({ tone: "success", text: `บันทึกแล้ว ${data} ช่อง${status?.status === "published" ? " (เดือนนี้ประกาศแล้ว พนักงานเห็นทันที)" : ""}` });
  }

  async function setPublished(next: "published" | "draft") {
    const text =
      next === "published"
        ? `ประกาศตารางกะ ${thaiMonthLabel(ym)} ให้พนักงานในคลังเห็น?`
        : `กลับเป็นร่าง? พนักงานจะไม่เห็นตารางกะ ${thaiMonthLabel(ym)} จนกว่าจะประกาศอีกครั้ง`;
    if (!confirm(text)) return;
    if (demo) return setStatus({ status: next, published_at: new Date().toISOString() });
    setBusy(true);
    const { error } = await sb().rpc("set_schedule_status", { p_wh: wh, p_month: dates[0], p_status: next });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setStatus({ status: next, published_at: next === "published" ? new Date().toISOString() : null });
    setMsg({ tone: "success", text: next === "published" ? "ประกาศแล้ว พนักงานเห็นตารางกะเดือนนี้แล้ว" : "กลับเป็นร่างแล้ว" });
  }

  const published = status?.status === "published";
  const whName = visible.find((w) => w.id === wh)?.name ?? "";

  return (
    <AppShell title="ตารางกะ" minRole="supervisor" wide>
      <PageHelper pose="point" title="ตารางกะ">
        วางกะรายเดือนด้วยการแตะช่องหรือใช้เครื่องมือ ตรวจแล้วกด &quot;ประกาศ&quot; พนักงานจึงจะเห็น
      </PageHelper>
      {!visible.length ? (
        <Empty>คุณยังไม่ได้ดูแลคลังใด</Empty>
      ) : (
        <>
          {/* เลือกคลัง เดือน และสถานะ */}
          <Card className="mb-3">
            <div className="flex flex-wrap items-center gap-2">
              {visible.length > 1 && (
                <select
                  className={`${inputCls} !w-auto`}
                  value={wh}
                  aria-label="คลัง"
                  onChange={(e) =>
                    changeScope(() => {
                      setWh(e.target.value);
                      try {
                        localStorage.setItem(WH_KEY, e.target.value);
                      } catch {}
                    })
                  }
                >
                  {visible.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              )}
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" aria-label="เดือนก่อน" onClick={() => changeScope(() => setYm(addMonths(ym, -1)))}>
                  <Icon name="back" size={18} />
                </Button>
                <span className="min-w-36 text-center text-lg font-bold text-brand">{thaiMonthLabel(ym)}</span>
                <Button variant="secondary" size="sm" aria-label="เดือนถัดไป" onClick={() => changeScope(() => setYm(addMonths(ym, 1)))}>
                  <Icon name="next" size={18} />
                </Button>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {published ? (
                  <Badge tone="green">ประกาศแล้ว{status?.published_at ? ` · ${thaiDateTime(status.published_at)}` : ""}</Badge>
                ) : (
                  <Badge tone="amber">ร่าง · พนักงานยังไม่เห็น</Badge>
                )}
                <Button
                  size="sm"
                  variant={published ? "secondary" : "primary"}
                  disabled={busy || !emps || nChanges > 0}
                  title={nChanges ? "บันทึกการแก้ไขก่อน" : ""}
                  onClick={() => setPublished(published ? "draft" : "published")}
                >
                  {published ? "กลับเป็นร่าง" : "ประกาศให้พนักงานเห็น"}
                </Button>
              </div>
            </div>
          </Card>

          {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

          {/* มุมมอง ตัวกรอง เครื่องมือ */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist" aria-label="มุมมอง">
              {(["month", "day"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={`min-h-10 rounded-lg px-4 text-[15px] font-semibold ${view === v ? "bg-brand text-white" : "text-ink"}`}
                  onClick={() => setView(v)}
                >
                  {v === "month" ? "รายเดือน" : "รายวัน"}
                </button>
              ))}
            </div>
            <select className={`${inputCls} !min-h-11 !w-auto`} value={pos} onChange={(e) => setPos(e.target.value)} aria-label="ตำแหน่ง">
              <option value="">ทุกตำแหน่ง</option>
              {positions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input className={`${inputCls} !min-h-11 !w-40 flex-1 sm:!flex-none`} placeholder="ค้นหาชื่อ/รหัส" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
                <Button
                  size="sm"
                  variant={editing ? "primary" : "secondary"}
                  className="flex-1 sm:flex-none"
                  onClick={() => {
                    setEditing(!editing);
                    setBrush(null);
                    setView("month");
                  }}
                >
                  {editing ? "เสร็จการแก้ไข" : "แก้ไขกะ"}
                </Button>
                <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" disabled={!emps} onClick={() => setTool("menu")}>
                  <Icon name="tool" size={18} /> เครื่องมือ
                </Button>
            </div>
          </div>

          {/* แปรงทาสี: เลือกกะแล้วแตะช่อง */}
          {editing && (
            <Card className="mb-3 !p-3">
              <p className="mb-2 text-[14px] text-muted">เลือกกะ แล้วแตะช่องในตาราง (บนคอมลากเมาส์ทาหลายช่องได้) · ไม่เลือกกะ = แตะช่องเพื่อแก้ทีละช่อง</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {activeDefs.map((d) => (
                  <ShiftChip
                    key={d.code}
                    code={d.code}
                    def={d}
                    showLabel
                    selected={brush?.code === d.code}
                    title={shiftTimeText(d) || d.label}
                    onClick={() => setBrush(brush?.code === d.code ? null : { code: d.code, holiday_work: brush?.holiday_work ?? null })}
                  />
                ))}
                <button
                  type="button"
                  className={`min-h-11 rounded-xl bg-white px-3 text-[15px] font-bold whitespace-nowrap text-bad ring-1 ring-line ${brush && brush.code === null ? "ring-4 ring-ink/70 ring-offset-2" : ""}`}
                  onClick={() => setBrush(brush && brush.code === null ? null : { code: null, holiday_work: null })}
                  aria-pressed={!!brush && brush.code === null}
                >
                  ลบกะ
                </button>
              </div>
              {brush?.code && defs.get(brush.code)?.working && (
                <select
                  className={`${inputCls} mt-2 !min-h-10 !w-auto`}
                  value={brush.holiday_work ?? ""}
                  onChange={(e) => setBrush({ ...brush, holiday_work: (e.target.value || null) as Cell["holiday_work"] })}
                  aria-label="ประเภทวันทำงาน"
                >
                  <option value="">วันทำงานปกติ</option>
                  <option value="OFF">{HW_LABEL.OFF}</option>
                  <option value="HOL">{HW_LABEL.HOL}</option>
                </select>
              )}
            </Card>
          )}

          {!emps ? (
            <Loading />
          ) : !shown.length ? (
            <Empty>{roster.length ? "ไม่พบพนักงานตามตัวกรอง" : `ยังไม่มีพนักงานใน${whName}`}</Empty>
          ) : view === "month" ? (
            <MonthGrid
              emps={shown}
              dates={dates}
              grid={grid}
              pending={pending}
              defs={defs}
              holidayMap={holidayMap}
              editing={editing}
              onCell={(emp, date) => (editing ? paint(emp, date) : setCellEdit({ emp, date }))}
              onPaint={(emp, date) => painting.current && brush && paint(emp, date)}
              setPainting={(v) => (painting.current = v && !!brush)}
            />
          ) : (
            <DayView emps={shown} dates={dates} day={dayInMonth} setDay={setDay} grid={grid} defs={defs} holidayMap={holidayMap} />
          )}

          <Legend defs={activeDefs} />

          {/* แถบบันทึก */}
          {nChanges > 0 && (
            <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 px-3 lg:bottom-4 lg:left-64">
              <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-white shadow-2xl">
                <span className="flex-1 text-[15px]">แก้ไขแล้ว {nChanges} ช่อง ยังไม่บันทึก</span>
                <Button size="sm" variant="ghost" className="!text-white" onClick={() => (setPending({}), setSource("manual"))} disabled={busy}>
                  ยกเลิก
                </Button>
                <Button size="sm" onClick={save} disabled={busy}>
                  {busy ? "กำลังบันทึก..." : "บันทึก"}
                </Button>
              </div>
            </div>
          )}

          {nChanges > 0 && <div className="h-20" aria-hidden="true" />}

          {cellEdit && (
            <CellModal
              emp={cellEdit.emp}
              date={cellEdit.date}
              cell={grid[cellEdit.emp.id]?.[cellEdit.date] ?? null}
              defs={activeDefs}
              allDefs={defs}
              holiday={holidayMap.get(cellEdit.date)}
              onClose={() => setCellEdit(null)}
              onPick={(cell) => {
                applyChanges([{ user_id: cellEdit.emp.id, work_date: cellEdit.date, cell }]);
                setCellEdit(null);
              }}
            />
          )}

          {tool && (
            <ShiftTools
              tool={tool}
              setTool={setTool}
              wh={wh}
              whName={whName}
              ym={ym}
              dates={dates}
              emps={shown}
              allEmps={roster}
              base={base}
              grid={grid}
              defs={defs}
              activeDefs={activeDefs}
              holidays={holidays}
              nChanges={nChanges}
              applyChanges={(c, onlyEmpty, src) => {
                applyChanges(c, onlyEmpty);
                setSource(src);
                setEditing(true);
                setView("month");
              }}
              reload={load}
              setMsg={setMsg}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

// ---------- ตารางรายเดือน ----------
function MonthGrid({
  emps, dates, grid, pending, defs, holidayMap, editing, onCell, onPaint, setPainting,
}: {
  emps: Emp[];
  dates: string[];
  grid: Grid;
  pending: Record<string, Cell | null>;
  defs: Map<string, ShiftDef>;
  holidayMap: Map<string, string>;
  editing: boolean;
  onCell: (e: Emp, d: string) => void;
  onPaint: (e: Emp, d: string) => void;
  setPainting: (v: boolean) => void;
}) {
  useEffect(() => {
    const stop = () => setPainting(false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, [setPainting]);

  const working = (d: string) => emps.filter((e) => defs.get(grid[e.id]?.[d]?.shift_code ?? "")?.working).length;

  return (
    <div className={`max-h-[70vh] overflow-auto rounded-2xl bg-white ring-1 ring-line ${editing ? "select-none" : ""}`}>
      <table className="border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 min-w-32 border-b border-r border-line bg-white px-2 py-1.5 text-left font-semibold sm:min-w-44">
              พนักงาน ({emps.length})
            </th>
            {dates.map((d) => {
              const wd = weekday(d);
              const hol = holidayMap.get(d);
              return (
                <th
                  key={d}
                  title={hol}
                  className={`sticky top-0 z-20 min-w-10 border-b border-line px-0.5 py-1 text-center font-semibold ${hol ? "bg-[#fce6e7] text-bad" : wd === 0 || wd === 6 ? "bg-[#eef2fa]" : "bg-white"}`}
                >
                  <span className="block text-[14px] leading-tight">{Number(d.slice(8))}</span>
                  <span className="block text-[11px] font-normal">{hol ? "หยุด" : THAI_DAYS_SHORT[wd]}</span>
                </th>
              );
            })}
            <th className="sticky top-0 z-20 min-w-14 border-b border-l border-line bg-white px-1 text-center text-[12px] font-semibold">วันทำงาน</th>
          </tr>
        </thead>
        <tbody>
          {emps.map((e) => {
            const row = grid[e.id] ?? {};
            const workDays = dates.filter((d) => defs.get(row[d]?.shift_code ?? "")?.working).length;
            return (
              <tr key={e.id}>
                <th scope="row" className="sticky left-0 z-10 max-w-32 border-b border-r border-line bg-white px-2 py-1 text-left font-normal sm:max-w-44">
                  <span className="block truncate font-semibold">{empName(e)}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {e.employee_code} · {e.position ?? "-"}
                    {e.status === "resigned" ? " · ลาออก" : ""}
                  </span>
                </th>
                {dates.map((d) => {
                  const c = row[d];
                  const def = c ? defs.get(c.shift_code) : undefined;
                  const changed = keyOf(e.id, d) in pending;
                  return (
                    <td key={d} className="border-b border-line p-0.5">
                      <button
                        type="button"
                        onPointerDown={() => setPainting(true)}
                        onPointerEnter={() => onPaint(e, d)}
                        onClick={() => onCell(e, d)}
                        aria-label={`${empName(e)} วันที่ ${Number(d.slice(8))}: ${c?.shift_code ?? "ว่าง"}`}
                        className={`relative flex h-10 w-10 items-center justify-center rounded-md text-[11px] leading-none font-bold ${c ? "" : "bg-paper text-muted/60"} ${changed ? "outline-2 outline-offset-1 outline-ink outline-dashed" : ""}`}
                        style={c ? { background: def?.bg ?? "#94a3b8", color: def?.text ?? "#fff" } : undefined}
                      >
                        {c ? c.shift_code.slice(0, 5) : "·"}
                        {c?.holiday_work && (
                          <span className="absolute -top-1 -right-1 rounded-full bg-warn px-1 text-[9px] text-ink" title={HW_LABEL[c.holiday_work]}>
                            {c.holiday_work === "HOL" ? "น" : "ห"}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
                <td className="border-b border-l border-line text-center font-semibold">{workDays}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="sticky bottom-0 left-0 z-30 border-t border-r border-line bg-[#f6f8fc] px-2 py-1.5 text-left text-[12px] font-semibold">คนทำงาน/วัน</th>
            {dates.map((d) => (
              <td key={d} className="sticky bottom-0 z-20 border-t border-line bg-[#f6f8fc] text-center font-bold text-brand">{working(d)}</td>
            ))}
            <td className="sticky bottom-0 z-20 border-t border-l border-line bg-[#f6f8fc]" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------- มุมมองรายวัน (เหมาะกับมือถือ) ----------
function DayView({
  emps, dates, day, setDay, grid, defs, holidayMap,
}: {
  emps: Emp[];
  dates: string[];
  day: string;
  setDay: (d: string) => void;
  grid: Grid;
  defs: Map<string, ShiftDef>;
  holidayMap: Map<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [day]);

  const groups = new Map<string, Emp[]>();
  for (const e of emps) {
    const code = grid[e.id]?.[day]?.shift_code ?? "";
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push(e);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const da = defs.get(a);
    const db = defs.get(b);
    if (!a || !b) return a ? -1 : 1;
    if (!!da?.working !== !!db?.working) return da?.working ? -1 : 1;
    return (da?.start ?? 9999) - (db?.start ?? 9999) || a.localeCompare(b);
  });
  const workingCount = emps.filter((e) => defs.get(grid[e.id]?.[day]?.shift_code ?? "")?.working).length;

  return (
    <div>
      <div ref={ref} className="-mx-3 mb-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-1.5">
          {dates.map((d) => {
            const wd = weekday(d);
            const hol = holidayMap.has(d);
            return (
              <button
                key={d}
                data-day={d}
                type="button"
                onClick={() => setDay(d)}
                aria-pressed={d === day}
                className={`flex h-14 w-12 flex-col items-center justify-center rounded-xl text-[13px] ${d === day ? "bg-brand text-white" : hol ? "bg-[#fce6e7] text-bad" : "bg-white ring-1 ring-line"} ${wd === 0 && d !== day ? "text-bad" : ""}`}
              >
                <span className="text-[17px] font-bold leading-none">{Number(d.slice(8))}</span>
                <span>{THAI_DAYS_SHORT[wd]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mb-2 px-1 font-semibold text-brand">
        ทำงาน {workingCount} คน{holidayMap.get(day) ? ` · ${holidayMap.get(day)}` : ""}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {order.map((code) => {
          const def = defs.get(code);
          const list = groups.get(code)!;
          return (
            <Card key={code || "none"} className="!p-3.5">
              <div className="mb-2 flex items-center gap-2">
                {code ? <ShiftChip code={code} def={def} /> : <Badge>ยังไม่มีกะ</Badge>}
                <span className="text-[14px] text-muted">{shiftTimeText(def)}</span>
                <span className="ml-auto text-lg font-bold">{list.length} คน</span>
              </div>
              <ul className="divide-y divide-line">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{empName(e)}</span>
                    {grid[e.id]?.[day]?.holiday_work && <Badge tone="amber">{HW_LABEL[grid[e.id][day].holiday_work!]}</Badge>}
                    <span className="text-[13px] text-muted">{e.position ?? "-"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------- แก้ทีละช่อง ----------
function CellModal({
  emp, date, cell, defs, allDefs, holiday, onClose, onPick,
}: {
  emp: Emp;
  date: string;
  cell: Cell | null;
  defs: ShiftDef[];
  allDefs: Map<string, ShiftDef>;
  holiday?: string;
  onClose: () => void;
  onPick: (c: Cell | null) => void;
}) {
  const [hw, setHw] = useState<Cell["holiday_work"]>(cell?.holiday_work ?? (holiday ? "HOL" : null));
  const label = `${Number(date.slice(8))} ${thaiMonthLabel(date.slice(0, 7))} (${THAI_DAYS_SHORT[weekday(date)]})`;
  return (
    <Modal title={empName(emp)} onClose={onClose}>
      <p className="-mt-2 mb-3 text-muted">
        {label}
        {holiday ? ` · ${holiday}` : ""}
        {cell ? ` · ตอนนี้: ${cell.shift_code}` : " · ยังไม่มีกะ"}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {defs.map((d) => (
          <ShiftChip
            key={d.code}
            code={d.code}
            def={d}
            showLabel
            selected={cell?.shift_code === d.code}
            title={shiftTimeText(d) || d.label}
            onClick={() => onPick(cellOf(d.code, d.working ? hw : null))}
          />
        ))}
      </div>
      <fieldset className="mb-4">
        <legend className="mb-1.5 text-[15px] font-semibold">ถ้าเป็นกะทำงาน</legend>
        {([null, "OFF", "HOL"] as const).map((v) => (
          <label key={v ?? "n"} className="flex min-h-11 items-center gap-3">
            <input type="radio" className="h-5 w-5 accent-brand" name="hw" checked={hw === v} onChange={() => setHw(v)} />
            {v ? HW_LABEL[v] : "วันทำงานปกติ"}
          </label>
        ))}
        {cell && allDefs.get(cell.shift_code)?.working && hw !== cell.holiday_work && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={() => onPick({ ...cell, holiday_work: hw })}>
            ใช้กับกะเดิม ({cell.shift_code})
          </Button>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>ปิด</Button>
        {cell && (
          <Button variant="danger" className="flex-1" onClick={() => onPick(null)}>ลบกะช่องนี้</Button>
        )}
      </div>
    </Modal>
  );
}

function Legend({ defs }: { defs: ShiftDef[] }) {
  if (!defs.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[13px] text-muted">
      {defs.map((d) => (
        <span key={d.code} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-3.5 rounded" style={{ background: d.bg }} aria-hidden="true" />
          <b className="text-ink">{d.code}</b> {shiftTimeText(d) || d.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-warn px-1 text-[10px] text-ink">ห</span> {HW_LABEL.OFF}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-warn px-1 text-[10px] text-ink">น</span> {HW_LABEL.HOL}
      </span>
    </div>
  );
}
