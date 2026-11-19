"use client";

// ปุ่ม "ใช้ตำแหน่งปัจจุบันของฉัน" ในฟอร์มคลัง: ถือมือถือไปยืนจุดที่ต้องการ แล้วกดปุ่ม
// แอปจับสัญญาณ GPS ต่อเนื่องสูงสุด 30 วินาที แล้วเฉลี่ยเฉพาะค่าที่แม่น (ดู src/lib/geo-fix.ts)
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { distanceM } from "@/lib/attendance";
import { POOR_ACC_M, bestFix, fixIsGood, type GeoFix, type GeoSample } from "@/lib/geo-fix";

const MAX_MS = 30000;

type Phase = { kind: "idle" } | { kind: "measuring"; samples: GeoSample[]; started: number } | { kind: "done"; fix: GeoFix } | { kind: "error"; text: string };

const ERR: Record<number, string> = {
  0: "เครื่อง/เบราว์เซอร์นี้หาตำแหน่งไม่ได้ ลองเปิดด้วย Chrome หรือ Safari",
  1: "ยังไม่ได้อนุญาตให้เว็บนี้ใช้ตำแหน่ง: เปิดสิทธิ์ตำแหน่งของเบราว์เซอร์แล้วกดใหม่ (ดูวิธีได้ในหน้า \"ลงเวลา\" → \"ตำแหน่งมีปัญหา? ดูวิธีแก้\")",
  2: "หาตำแหน่งไม่ได้ ตรวจว่าเปิด GPS / ตำแหน่ง ในมือถือแล้ว",
  3: "หาตำแหน่งไม่ทัน ออกไปที่โล่งแล้วกดใหม่",
};

export function CurrentLocation({
  auto = false,
  prev,
  onFix,
}: {
  auto?: boolean;
  /** พิกัดที่บันทึกไว้เดิม (บอกว่าห่างจากเดิมกี่เมตร) */
  prev: { lat: number; lng: number } | null;
  onFix: (lat: string, lng: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [now, setNow] = useState(0);
  const watch = useRef<number | null>(null);
  const samples = useRef<GeoSample[]>([]);
  const onFixRef = useRef(onFix);
  useEffect(() => {
    onFixRef.current = onFix;
  }, [onFix]);

  const clear = () => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
  };

  const finish = useCallback(() => {
    clear();
    const fix = bestFix(samples.current);
    if (!fix) return setPhase({ kind: "error", text: ERR[3] });
    onFixRef.current(fix.lat.toFixed(6), fix.lng.toFixed(6));
    setPhase({ kind: "done", fix });
  }, []);

  const start = useCallback(() => {
    clear();
    samples.current = [];
    if (!navigator.geolocation) return setPhase({ kind: "error", text: ERR[0] });
    const started = Date.now();
    setNow(started);
    setPhase({ kind: "measuring", samples: [], started });
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        samples.current = [...samples.current, { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }];
        setPhase({ kind: "measuring", samples: samples.current, started });
        if (fixIsGood(samples.current)) finish();
      },
      (e) => {
        // หมดเวลาแต่มีค่าแล้ว: ใช้ค่าที่มี
        if (e.code === e.TIMEOUT && samples.current.length) return finish();
        clear();
        setPhase({ kind: "error", text: ERR[e.code] ?? ERR[2] });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_MS },
    );
  }, [finish]);

  // นับเวลา + หยุดเองเมื่อครบ 30 วินาที
  useEffect(() => {
    if (phase.kind !== "measuring") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - phase.started >= MAX_MS) {
        if (samples.current.length) finish();
        else {
          clear();
          setPhase({ kind: "error", text: ERR[3] });
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [phase, finish]);

  // เปิดจากปุ่มบนการ์ดคลัง: เริ่มจับสัญญาณทันที
  useEffect(() => {
    if (!auto) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- เริ่มหาตำแหน่งหลังเปิดฟอร์มจากปุ่มบนการ์ด
    start();
  }, [auto, start]);

  useEffect(() => clear, []);

  const live = phase.kind === "measuring" ? bestFix(phase.samples) : null;
  const sec = phase.kind === "measuring" ? Math.min(30, Math.floor((now - phase.started) / 1000)) : 0;
  const fix = phase.kind === "done" ? phase.fix : null;
  const moved = fix && prev ? distanceM(prev.lat, prev.lng, fix.lat, fix.lng) : null;

  return (
    <div className="rounded-2xl bg-sky p-3">
      {phase.kind === "measuring" ? (
        <div aria-live="polite">
          <div className="flex items-center gap-2 font-semibold text-brand">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />
            กำลังจับสัญญาณ GPS... {sec}/30 วินาที
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white" aria-hidden="true">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(sec / 30) * 100}%` }} />
          </div>
          <p className="mt-2 text-[14px] text-ink">
            {live ? <>แม่นที่สุดตอนนี้ <b className="num">±{Math.round(live.acc)} ม.</b> · รับค่าแล้ว {live.total} ครั้ง</> : "รอสัญญาณครั้งแรก..."}
          </p>
          <p className="mt-1 text-[13px] text-muted">ยืนนิ่งๆ ที่จุดที่ต้องการ ถ้าอยู่ในอาคาร ออกไปที่โล่งจะแม่นกว่า · หยุดเองเมื่อแม่นถึง ±10 ม.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={finish} disabled={!live} className="min-h-11 rounded-xl bg-brand font-bold text-white disabled:opacity-50">
              ใช้ค่านี้เลย
            </button>
            <button
              type="button"
              onClick={() => {
                clear();
                setPhase({ kind: "idle" });
              }}
              className="min-h-11 rounded-xl bg-white font-semibold text-brand ring-1 ring-line"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={start} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[16px] font-bold text-white">
            <Icon name="pin" size={20} /> {fix ? "จับตำแหน่งใหม่อีกครั้ง" : "ใช้ตำแหน่งปัจจุบันของฉัน"}
          </button>
          {fix ? (
            <div className="mt-2 text-[14px] text-ink" aria-live="polite">
              <p className="flex items-start gap-1.5 font-semibold text-ok">
                <Icon name="check" size={18} className="mt-0.5 shrink-0" /> ใส่พิกัดให้แล้ว คลาดเคลื่อนประมาณ ±{Math.round(fix.acc)} ม. (เฉลี่ยจาก {fix.used} ครั้ง)
              </p>
              {fix.acc > POOR_ACC_M && (
                <p className="mt-1 flex items-start gap-1.5 font-semibold text-bad">
                  <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> ยังคลาดเคลื่อนมาก ออกไปที่โล่ง เปิด GPS แล้วกดใหม่
                </p>
              )}
              {moved !== null && <p className="mt-1 text-muted">ห่างจากพิกัดเดิม {Math.round(moved).toLocaleString()} ม.</p>}
              <p className="mt-1 text-muted">
                ตรวจจุดบนแผนที่ได้:{" "}
                <a className="font-semibold text-brand underline" href={`https://www.google.com/maps/search/?api=1&query=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`} target="_blank" rel="noreferrer">
                  เปิด Google Maps
                </a>{" "}
                · กด &quot;บันทึก&quot; เพื่อเก็บ
              </p>
            </div>
          ) : phase.kind === "error" ? (
            <p className="mt-2 flex items-start gap-1.5 text-[14px] font-semibold text-bad" role="alert">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {phase.text}
            </p>
          ) : (
            <p className="mt-2 text-[13px] text-muted">ถือมือถือไปยืนจุดกลางคลัง (หรือจุดที่พนักงานกดลงเวลา) แล้วกดปุ่ม แอปจะจับ GPS หลายครั้งแล้วเฉลี่ยให้แม่นที่สุด</p>
          )}
        </>
      )}
    </div>
  );
}
