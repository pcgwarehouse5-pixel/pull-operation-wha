"use client";

// ลงเวลา: กดเข้า/ออกงานด้วย GPS (ต้องอยู่ในรัศมีคลัง) ดูเวลาย้อนหลัง และขอแก้เวลา
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PageHelper, type Pose } from "@/components/Puinun";
import { CorrectionModal } from "@/components/attendance/CorrectionModal";
import { MyOt } from "@/components/attendance/MyOt";
import { sb } from "@/lib/supabase";
import { addMonths, currentMonth, monthDates, todayIso } from "@/lib/shifts";
import { CORRECTION_STATUS, STATUS, distanceM, hhmm, type AttendanceRow, type Correction } from "@/lib/attendance";
import { localizeError, useI18n, type T } from "@/i18n";
import { shiftText, useShiftDefs } from "@/lib/useShiftDefs";
import type { MsgKey } from "@/i18n/th";

type Punch = { kind: "in" | "out"; punched_at: string; work_date: string };
type Geo = { lat: number; lng: number; acc: number };
type Msg = { tone: "success" | "error" | "warning" | "info"; text: string };

function locate(t: T): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t("att.geoNone")));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? t("att.geoDenied") : e.code === e.TIMEOUT ? t("att.geoTimeout") : t("att.geoFail"))),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** นาฬิกาเวลาไทย (อัปเดตทุก 15 วินาที) */
function useClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function AttendancePage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const { t, fmt } = useI18n();
  const shiftDefs = useShiftDefs();
  const clock = useClock();
  const [ym, setYm] = useState(currentMonth);
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [corrs, setCorrs] = useState<Correction[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [phase, setPhase] = useState<"idle" | "locating" | "saving">("idle");
  const [msg, setMsg] = useState<Msg | null>(null);
  const [fix, setFix] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const today = todayIso();

  const myWh = useMemo(
    () => warehouses.filter((w) => w.is_active && (w.id === me.warehouse_id || myWarehouseIds.includes(w.id))),
    [warehouses, me.warehouse_id, myWarehouseIds],
  );
  const nearest = useCallback(
    (g: Geo) =>
      myWh
        .filter((w) => w.latitude !== null && w.longitude !== null)
        .map((w) => ({ w, d: distanceM(g.lat, g.lng, w.latitude!, w.longitude!) }))
        .sort((a, b) => a.d - b.d)[0] ?? null,
    [myWh],
  );
  const near = useMemo(() => (geo ? nearest(geo) : null), [geo, nearest]);

  const load = useCallback(async () => {
    const dates = monthDates(ym);
    const to = dates.at(-1)! < today ? dates.at(-1)! : today;
    if (demo) {
      setRows(demo.previewAttendance(dates, me.id, today).filter((r) => r.work_date <= to) as AttendanceRow[]);
      setCorrs(demo.previewCorrections(me.id));
      setPunches([{ kind: "in", punched_at: `${today}T07:52:00+07:00`, work_date: today }]);
      setLoadedAt(Date.now());
      return;
    }
    try {
      const [a, p, c] = await Promise.all([
        dates[0] <= today ? sb().rpc("my_attendance", { p_from: dates[0], p_to: to }) : Promise.resolve({ data: [], error: null }),
        sb().from("attendance_punches").select("kind, punched_at, work_date").eq("user_id", me.id).order("punched_at", { ascending: false }).limit(6),
        sb().from("attendance_corrections").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(10),
      ]);
      if (a.error) throw a.error;
      setRows(((a.data ?? []) as AttendanceRow[]).slice().reverse());
      setPunches((p.data ?? []) as Punch[]);
      setLoadedAt(Date.now());
      setCorrs((c.data ?? []) as Correction[]);
    } catch (e) {
      setRows([]);
      setMsg({ tone: "error", text: localizeError((e as Error).message ?? String(e), t) });
    }
  }, [ym, today, demo, me.id, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า/เปลี่ยนเดือน
    load();
  }, [load]);

  // ปุ่มที่ควรกดต่อ: กดเข้าล่าสุดภายใน 20 ชม. = ควรกดออก
  const last = punches[0];
  const openIn = last && last.kind === "in" && loadedAt - new Date(last.punched_at).getTime() < 20 * 3600 * 1000 ? last : null;
  const todayRow = rows?.find((r) => r.work_date === (openIn?.work_date ?? today));
  const kindLabel = (k: "in" | "out") => t(k === "in" ? "att.in" : "att.out");

  async function check() {
    setMsg(null);
    setPhase("locating");
    try {
      const g = demo && myWh[0]?.latitude ? { lat: myWh[0].latitude!, lng: myWh[0].longitude!, acc: 12 } : await locate(t);
      setGeo(g);
      return g;
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
      return null;
    } finally {
      setPhase("idle");
    }
  }

  async function punch(kind: "in" | "out") {
    const g = await check();
    if (!g) return;
    const n = nearest(g);
    if (!n) return setMsg({ tone: "error", text: t("err.noCoords") });
    if (n.d > n.w.checkin_radius_m) return setMsg({ tone: "error", text: t("att.outside", { wh: n.w.name, m: Math.round(n.d).toLocaleString(), r: n.w.checkin_radius_m }) });
    if (demo) return setMsg({ tone: "success", text: `${t("common.demoNotSaved")} · ${kindLabel(kind)}` });
    setPhase("saving");
    const { data, error } = await sb().rpc("punch", { p_kind: kind, p_lat: g.lat, p_lng: g.lng, p_accuracy: g.acc });
    setPhase("idle");
    if (error) return setMsg({ tone: "error", text: localizeError(error.message, t) });
    const r = data as { punched_at: string; work_date: string };
    setMsg({ tone: "success", text: t("att.saved", { kind: kindLabel(kind), t: fmt.time(r.punched_at) }) });
    load();
  }

  async function cancelCorrection(id: string) {
    if (!confirm(t("att.cancelFixConfirm"))) return;
    if (demo) return;
    const { error } = await sb().rpc("cancel_correction", { p_id: id });
    if (error) return setMsg({ tone: "error", text: localizeError(error.message, t) });
    load();
  }

  const busy = phase !== "idle";
  const pose: Pose = msg?.tone === "success" ? "happy" : msg?.tone === "error" ? "oops" : "run";
  const st = (s: AttendanceRow["status"]) => t(`status.${s}` as MsgKey);

  return (
    <AppShell title={t("att.title")}>
      <PageHelper pose={pose} title={t("att.title")}>
        {t("att.helper")}
      </PageHelper>

      {/* นาฬิกา + กะวันนี้ + ปุ่มกด */}
      <Card className="mb-3 !p-0 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-[14px] text-muted">{fmt.day(today)}</p>
            <p className="num text-[44px] leading-none font-bold tracking-tight text-brand" aria-live="off">{clock || "--:--"}</p>
          </div>
          <div className="text-right">
            {todayRow && <Badge tone={STATUS[todayRow.status].tone}>{st(todayRow.status)}</Badge>}
            {/* กะวันนี้: แสดงเวลา (ไม่แสดงรหัสกะ ให้พนักงานอ่านง่าย) */}
            <p className="mt-1.5 text-[13px] text-muted">{todayRow?.shift_code ? t("home.shiftToday") : ""}</p>
            <p className="num text-[17px] font-bold text-ink">
              {todayRow?.shift_start ? `${fmt.time(todayRow.shift_start)}–${fmt.time(todayRow.shift_end)}` : todayRow?.shift_code ? shiftText(todayRow.shift_code, shiftDefs) : t("att.noShift")}
            </p>
          </div>
        </div>
        <p className="px-4 pt-2 text-[15px] sm:px-5">
          {openIn ? (
            <span className="font-semibold text-ok">{t("att.inAt", { t: fmt.time(openIn.punched_at) })}</span>
          ) : last ? (
            <span className="text-muted">{t("att.last", { kind: kindLabel(last.kind), t: fmt.time(last.punched_at), day: fmt.day(last.work_date) })}</span>
          ) : null}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 px-4 sm:px-5">
          <Button size="lg" variant={openIn ? "secondary" : "primary"} disabled={busy} onClick={() => punch("in")} className="!min-h-[88px] flex-col !gap-1 !rounded-[18px]">
            <Icon name="pin" size={24} />
            <span className="text-[20px]">{t("att.in")}</span>
          </Button>
          <Button size="lg" variant={openIn ? "primary" : "secondary"} disabled={busy} onClick={() => punch("out")} className="!min-h-[88px] flex-col !gap-1 !rounded-[18px]">
            <Icon name="logout" size={24} />
            <span className="text-[20px]">{t("att.out")}</span>
          </Button>
        </div>

        {/* สถานะตำแหน่ง */}
        <div className="mt-4 flex items-center gap-2 border-t border-line bg-paper/60 px-4 py-3 text-[14px] sm:px-5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${near ? (near.d <= near.w.checkin_radius_m ? "bg-ok" : "bg-bad") : "bg-[#a9b2c8]"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {phase === "locating" ? (
              <span className="text-muted">{t("att.locating")}</span>
            ) : phase === "saving" ? (
              <span className="text-muted">{t("att.saving")}</span>
            ) : near ? (
              near.d <= near.w.checkin_radius_m ? (
                <span className="font-semibold text-ok">{t("att.inArea", { wh: near.w.name, m: Math.round(near.d) })}</span>
              ) : (
                <span className="font-semibold text-bad">{t("att.outArea", { wh: near.w.name, m: Math.round(near.d).toLocaleString(), r: near.w.checkin_radius_m })}</span>
              )
            ) : geo ? (
              <span className="text-bad">{t("att.noCoords")}</span>
            ) : (
              <span className="text-muted">{t("att.askLocation")}</span>
            )}
            {geo && <span className="block text-[12px] text-muted">{t("att.accuracy", { m: Math.round(geo.acc) })}</span>}
          </span>
          <button type="button" className="shrink-0 rounded-lg px-2 py-1 font-semibold text-brand hover:bg-brand/5" onClick={check} disabled={busy}>
            {t("att.checkLocation")}
          </button>
        </div>
      </Card>

      {msg && <div className="mb-3"><Alert tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Alert></div>}

      {/* คำขอแก้เวลาที่รออนุมัติ */}
      {corrs.some((c) => c.status === "pending") && (
        <Card className="mb-3 !p-3.5">
          <p className="mb-1 font-semibold">{t("att.pendingFixes")}</p>
          <ul className="divide-y divide-line">
            {corrs
              .filter((c) => c.status === "pending")
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t("att.fixLine", { day: fmt.day(c.work_date), in: hhmm(c.check_in), out: hhmm(c.check_out) })}</p>
                    <p className="truncate text-[13px] text-muted">{c.reason}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => cancelCorrection(c.id)}>{t("att.cancelFix")}</Button>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* ประวัติรายเดือน */}
      <div className="mt-5 mb-2 flex items-center gap-2">
        <h2 className="text-lg font-bold text-brand">{t("att.history")}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label={t("common.prevMonth")} onClick={() => setYm(addMonths(ym, -1))}>
            <Icon name="back" size={18} />
          </Button>
          <span className="min-w-28 text-center font-semibold">{fmt.month(ym)}</span>
          <Button variant="secondary" size="sm" aria-label={t("common.nextMonth")} disabled={ym >= currentMonth()} onClick={() => setYm(addMonths(ym, 1))}>
            <Icon name="next" size={18} />
          </Button>
        </div>
      </div>
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>{t("att.noData")}</Empty>
      ) : (
        <ul className="overflow-hidden rounded-[20px] bg-white ring-1 ring-line">
          {rows.map((r) => {
            const fixable = ["no_out", "no_in", "absent", "late", "early", "late_early"].includes(r.status) && !r.pending_correction;
            return (
              <li key={r.work_date} className="border-b border-line px-3.5 py-3 last:border-b-0">
                <div className="flex items-center gap-3">
                  <div className="w-[88px] shrink-0">
                    <p className="leading-tight font-semibold">{fmt.day(r.work_date)}</p>
                    <p className="num text-[13px] text-muted">{r.shift_code ? shiftText(r.shift_code, shiftDefs) : "-"}</p>
                  </div>
                  <div className="num min-w-0 flex-1 text-[15px]">
                    {t("att.inOut", { in: fmt.time(r.first_in), out: fmt.time(r.last_out) })}
                    <p className="text-[13px] text-muted">
                      {r.late_min > 0 && `${t("att.late", { n: r.late_min })} `}
                      {r.early_min > 0 && t("att.early", { n: r.early_min })}
                      {r.pending_correction && t("att.hasPendingFix")}
                    </p>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{st(r.status)}</Badge>
                </div>
                {fixable && (
                  <div className="mt-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setFix(r.work_date)}>{t("att.requestFix")}</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 text-center">
        <Button variant="ghost" size="sm" onClick={() => setFix(today)}>{t("att.requestFixOther")}</Button>
      </div>
      <MyOt ym={ym} />
      {corrs.some((c) => c.status !== "pending") && (
        <details className="mt-3 rounded-[20px] bg-white p-3.5 ring-1 ring-line">
          <summary className="cursor-pointer font-semibold">{t("att.fixHistory")}</summary>
          <ul className="mt-2 divide-y divide-line">
            {corrs
              .filter((c) => c.status !== "pending")
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 text-[14px]">
                  <span className="min-w-0 flex-1">
                    {t("att.fixLine", { day: fmt.day(c.work_date), in: hhmm(c.check_in), out: hhmm(c.check_out) })}
                    {c.decision_note && <span className="block text-muted">{t("att.note", { note: c.decision_note })}</span>}
                  </span>
                  <Badge tone={CORRECTION_STATUS[c.status].tone}>{t(`corr.${c.status}` as MsgKey)}</Badge>
                </li>
              ))}
          </ul>
        </details>
      )}

      {fix && (
        <CorrectionModal
          date={fix}
          onClose={() => setFix(null)}
          onDone={(text) => {
            setFix(null);
            setMsg({ tone: "success", text });
            load();
          }}
        />
      )}
    </AppShell>
  );
}
