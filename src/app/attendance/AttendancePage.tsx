"use client";

// ลงเวลา: กดเข้า/ออกงานด้วย GPS (ต้องอยู่ในรัศมีคลัง) ดูเวลาย้อนหลัง และขอแก้เวลา
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { CorrectionModal } from "@/components/attendance/CorrectionModal";
import { errText, sb } from "@/lib/supabase";
import { shortDay, thaiTime } from "@/lib/format";
import { addMonths, currentMonth, monthDates, thaiMonthLabel, todayIso } from "@/lib/shifts";
import { CORRECTION_STATUS, STATUS, distanceM, hhmm, type AttendanceRow, type Correction } from "@/lib/attendance";

type Punch = { kind: "in" | "out"; punched_at: string; work_date: string };
type Geo = { lat: number; lng: number; acc: number };
type Msg = { tone: "success" | "error" | "warning" | "info"; text: string };

function locate(): Promise<Geo> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "ยังไม่ได้อนุญาตให้แอปใช้ตำแหน่ง: เปิดการตั้งค่าเบราว์เซอร์ → อนุญาตตำแหน่งที่ตั้งสำหรับเว็บนี้ แล้วลองใหม่"
              : e.code === e.TIMEOUT
                ? "หาตำแหน่งไม่ทัน ลองใหม่อีกครั้ง (ออกไปที่โล่งจะเร็วขึ้น)"
                : "หาตำแหน่งไม่ได้ ตรวจว่าเปิด GPS/ตำแหน่งที่ตั้งแล้ว",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

export default function AttendancePage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
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
  const near = useMemo(() => {
    if (!geo) return null;
    const list = myWh
      .filter((w) => w.latitude !== null && w.longitude !== null)
      .map((w) => ({ w, d: distanceM(geo.lat, geo.lng, w.latitude!, w.longitude!) }))
      .sort((a, b) => a.d - b.d);
    return list[0] ?? null;
  }, [geo, myWh]);

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
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [ym, today, demo, me.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า/เปลี่ยนเดือน
    load();
  }, [load]);

  // ปุ่มที่ควรกดต่อ: กดเข้าล่าสุดภายใน 20 ชม. = ควรกดออก
  const last = punches[0];
  const openIn = last && last.kind === "in" && loadedAt - new Date(last.punched_at).getTime() < 20 * 3600 * 1000 ? last : null;
  const todayRow = rows?.find((r) => r.work_date === (openIn?.work_date ?? today));

  async function check() {
    setMsg(null);
    setPhase("locating");
    try {
      const g = demo && myWh[0]?.latitude ? { lat: myWh[0].latitude!, lng: myWh[0].longitude!, acc: 12 } : await locate();
      setGeo(g);
      return g;
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
      return null;
    } finally {
      setPhase("idle");
    }
  }

  async function punch(kind: "in" | "out") {
    const g = await check();
    if (!g) return;
    const n = myWh
      .filter((w) => w.latitude !== null && w.longitude !== null)
      .map((w) => ({ w, d: distanceM(g.lat, g.lng, w.latitude!, w.longitude!) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!n) return setMsg({ tone: "error", text: "คลังของคุณยังไม่ได้ตั้งพิกัด แจ้งแอดมินคลังให้ตั้งพิกัดในหน้า \"คลัง\"" });
    if (n.d > n.w.checkin_radius_m)
      return setMsg({ tone: "error", text: `อยู่นอกพื้นที่${n.w.name} (ห่าง ${Math.round(n.d).toLocaleString("th-TH")} เมตร ต้องอยู่ในรัศมี ${n.w.checkin_radius_m} เมตร) ลงเวลาไม่ได้` });
    if (demo) return setMsg({ tone: "success", text: `โหมดดูดีไซน์: ${kind === "in" ? "เข้างาน" : "ออกงาน"} (ไม่ได้บันทึกจริง)` });
    setPhase("saving");
    const { data, error } = await sb().rpc("punch", { p_kind: kind, p_lat: g.lat, p_lng: g.lng, p_accuracy: g.acc });
    setPhase("idle");
    if (error) return setMsg({ tone: "error", text: errText(error) });
    const r = data as { punched_at: string; work_date: string };
    setMsg({ tone: "success", text: `บันทึก${kind === "in" ? "เข้างาน" : "ออกงาน"}แล้ว เวลา ${thaiTime(r.punched_at)} น. (วันทำงาน ${shortDay(r.work_date)})` });
    load();
  }

  async function cancelCorrection(id: string) {
    if (!confirm("ยกเลิกคำขอแก้เวลานี้?")) return;
    if (demo) return;
    const { error } = await sb().rpc("cancel_correction", { p_id: id });
    if (error) return setMsg({ tone: "error", text: errText(error) });
    load();
  }

  const busy = phase !== "idle";

  return (
    <AppShell title="ลงเวลา">
      {/* กดเข้า/ออก */}
      <Card className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[15px] text-muted">{shortDay(today)}</p>
            <p className="text-lg font-bold text-brand">
              {todayRow?.shift_code ? `กะ ${todayRow.shift_code}` : "ยังไม่มีกะที่ประกาศ"}
              {todayRow?.shift_start && <span className="font-semibold text-ink"> {thaiTime(todayRow.shift_start)}–{thaiTime(todayRow.shift_end)}</span>}
            </p>
          </div>
          {todayRow && <Badge tone={STATUS[todayRow.status].tone}>{STATUS[todayRow.status].label}</Badge>}
        </div>
        {openIn ? (
          <p className="mt-1 text-[15px]">เข้างานแล้วเวลา <b>{thaiTime(openIn.punched_at)} น.</b></p>
        ) : last ? (
          <p className="mt-1 text-[15px] text-muted">ล่าสุด: {last.kind === "in" ? "เข้า" : "ออก"} {thaiTime(last.punched_at)} น. ({shortDay(last.work_date)})</p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button size="lg" variant={openIn ? "secondary" : "primary"} disabled={busy} onClick={() => punch("in")} className="!min-h-20 flex-col !gap-0">
            <span className="text-xl">เข้างาน</span>
          </Button>
          <Button size="lg" variant={openIn ? "primary" : "secondary"} disabled={busy} onClick={() => punch("out")} className="!min-h-20 flex-col !gap-0">
            <span className="text-xl">ออกงาน</span>
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[14px]">
          <Icon name="pin" size={18} className="shrink-0 text-muted" />
          {phase === "locating" ? (
            <span className="text-muted">กำลังหาตำแหน่ง...</span>
          ) : phase === "saving" ? (
            <span className="text-muted">กำลังบันทึก...</span>
          ) : near ? (
            near.d <= near.w.checkin_radius_m ? (
              <span className="font-semibold text-ok">อยู่ในพื้นที่{near.w.name} (ห่าง {Math.round(near.d)} ม.)</span>
            ) : (
              <span className="font-semibold text-bad">
                นอกพื้นที่ (ห่าง{near.w.name} {Math.round(near.d).toLocaleString("th-TH")} ม. ต้องไม่เกิน {near.w.checkin_radius_m} ม.)
              </span>
            )
          ) : geo ? (
            <span className="text-bad">คลังของคุณยังไม่ได้ตั้งพิกัด</span>
          ) : (
            <span className="text-muted">ระบบจะขอตำแหน่งตอนกดปุ่ม (ต้องอยู่ในรัศมีคลัง)</span>
          )}
          <button type="button" className="ml-auto shrink-0 rounded-lg px-2 py-1 font-semibold text-brand" onClick={check} disabled={busy}>
            ตรวจตำแหน่ง
          </button>
        </div>
        {geo && <p className="mt-1 text-[12px] text-muted">ความแม่นยำ GPS ประมาณ {Math.round(geo.acc)} ม. · ระบบเก็บพิกัดเฉพาะตอนกดลงเวลา</p>}
      </Card>

      {msg && <div className="mb-3"><Alert tone={msg.tone === "info" ? "info" : msg.tone}>{msg.text}</Alert></div>}

      {/* คำขอแก้เวลา */}
      {corrs.some((c) => c.status === "pending") && (
        <Card className="mb-3 !p-3.5">
          <p className="mb-2 font-semibold">คำขอแก้เวลาที่รออนุมัติ</p>
          <ul className="divide-y divide-line">
            {corrs
              .filter((c) => c.status === "pending")
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{shortDay(c.work_date)} · เข้า {hhmm(c.check_in)} ออก {hhmm(c.check_out)}</p>
                    <p className="truncate text-[13px] text-muted">{c.reason}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => cancelCorrection(c.id)}>ยกเลิก</Button>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* ประวัติรายเดือน */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-bold text-brand">ประวัติเวลา</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="เดือนก่อน" onClick={() => setYm(addMonths(ym, -1))}>
            <Icon name="back" size={18} />
          </Button>
          <span className="min-w-28 text-center font-semibold">{thaiMonthLabel(ym)}</span>
          <Button variant="secondary" size="sm" aria-label="เดือนถัดไป" disabled={ym >= currentMonth()} onClick={() => setYm(addMonths(ym, 1))}>
            <Icon name="next" size={18} />
          </Button>
        </div>
      </div>
      {!rows ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>ยังไม่มีข้อมูลของเดือนนี้</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.work_date}>
              <Card className="!p-3">
                <div className="flex items-center gap-2">
                  <div className="w-24 shrink-0">
                    <p className="font-semibold">{shortDay(r.work_date)}</p>
                    <p className="text-[13px] text-muted">{r.shift_code ?? "-"}</p>
                  </div>
                  <div className="min-w-0 flex-1 text-[15px]">
                    <p>
                      เข้า <b>{thaiTime(r.first_in)}</b> · ออก <b>{thaiTime(r.last_out)}</b>
                    </p>
                    <p className="text-[13px] text-muted">
                      {r.late_min > 0 && `สาย ${r.late_min} นาที `}
                      {r.early_min > 0 && `ออกก่อน ${r.early_min} นาที`}
                      {r.pending_correction && "มีคำขอแก้เวลารออนุมัติ"}
                    </p>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </div>
                {["no_out", "no_in", "absent", "late", "early", "late_early"].includes(r.status) && !r.pending_correction && (
                  <div className="mt-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setFix(r.work_date)}>ขอแก้เวลา</Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-center">
        <Button variant="ghost" size="sm" onClick={() => setFix(today)}>ขอแก้เวลาวันอื่น</Button>
      </div>
      {corrs.some((c) => c.status !== "pending") && (
        <details className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-line">
          <summary className="cursor-pointer font-semibold">ประวัติคำขอแก้เวลา</summary>
          <ul className="mt-2 divide-y divide-line">
            {corrs
              .filter((c) => c.status !== "pending")
              .map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-2 text-[14px]">
                  <span className="min-w-0 flex-1">
                    {shortDay(c.work_date)} · เข้า {hhmm(c.check_in)} ออก {hhmm(c.check_out)}
                    {c.decision_note && <span className="block text-muted">หมายเหตุ: {c.decision_note}</span>}
                  </span>
                  <Badge tone={CORRECTION_STATUS[c.status].tone}>{CORRECTION_STATUS[c.status].label}</Badge>
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
