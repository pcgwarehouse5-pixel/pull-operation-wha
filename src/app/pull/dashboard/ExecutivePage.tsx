"use client";

// Dashboard ภาพรวมการจัดกำลังคนคลังสินค้า สำหรับผู้บริหาร (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 4)
// ความต้องการเทียบจองแล้ว แยกรายคลัง และแนวโน้มย้อนหลัง 7 วัน · ตัวเลขรวมเท่านั้น (ไม่มีรายชื่อ)
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Card, Loading } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { BarDate, BarSelect, PullBar } from "@/components/pull/PullUI";
import { TrendChart } from "@/components/pull/TrendChart";
import { errText } from "@/lib/supabase";
import { todayIso } from "@/lib/shifts";
import { shortDay } from "@/lib/format";
import { addDays, loadNetwork } from "@/lib/pull-data";
import { networkTotals, pct, trend, type NetRow } from "@/lib/pull";

type Shift = "morning" | "night" | "all";
const SHIFT_TEXT: Record<Shift, string> = { morning: "กะเช้า", night: "กะดึก", all: "ทั้งวัน (2 กะ)" };

export default function ExecutivePage() {
  const { demo } = useApp();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");
  const [wh, setWh] = useState("");
  const [rows, setRows] = useState<NetRow[] | null>(null);
  const [err, setErr] = useState("");
  const [at, setAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const from = addDays(date, -6);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = demo ? demo.previewPullNetwork(from, date) : await loadNetwork(from, date, shift);
        if (live) {
          setRows(r);
          setErr("");
          setAt(new Date());
        }
      } catch (e) {
        if (live) setErr(errText(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, from, date, shift, tick]);

  const whList = rows ? [...new Map(rows.map((r) => [r.wh_id, { id: r.wh_id, code: r.wh_code, name: r.wh_name }])).values()] : [];
  const scoped = (rows ?? []).filter((r) => !wh || r.wh_id === wh);
  const todayRows = scoped.filter((r) => r.work_day === date);
  const t = networkTotals(todayRows);
  const points = trend(scoped);

  return (
    <AppShell title="Dashboard ผู้บริหาร" minRole="admin" wide>
      <PullBar title="ภาพรวมการจัดกำลังคนคลังสินค้า" sub={`สำหรับผู้บริหาร · ข้อมูลล่าสุด ${at ? at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "—"}`}>
        <BarDate value={date} onChange={setDate} max={addDays(today, 60)} />
        <BarSelect label="กะ" value={shift} onChange={(v) => setShift(v as Shift)}>
          <option value="morning">☀ กะเช้า</option>
          <option value="night">☾ กะดึก</option>
          <option value="all">ทั้งวัน</option>
        </BarSelect>
        <BarSelect label="คลัง" value={wh} onChange={setWh}>
          <option value="">ทุกคลัง</option>
          {whList.map((w) => (
            <option key={w.id} value={w.id}>{w.code}</option>
          ))}
        </BarSelect>
        <button type="button" onClick={() => setTick((x) => x + 1)} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white/15 px-3 font-semibold text-white hover:bg-white/25" aria-label="รีเฟรชข้อมูล">
          <Icon name="history" size={20} /> รีเฟรช
        </button>
      </PullBar>

      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : (
        <>
          {t.incomplete > 0 && (
            <div className="mb-4">
              <Alert tone="warning">
                มี {t.incomplete} คลังที่ยังคำนวณความต้องการไม่ได้ (ยังไม่กรอกยอดงาน หรือตั้งค่า Pull ไม่ครบ) · แสดง — แทนค่าที่ไม่ทราบ
              </Alert>
            </div>
          )}

          <div className="mb-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon="users" color="#2563eb" label="กำลังคนใน Pool ทั้งหมด" value={t.pool} note={`ลา ${t.leave} คน · ${SHIFT_TEXT[shift]}`} />
            <Kpi icon="calendar" color="#1e8e5a" label={`ความต้องการ ${date === today ? "วันนี้" : shortDay(date)}`} value={t.need} percent={pct(t.need, t.pool)} barColor="#1e8e5a" note="เทียบกับกำลังคนใน Pool ทั้งหมด" />
            <Kpi icon="users" color="#7c3aed" label={`จองแล้ว${date === today ? "วันนี้" : ""}`} value={t.booked} percent={pct(t.booked, t.pool)} barColor="#7c3aed" note={`ดึงข้ามคลัง ${t.pulled} คน`} />
            <Kpi icon="alert" color="#e5484d" label="คงเหลือจากการจอง" value={t.remaining} percent={pct(t.remaining, t.pool)} barColor="#e5484d" note="ของกำลังคนใน Pool ทั้งหมด" tint="#fff7f7" />
          </div>

          <Card className="mb-4">
            <h2 className="flex items-center gap-2 text-xl font-bold text-brand">
              <Icon name="warehouse" size={26} /> ภาพรวมรายคลัง <span className="text-[15px] font-normal text-muted">(ความต้องการเทียบกับกำลังคนใน Pool ทั้งหมด)</span>
            </h2>
            <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3">
              {todayRows.map((r) => {
                const short = r.short;
                return (
                  <li key={r.wh_id} className="overflow-hidden rounded-2xl ring-1 ring-line">
                    <div className="flex items-center gap-3 bg-gradient-to-r from-brand to-brand-2 px-4 py-3 text-white">
                      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Icon name="warehouse" size={28} /></span>
                      <span className="min-w-0">
                        <span className="block text-2xl leading-tight font-bold">{r.wh_code}</span>
                        <span className="block truncate text-[14px] text-white/80">{r.wh_name}</span>
                      </span>
                      <span className="ml-auto text-right text-[13px] text-white/80">กำลังคน<br /><b className="text-xl text-white">{r.pool_count}</b> คน</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 p-3">
                      <Box label="ความต้องการ" value={r.need} sub={r.need === null ? "รอข้อมูล" : `${pct(r.need, t.pool) ?? 0}% ของ Pool`} tone="blue" />
                      <Box label="จองแล้ว" value={r.booked} sub={r.pulled_in ? `ดึงจากคลังอื่น ${r.pulled_in}` : " "} tone="green" />
                      <Box label={short === 0 ? "ครบแล้ว" : "ยังขาด"} value={short} sub={short === null ? "รอข้อมูล" : short === 0 ? "✓" : "คน"} tone={short === 0 ? "green" : short === null ? "gray" : "red"} />
                    </div>
                    <p className="border-t border-line px-4 py-2 text-[13px] text-muted">ถูกดึงไปช่วยคลังอื่น {r.lent_out} คน · ลา {r.on_leave} คน</p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <h2 className="flex items-center gap-2 text-xl font-bold text-brand">
              <Icon name="chart" size={26} /> แนวโน้มการใช้กำลังคนย้อนหลัง 7 วัน <span className="text-[15px] font-normal text-muted">({wh ? whList.find((w) => w.id === wh)?.code : "รวมทุกคลัง"} · {SHIFT_TEXT[shift]})</span>
            </h2>
            <div className="mt-3"><TrendChart points={points} selected={date} /></div>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function Kpi({ icon, color, label, value, percent, barColor, note, tint }: { icon: IconName; color: string; label: string; value: number | null; percent?: number | null; barColor?: string; note?: string; tint?: string }) {
  return (
    <div className="rounded-[20px] p-4 ring-1 ring-line" style={{ background: tint ?? "#ffffff" }}>
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: color }}><Icon name={icon} size={30} /></span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold" style={{ color }}>{label}</p>
          <p className="leading-none"><span className="text-5xl font-bold text-ink tabular-nums">{value ?? "—"}</span> <span className="text-xl font-bold text-ink">คน</span></p>
        </div>
      </div>
      {percent !== undefined && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#e3e7ef]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, percent ?? 0)}%`, background: barColor }} />
          </div>
          <span className="w-12 text-right font-bold tabular-nums" style={{ color: barColor }}>{percent === null ? "—" : `${percent}%`}</span>
        </div>
      )}
      {note && <p className="mt-1 text-[13px] text-muted">{note}</p>}
    </div>
  );
}

function Box({ label, value, sub, tone }: { label: string; value: number | null; sub: string; tone: "blue" | "green" | "red" | "gray" }) {
  const c = { blue: "bg-[#eef3fc] text-brand", green: "bg-[#e6f4ec] text-ok", red: "bg-[#fdecec] text-bad", gray: "bg-paper text-muted" }[tone];
  return (
    <div className={`rounded-xl px-2 py-2 text-center ${c}`}>
      <p className="text-[13px] font-semibold text-ink">{label}</p>
      <p className="text-3xl leading-tight font-bold tabular-nums">{value ?? "—"}</p>
      <p className="text-[12px] text-muted">{sub}</p>
    </div>
  );
}
