"use client";

// ตารางกะของฉัน: ปฏิทินของตัวเอง + เพื่อนร่วมคลังรายวัน (เห็นเฉพาะเดือนที่ประกาศแล้ว)
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PageHelper } from "@/components/Puinun";
import { MyPullBookings } from "@/components/pull/MyPullBookings";
import { ShiftTimeChip, type Holiday } from "@/components/shifts/common";
import { fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { addMonths, currentMonth, fmtMinutes, monthDates, shiftDef, shiftTimeText, todayIso, weekday, type ShiftDef } from "@/lib/shifts";
import { OT_DAY_COLOR, otDayKind } from "@/lib/shift-grid";
import { localizeError, useI18n, type Fmt, type T } from "@/i18n";

type TeamRow = { user_id: string; first_name_th: string; nickname: string | null; position: string | null; work_date: string; shift_code: string; holiday_work: "OFF" | "HOL" | null };

export default function MyShiftsPage() {
  const { profile: me, demo } = useApp();
  const { t, fmt } = useI18n();
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
        fetchAll<TeamRow>((f, tt) => sb().rpc("team_schedule", { p_month: from }).eq("user_id", me.id).range(f, tt)), // เฉพาะกะของฉัน
        sb().from("holidays").select("holiday_date, name").gte("holiday_date", from).lt("holiday_date", to).order("holiday_date"),
        // ประกาศแล้วหรือยัง: ดูตามตารางของฉัน (ปกติ หรือ หัวหน้าคลัง) · 1 เดือนมี 2 แถว (ตารางปกติ + ตารางหัวหน้าคลัง)
        me.warehouse_id ? sb().rpc("is_published_for", { p_user: me.id, p_date: from }) : Promise.resolve({ data: false }),
      ]);
      setRows(team);
      setHolidays((hol.data ?? []) as Holiday[]);
      setPublished(st.data === true);
    } catch (e) {
      setRows([]);
      setErr(localizeError((e as Error).message ?? String(e), t));
    }
  }, [dates, ym, demo, me, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนเดือน
    load();
  }, [load]);

  const mine = useMemo(() => new Map((rows ?? []).filter((r) => r.user_id === me.id).map((r) => [r.work_date, r])), [rows, me.id]);
  const holidayMap = useMemo(() => new Map(holidays.map((h) => [h.holiday_date, h.name])), [holidays]);
  const selected = dates.includes(day) ? day : dates[0];
  const workDays = [...mine.values()].filter((r) => defs.get(r.shift_code)?.working).length;
  const lead = weekday(dates[0]); // ช่องว่างก่อนวันที่ 1 (ปฏิทินเริ่มวันอาทิตย์)
  const today = todayIso();

  return (
    <AppShell title={t("ms.title")}>
      <PageHelper pose="point" title={t("ms.title")}>
        {t("ms.helper")}
      </PageHelper>
      <MyPullBookings />
      <div className="mb-3 flex items-center justify-center gap-2">
        <Button variant="secondary" size="sm" aria-label={t("common.prevMonth")} onClick={() => setYm(addMonths(ym, -1))}>
          <Icon name="back" size={18} />
        </Button>
        <span className="min-w-40 text-center text-xl font-bold text-brand">{fmt.month(ym)}</span>
        <Button variant="secondary" size="sm" aria-label={t("common.nextMonth")} onClick={() => setYm(addMonths(ym, 1))}>
          <Icon name="next" size={18} />
        </Button>
      </div>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : !published ? (
        <Empty pose="please">{t("ms.notPublished", { month: fmt.month(ym) })}</Empty>
      ) : (
        <>
          <Card className="mb-3 !p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="font-semibold">{t("ms.mine")}</span>
              <Badge tone="blue">{t("ms.workDays", { n: workDays })}</Badge>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {fmt.days.map((d, i) => (
                <span key={d} className={`text-[13px] font-semibold ${i === 0 ? "text-bad" : "text-muted"}`}>{d}</span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {dates.map((d) => {
                const r = mine.get(d);
                const def = r ? defs.get(r.shift_code) : undefined;
                const hol = holidayMap.get(d);
                const otDay = otDayKind(r, def, !!hol); // มาทำงานวันหยุด: แดง = OFF, ม่วง = วันหยุดประจำปี
                const color = otDay ? OT_DAY_COLOR[otDay] : { bg: def?.bg ?? "#94a3b8", text: def?.text ?? "#fff" };
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    aria-pressed={d === selected}
                    aria-label={`${fmt.day(d)} ${r ? shiftTimeText(def) || def?.label || r.shift_code : t("ms.noShift")}${hol ? ` ${hol}` : ""}`}
                    className={`relative flex min-h-14 flex-col items-center justify-center rounded-[10px] text-[12px] transition ${d === selected ? "ring-[3px] ring-brand ring-offset-1" : ""} ${hol && !r ? "bg-[#ede4fe]" : !r ? "bg-paper" : ""}`}
                    style={r ? { background: color.bg, color: color.text } : undefined}
                  >
                    <span className={`num text-[15px] leading-none font-bold ${!r && hol ? "text-[#7c3aed]" : ""}`}>{Number(d.slice(8))}</span>
                    {r && def?.working && def.start !== null && def.end !== null ? (
                      <>
                        <span className="num mt-0.5 text-[11px] leading-tight font-semibold">{fmtMinutes(def.start)}</span>
                        <span className="num text-[11px] leading-tight opacity-90">{fmtMinutes(def.end)}</span>
                      </>
                    ) : (
                      <span className="mt-0.5 max-w-full truncate px-0.5 leading-none font-semibold">{r ? def?.label || r.shift_code : ""}</span>
                    )}
                    {d === today && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-piping" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </Card>
          <DayDetail day={selected} rows={rows} meId={me.id} defs={defs} holiday={holidayMap.get(selected)} t={t} fmt={fmt} />
        </>
      )}
    </AppShell>
  );
}

// รายละเอียดวันที่เลือก: เฉพาะกะของฉัน (ไม่แสดงเพื่อนร่วมคลัง)
function DayDetail({ day, rows, meId, defs, holiday, t, fmt }: { day: string; rows: TeamRow[]; meId: string; defs: Map<string, ShiftDef>; holiday?: string; t: T; fmt: Fmt }) {
  const mine = rows.find((r) => r.work_date === day && r.user_id === meId);

  return (
    <div>
      <Card className="mb-3">
        <p className="text-[15px] text-muted">{fmt.date(day)}{holiday ? ` · ${holiday}` : ""}</p>
        {mine ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ShiftTimeChip big code={mine.shift_code} def={defs.get(mine.shift_code)} color={(() => {
              const k = otDayKind(mine, defs.get(mine.shift_code), !!holiday);
              return k ? OT_DAY_COLOR[k] : undefined;
            })()} />
            {(() => {
              const k = otDayKind(mine, defs.get(mine.shift_code), !!holiday);
              return k && <Badge tone="amber">{k === "HOL" ? t("ms.holWork") : t("ms.offWork")}</Badge>;
            })()}
          </div>
        ) : (
          <p className="mt-1 text-lg font-semibold">{t("ms.noShift")}</p>
        )}
      </Card>
    </div>
  );
}
