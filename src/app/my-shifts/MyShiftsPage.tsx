"use client";

// ตารางกะของฉัน: ปฏิทินของตัวเอง + เพื่อนร่วมคลังรายวัน (เห็นเฉพาะเดือนที่ประกาศแล้ว)
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ShiftChip, empName, type Holiday } from "@/components/shifts/common";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { THAI_DAYS_SHORT, addMonths, currentMonth, monthDates, shiftDef, shiftTimeText, thaiMonthLabel, todayIso, weekday, type ShiftDef } from "@/lib/shifts";

type TeamRow = { user_id: string; first_name_th: string; nickname: string | null; position: string | null; work_date: string; shift_code: string; holiday_work: "OFF" | "HOL" | null };

export default function MyShiftsPage() {
  const { profile: me, demo } = useApp();
  const opts = useOptions(["shift_type"]);
  const defs = useMemo(() => new Map((opts.shift_type ?? []).map((o) => [o.value, shiftDef(o)])), [opts.shift_type]);
  const [ym, setYm] = useState(currentMonth);
  const dates = useMemo(() => monthDates(ym), [ym]);
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [published, setPublished] = useState(false);
  const [day, setDay] = useState(todayIso);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setRows(null);
    setErr("");
    const from = dates[0];
    const to = addMonths(ym, 1) + "-01";
    if (demo) {
      setRows(demo.previewTeam(dates, me.id));
      setHolidays(demo.PREVIEW_HOLIDAYS.filter((h) => h.holiday_date >= from && h.holiday_date < to));
      setPublished(true);
      return;
    }
    try {
      const [team, hol, st] = await Promise.all([
        fetchAll<TeamRow>((f, t) => sb().rpc("team_schedule", { p_month: from }).range(f, t)),
        sb().from("holidays").select("holiday_date, name").gte("holiday_date", from).lt("holiday_date", to).order("holiday_date"),
        me.warehouse_id
          ? sb().from("schedule_months").select("status").eq("warehouse_id", me.warehouse_id).eq("month", from).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setRows(team);
      setHolidays((hol.data ?? []) as Holiday[]);
      setPublished((st.data as { status?: string } | null)?.status === "published");
    } catch (e) {
      setRows([]);
      setErr(errText(e));
    }
  }, [dates, ym, demo, me]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนเดือน
    load();
  }, [load]);

  const mine = useMemo(() => new Map((rows ?? []).filter((r) => r.user_id === me.id).map((r) => [r.work_date, r])), [rows, me.id]);
  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.holiday_date, h.name])), [holidays]);
  const selected = dates.includes(day) ? day : dates[0];
  const workDays = [...mine.values()].filter((r) => defs.get(r.shift_code)?.working).length;
  const lead = weekday(dates[0]); // ช่องว่างก่อนวันที่ 1 (ปฏิทินเริ่มวันอาทิตย์)

  return (
    <AppShell title="ตารางกะของฉัน">
      <div className="mb-3 flex items-center justify-center gap-2">
        <Button variant="secondary" size="sm" aria-label="เดือนก่อน" onClick={() => setYm(addMonths(ym, -1))}>
          <Icon name="back" size={18} />
        </Button>
        <span className="min-w-40 text-center text-xl font-bold text-brand">{thaiMonthLabel(ym)}</span>
        <Button variant="secondary" size="sm" aria-label="เดือนถัดไป" onClick={() => setYm(addMonths(ym, 1))}>
          <Icon name="next" size={18} />
        </Button>
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !published ? (
        <Empty>ตารางกะ{thaiMonthLabel(ym)}ยังไม่ประกาศ รอหัวหน้างานประกาศก่อน</Empty>
      ) : (
        <>
          <Card className="mb-3 !p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="font-semibold">กะของฉัน</span>
              <Badge tone="blue">ทำงาน {workDays} วัน</Badge>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {THAI_DAYS_SHORT.map((d, i) => (
                <span key={d} className={`text-[13px] font-semibold ${i === 0 ? "text-bad" : "text-muted"}`}>{d}</span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {dates.map((d) => {
                const r = mine.get(d);
                const def = r ? defs.get(r.shift_code) : undefined;
                const hol = holidayMap.get(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    aria-pressed={d === selected}
                    aria-label={`วันที่ ${Number(d.slice(8))} ${r ? r.shift_code : "ไม่มีกะ"}${hol ? ` ${hol}` : ""}`}
                    className={`flex min-h-14 flex-col items-center justify-center rounded-lg text-[12px] ${d === selected ? "ring-2 ring-brand ring-offset-1" : ""} ${hol && !r ? "bg-[#fce6e7]" : !r ? "bg-paper" : ""}`}
                    style={r ? { background: def?.bg ?? "#94a3b8", color: def?.text ?? "#fff" } : undefined}
                  >
                    <span className={`text-[15px] font-bold leading-none ${!r && hol ? "text-bad" : ""}`}>{Number(d.slice(8))}</span>
                    <span className="mt-0.5 font-semibold leading-none">{r ? r.shift_code.slice(0, 5) : ""}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          <DayDetail day={selected} rows={rows} meId={me.id} defs={defs} holiday={holidayMap.get(selected)} />
        </>
      )}
    </AppShell>
  );
}

function DayDetail({ day, rows, meId, defs, holiday }: { day: string; rows: TeamRow[]; meId: string; defs: Map<string, ShiftDef>; holiday?: string }) {
  const today = rows.filter((r) => r.work_date === day);
  const mine = today.find((r) => r.user_id === meId);
  const groups = new Map<string, TeamRow[]>();
  for (const r of today) {
    if (!groups.has(r.shift_code)) groups.set(r.shift_code, []);
    groups.get(r.shift_code)!.push(r);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const da = defs.get(a);
    const db = defs.get(b);
    if (!!da?.working !== !!db?.working) return da?.working ? -1 : 1;
    return (da?.start ?? 9999) - (db?.start ?? 9999) || a.localeCompare(b);
  });
  const label = `${THAI_DAYS_SHORT[weekday(day)]}. ${Number(day.slice(8))} ${thaiMonthLabel(day.slice(0, 7))}`;

  return (
    <div>
      <Card className="mb-3">
        <p className="text-[15px] text-muted">{label}{holiday ? ` · ${holiday}` : ""}</p>
        {mine ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ShiftChip code={mine.shift_code} def={defs.get(mine.shift_code)} />
            <span className="text-lg font-semibold">{shiftTimeText(defs.get(mine.shift_code)) || defs.get(mine.shift_code)?.label}</span>
            {mine.holiday_work && <Badge tone="amber">{mine.holiday_work === "HOL" ? "ทำงานวันนักขัตฤกษ์" : "ทำงานวันหยุดประจำสัปดาห์"}</Badge>}
          </div>
        ) : (
          <p className="mt-1 text-lg font-semibold">ไม่มีกะ</p>
        )}
      </Card>
      <h3 className="mb-2 px-1 font-semibold text-brand">เพื่อนร่วมคลังวันนี้</h3>
      {!today.length ? (
        <Empty>ไม่มีข้อมูลกะของวันนี้</Empty>
      ) : (
        <div className="space-y-3">
          {order.map((code) => (
            <Card key={code} className="!p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <ShiftChip code={code} def={defs.get(code)} />
                <span className="text-[14px] text-muted">{shiftTimeText(defs.get(code))}</span>
                <span className="ml-auto font-bold">{groups.get(code)!.length} คน</span>
              </div>
              <ul className="divide-y divide-line">
                {groups.get(code)!.map((r) => (
                  <li key={r.user_id} className={`flex items-center gap-2 py-1.5 ${r.user_id === meId ? "font-bold text-brand" : ""}`}>
                    <span className="min-w-0 flex-1 truncate">{empName(r)}{r.user_id === meId ? " (ฉัน)" : ""}</span>
                    <span className="text-[13px] text-muted">{r.position ?? "-"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
