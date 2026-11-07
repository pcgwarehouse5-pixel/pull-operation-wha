"use client";

// ขั้นที่ 4 ตั้งค่าชั่วโมงทำงานต่อกะ: เวลาที่ 1 คนมีให้ทำงานในแต่ละกะ แยกรายคลัง (บันทึกพร้อมวันที่เริ่มใช้)
import { useMemo, useState } from "react";
import { Button, Card, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { fromLabel } from "@/components/pull/PullUI";
import { SaveBar } from "@/components/pull/SaveBar";
import { hoursOf, nextChange, num, parsePositive, type PullConfig, type PullShift } from "@/lib/pull";
import type { Warehouse } from "@/lib/types";

type Row = { morning: string; night: string };

export function ShiftHoursSettings({
  cfg,
  wh,
  warehouses,
  today,
  canEditWh,
  onSave,
  onDeleteFuture,
}: {
  cfg: PullConfig;
  wh: string;
  warehouses: Warehouse[];
  today: string;
  canEditWh: (id: string) => boolean;
  onSave: (from: string, rows: { wh: string; morning: number; night: number }[], note: string) => Promise<boolean>;
  onDeleteFuture: (wh: string, from: string) => Promise<boolean>;
}) {
  const cur = (w: string, s: PullShift) => hoursOf(cfg, w, s, today)?.hours;
  const initial = useMemo(
    () => Object.fromEntries(warehouses.map((w) => [w.id, { morning: cur(w.id, "morning")?.toString() ?? "", night: cur(w.id, "night")?.toString() ?? "" }])) as Record<string, Row>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- คำนวณใหม่เมื่อข้อมูลหรือวันที่เปลี่ยน
    [cfg, warehouses, today],
  );
  const [vals, setVals] = useState<Record<string, Row>>(initial);
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const changed = warehouses.filter((w) => vals[w.id] && (vals[w.id].morning !== initial[w.id].morning || vals[w.id].night !== initial[w.id].night));
  const invalid = changed.filter((w) => parsePositive(vals[w.id].morning, 24) === null || parsePositive(vals[w.id].night, 24) === null);
  const sel = warehouses.find((w) => w.id === wh);

  async function save() {
    if (invalid.length) return;
    setBusy(true);
    const ok = await onSave(from, changed.map((w) => ({ wh: w.id, morning: parsePositive(vals[w.id].morning, 24)!, night: parsePositive(vals[w.id].night, 24)! })), note);
    setBusy(false);
    if (ok) setNote("");
  }

  const big = (shift: PullShift) => {
    const h = hoursOf(cfg, wh, shift, today);
    const next = nextChange(cfg.hours.filter((x) => x.warehouse_id === wh && x.shift === shift), today);
    const morning = shift === "morning";
    return (
      <div className={`flex items-center gap-4 rounded-2xl p-5 ring-1 ${morning ? "bg-[#fff6ec] ring-[#f9d6b0]" : "bg-sky ring-[#cfdcf3]"}`}>
        <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white ${morning ? "bg-[#f97316]" : "bg-brand"}`}>
          <Icon name={morning ? "sun" : "moon"} size={34} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-ink">{morning ? "กะเช้า" : "กะดึก"}</p>
          <p className="text-[13px] text-muted">{sel?.code} · {h ? `เริ่มใช้ ${fromLabel(h.effective_from)}` : "ยังไม่ตั้ง"}</p>
          {next && <p className="text-[13px] font-semibold text-[#8a6500]">ตั้งล่วงหน้า {num(next.hours)} ชม. เริ่ม {fromLabel(next.effective_from)}</p>}
        </div>
        <p className="shrink-0">
          <span className={`text-6xl leading-none font-bold ${morning ? "text-[#f97316]" : "text-[#2563eb]"}`}>{h ? num(h.hours) : "—"}</span>
          <span className="ml-1 text-xl font-bold text-ink">ชม.</span>
        </p>
      </div>
    );
  };

  const future = cfg.hours
    .filter((h) => h.effective_from > today && warehouses.some((w) => w.id === h.warehouse_id))
    .reduce<{ wh: string; from: string }[]>((a, h) => (a.some((x) => x.wh === h.warehouse_id && x.from === h.effective_from) ? a : [...a, { wh: h.warehouse_id, from: h.effective_from }]), []);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {big("morning")}
        {big("night")}
      </div>

      <Card>
        <h2 className="text-xl font-bold text-brand">แยกรายคลัง</h2>
        <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-line">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-3 bg-sky px-4 py-3 text-[15px] font-bold text-ink">
            <span>คลัง</span>
            <span className="text-center">กะเช้า (ชม.)</span>
            <span className="text-center">กะดึก (ชม.)</span>
          </div>
          {warehouses.map((w) => {
            const row = vals[w.id] ?? { morning: "", night: "" };
            const can = canEditWh(w.id);
            const cell = (s: PullShift) => {
              const bad = row[s] !== initial[w.id]?.[s] && parsePositive(row[s], 24) === null;
              return (
                <input
                  inputMode="decimal"
                  className={`${inputCls} text-center text-lg font-bold ${bad ? "ring-2 ring-bad" : ""}`}
                  value={row[s]}
                  disabled={!can}
                  placeholder="ยังไม่ตั้ง"
                  aria-label={`${w.code} ${s === "morning" ? "กะเช้า" : "กะดึก"} (ชั่วโมง)`}
                  onChange={(e) => setVals((v) => ({ ...v, [w.id]: { ...row, [s]: e.target.value } }))}
                />
              );
            };
            return (
              <div key={w.id} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] items-center gap-3 border-t border-line px-4 py-2.5 ${w.id === wh ? "bg-[#f7f9ff]" : ""}`}>
                <span className="min-w-0">
                  <span className="block text-[17px] font-bold text-ink">{w.code}</span>
                  <span className="block truncate text-[13px] text-muted">{w.name}</span>
                </span>
                {cell("morning")}
                {cell("night")}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[#fff8e1] p-4 ring-1 ring-[#f2dc8f]">
          <Icon name="bulb" size={26} className="shrink-0 text-warn" />
          <p className="text-[15px] text-ink">
            <b className="text-[#b45309]">แนะนำ:</b> ใช้ชั่วโมงทำงานสุทธิ (หักเวลาพัก/ประชุม) ตัวเลขคนจะใกล้ความจริงที่สุด · ชั่วโมงเปลี่ยน = จำนวนคนเปลี่ยน
            เช่น งานรับ 400 พาเลท RT รับ 25/ชม. ถ้า 8 ชม. ใช้ 2 คน แต่ 7 ชม. ต้องใช้ 3 คน
          </p>
        </div>
        {future.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 font-semibold text-ink">ค่าที่ตั้งล่วงหน้า</p>
            <ul className="space-y-2">
              {future.map((x) => {
                const w = warehouses.find((y) => y.id === x.wh);
                const m = cfg.hours.find((h) => h.warehouse_id === x.wh && h.effective_from === x.from && h.shift === "morning");
                const n = cfg.hours.find((h) => h.warehouse_id === x.wh && h.effective_from === x.from && h.shift === "night");
                return (
                  <li key={x.wh + x.from} className="flex flex-wrap items-center gap-2 rounded-xl bg-paper p-3">
                    <span className="flex-1 text-[15px]">
                      <b>{w?.code}</b> เริ่ม {fromLabel(x.from)} · เช้า {num(m?.hours)} · ดึก {num(n?.hours)} ชม.
                    </span>
                    {canEditWh(x.wh) && (
                      <Button variant="ghost" size="sm" onClick={() => onDeleteFuture(x.wh, x.from)}>
                        <Icon name="trash" size={18} /> ลบ
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      {changed.length > 0 && (
        <SaveBar text={invalid.length ? "ชั่วโมงต้องมากกว่า 0 และไม่เกิน 24" : `แก้ไข ${changed.length} คลัง`} busy={busy || invalid.length > 0} onCancel={() => setVals(initial)} onSave={save}>
          <label className="flex items-center gap-2 text-[14px] font-semibold whitespace-nowrap text-muted">
            เริ่มใช้
            <input type="date" className={`${inputCls} min-h-10 w-40`} min={today} value={from} onChange={(e) => setFrom(e.target.value || today)} />
          </label>
          <input className={`${inputCls} min-h-10 w-full sm:w-48`} placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </SaveBar>
      )}
    </div>
  );
}
