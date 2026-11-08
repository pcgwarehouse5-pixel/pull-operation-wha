"use client";

// กราฟแนวโน้ม 7 วัน: แท่งคู่ ความต้องการ vs จองแล้ว (แกนเดียว) + % ใช้งาน Pool เป็นตัวเลขใต้แต่ละวัน
// สีผ่านการตรวจตาบอดสี (dataviz validate_palette): ต้องการ #4f7fe0 · จองแล้ว #1e8e5a
import { useEffect, useRef, useState } from "react";
import { shortDay } from "@/lib/format";

export type TrendPoint = { day: string; need: number | null; booked: number; pool: number; usage: number | null };

const NEED = "#4f7fe0";
const BOOKED = "#1e8e5a";
const W = 720;
const H = 270;
const M = { l: 44, r: 12, t: 18, b: 58 };

// ค่าสูงสุดของแกนแบบตัวเลขกลม ไม่เผื่อเกินจำเป็น (102 → 120, 165 → 200, 8 → 10) แบ่ง 4 ช่องลงตัว
function niceMax(v: number) {
  if (v <= 8) return 8;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = [1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((s) => n <= s) ?? 10;
  return Math.round(step * p);
}

// แท่งมุมบนโค้ง 4px ฐานเหลี่ยม
function bar(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function TrendChart({ points, selected }: { points: TrendPoint[]; selected: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // จอแคบ: เลื่อนให้เห็นวันล่าสุดก่อน
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [points.length, table]);
  const max = niceMax(Math.max(1, ...points.flatMap((p) => [p.need ?? 0, p.booked])));
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const band = pw / Math.max(1, points.length);
  const bw = Math.min(24, band * 0.28);
  const y = (v: number) => M.t + ph - (v / max) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const hp = hover === null ? null : points[hover];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[14px] text-ink">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: NEED }} /> ความต้องการ (คน)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: BOOKED }} /> จองแล้ว (คน)</span>
        <span className="text-muted">ตัวเลขใต้วัน = % ใช้งาน Pool (จองแล้ว ÷ กำลังคน)</span>
        <button type="button" onClick={() => setTable((t) => !t)} className="ml-auto min-h-10 rounded-xl px-3 font-semibold text-brand ring-1 ring-line hover:bg-brand/6">
          {table ? "ดูเป็นกราฟ" : "ดูเป็นตาราง"}
        </button>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-center text-[15px] tabular-nums">
            <thead className="bg-sky">
              <tr><th className="px-3 py-2 text-left">วัน</th><th className="px-3 py-2">กำลังคน</th><th className="px-3 py-2">ความต้องการ</th><th className="px-3 py-2">จองแล้ว</th><th className="px-3 py-2">% ใช้งาน Pool</th></tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day} className={`border-b border-line ${p.day === selected ? "font-bold" : ""}`}>
                  <td className="px-3 py-2 text-left">{shortDay(p.day)}</td>
                  <td className="px-3 py-2">{p.pool}</td>
                  <td className="px-3 py-2">{p.need ?? "—"}</td>
                  <td className="px-3 py-2">{p.booked}</td>
                  <td className="px-3 py-2">{p.usage === null ? "—" : `${p.usage}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={scroller} className="-mx-1 overflow-x-auto px-1">
        <div className="relative min-w-[34rem]">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="กราฟแนวโน้มความต้องการเทียบจองแล้ว 7 วัน" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#e6eaf2" strokeWidth={1} />
                <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="#5a6482">{t.toLocaleString("th-TH")}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = M.l + band * i + band / 2;
              const on = hover === i;
              return (
                <g key={p.day}>
                  {on && <rect x={M.l + band * i + 2} y={M.t} width={band - 4} height={ph} rx={8} fill="#eef3fc" />}
                  {p.need !== null && <path d={bar(cx - bw - 1, y(p.need), bw, y(0) - y(p.need))} fill={NEED} />}
                  {p.need === null && <text x={cx - bw / 2 - 1} y={y(0) - 6} textAnchor="middle" fontSize={13} fill="#8a6500">—</text>}
                  <path d={bar(cx + 1, y(p.booked), bw, y(0) - y(p.booked))} fill={BOOKED} />
                  {p.day === selected && (
                    <>
                      {p.need !== null && <text x={cx - bw / 2 - 1} y={y(p.need) - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#16204a">{p.need}</text>}
                      <text x={cx + bw / 2 + 1} y={y(p.booked) - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#16204a">{p.booked}</text>
                    </>
                  )}
                  <text x={cx} y={H - M.b + 20} textAnchor="middle" fontSize={13} fontWeight={p.day === selected ? 700 : 400} fill="#16204a">{shortDay(p.day)}</text>
                  <text x={cx} y={H - M.b + 40} textAnchor="middle" fontSize={13} fontWeight={600} fill="#24387a">{p.usage === null ? "—" : `${p.usage}%`}</text>
                  <rect x={M.l + band * i} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
            <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="#c9d1e1" strokeWidth={1} />
          </svg>
          {hp && hover !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-48 -translate-x-1/2 rounded-xl bg-white p-3 text-[14px] shadow-lg ring-1 ring-line"
              style={{ left: `${Math.min(85, Math.max(15, ((M.l + band * hover + band / 2) / W) * 100))}%` }}
            >
              <p className="font-bold text-ink">{shortDay(hp.day)}</p>
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: NEED }} /> ความต้องการ <b className="ml-auto">{hp.need ?? "—"}</b></p>
              <p className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BOOKED }} /> จองแล้ว <b className="ml-auto">{hp.booked}</b></p>
              <p className="flex text-muted">กำลังคน <span className="ml-auto">{hp.pool}</span></p>
              <p className="flex text-muted">% ใช้งาน Pool <span className="ml-auto">{hp.usage === null ? "—" : `${hp.usage}%`}</span></p>
              {hp.need === null && <p className="mt-1 text-[12px] text-[#8a6500]">มีคลังที่ยังคำนวณความต้องการไม่ได้</p>}
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}
