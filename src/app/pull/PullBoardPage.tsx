"use client";

// หน้าสรุปกำลังพลที่ต้องการ (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 1)
// กดการ์ดตำแหน่ง → ไปหน้าดึงกำลังคนทีละตำแหน่ง
import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Loading } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { BoardBar, ProgressBar, SkillIcon } from "@/components/pull/PullUI";
import { usePullSelection } from "@/components/pull/usePullSelection";
import { usePullBoard } from "@/components/pull/usePullBoard";
import { LeftoverStaff } from "@/components/pull/LeftoverStaff";
import { todayIso } from "@/lib/shifts";
import { shortDay } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays } from "@/lib/pull-data";
import { SHIFT_LABEL, skillStyle, staffShortage, summarize } from "@/lib/pull";

export default function PullBoardPage() {
  const { profile, warehouses, myWarehouseIds } = useApp();
  const today = todayIso();
  const whs = useMemo(() => {
    const act = warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true }));
    return isGlobal(profile.role) ? act : act.filter((w) => myWarehouseIds.includes(w.id));
  }, [warehouses, myWarehouseIds, profile.role]);
  const sel = usePullSelection(whs, profile.warehouse_id);
  const { data, err, reload, at } = usePullBoard(sel.wh, sel.date, sel.shift);
  const whCode = whs.find((w) => w.id === sel.wh)?.code ?? "";

  const bar = (
    <BoardBar
      title="Pull Operation · สรุปกำลังพลที่ต้องการ"
      sub={`${whCode} · ${shortDay(sel.date)} · ${sel.shiftLabel(sel.shift)} · กดการ์ดตำแหน่งเพื่อดึงคน`}
      whs={whs} wh={sel.wh} setWh={sel.setWh} date={sel.date} setDate={sel.setDate} shift={sel.shift} setShift={sel.setShift}
      max={addDays(today, 60)} onRefresh={reload} at={at} meetings={sel.meetings}
    />
  );
  if (!sel.wh) return <AppShell title="สรุปกำลังพล" minRole="supervisor" wide>{bar}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;

  const s = data ? summarize(data.reqs, data.pool, data.bookings) : null;
  const lack = data ? staffShortage(data.reqs, data.pool) : null;
  const lackOf = new Map((lack?.rows ?? []).map((r) => [r.skill, r]));
  const missingAll = !!data && data.reqs.length > 0 && data.reqs.every((q) => q.missing === "ยังไม่กรอกยอดงาน");

  return (
    <AppShell title="สรุปกำลังพล" minRole="supervisor" wide>
      {bar}
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {!data || !s ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi icon="users" color="#2563eb" label="กำลังคนทั้งหมด" value={s.total} hint="คนในคลังกลางที่มีทักษะและเข้ากะนี้" />
            <Kpi icon="leave" color="#0ea5e9" label="ต้องการทั้งหมด" value={s.need} hint={s.need === null ? "ยังคำนวณไม่ครบ" : undefined} />
            <Kpi icon="check" color="#1e8e5a" label="จองแล้วทั้งหมด" value={s.booked} />
            <Kpi icon="clock" color="#e5484d" label="รอจองทั้งหมด" value={s.waiting} tint="#fdecec" />
            <Kpi icon="users" color="#f59e0b" label="คนคงเหลือ" value={s.left} tint="#fdf3e1" hint="ยังว่าง พร้อมดึง" wide />
          </div>

          {missingAll && (
            <div className="mb-4">
              <Alert tone="warning">
                ยังไม่ได้กรอกยอดงานของ {shortDay(sel.date)} {SHIFT_LABEL[sel.shift]} จึงยังไม่มีจำนวนที่ต้องการ (ยังดึงคนได้){" "}
                <Link href="/pull/workload" className="font-semibold underline">กรอกปริมาณงาน</Link>
              </Alert>
            </div>
          )}
          {lack && lack.short > 0 && (
            <div className="mb-4">
              <Alert tone="error">
                <b>กำลังคนไม่พอ</b> · ต้องการ {lack.need} คน แต่คนที่พร้อมในกะนี้ (รวมที่จองแล้ว) จัดลงได้ {lack.fill} คน · <b>ขาด {lack.short} คน</b>
                {lack.rows.some((x) => x.short > 0) && <> ({lack.rows.filter((x) => x.short > 0).map((x) => `${x.skill} ขาด ${x.short}`).join(", ")})</>}
              </Alert>
            </div>
          )}
          {data.reqs.length === 0 && (
            <div className="mb-4"><Alert tone="warning">คลังนี้ยังไม่ได้เปิดทักษะที่ดึงได้ (แอดมินตั้งที่ ตั้งค่า Pull)</Alert></div>
          )}

          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {s.rows.map((r) => {
              const st = skillStyle(r.skill);
              const short = r.need !== null && r.booked < r.need;
              const q = data.reqs.find((x) => x.skill_name === r.skill);
              return (
                <li key={r.skill}>
                  <Link
                    href={`/pull/skill/${encodeURIComponent(r.skill)}`}
                    className={`block overflow-hidden rounded-[20px] bg-white ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${short ? "ring-[#f5b5b7]" : r.need !== null ? "ring-[#bfe3cf]" : "ring-line"}`}
                  >
                    <div className="flex items-center gap-3 px-4 py-3" style={{ background: `linear-gradient(90deg, ${st.tint}, #ffffff)` }}>
                      <SkillIcon name={r.skill} size={48} />
                      <span className="min-w-0 flex-1 text-xl leading-snug font-bold break-words text-ink">{r.skill}</span>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-sm"><Icon name="next" size={20} /></span>
                    </div>
                    <div className="grid grid-cols-4 divide-x divide-line px-2 pt-2 text-center">
                      <Stat label="ต้องการ" value={r.need} color="text-brand" />
                      <Stat label="จองแล้ว" value={r.booked} color="text-ok" />
                      <Stat label="รอจอง" value={r.waiting} color="text-[#e5484d]" />
                      <Stat label="คนเหลือ" value={r.left} color="text-[#2563eb]" />
                    </div>
                    <div className="px-4 pt-2 pb-3">
                      <ProgressBar booked={r.booked} need={r.need} />
                      {r.need === null && q?.missing && <p className="mt-1 text-[13px] font-semibold text-[#8a6500]">{q.missing}</p>}
                      {(lackOf.get(r.skill)?.short ?? 0) > 0 && (
                        <p className="mt-1.5 flex items-center gap-1 text-[14px] font-bold text-bad"><Icon name="alert" size={18} /> กำลังคนไม่พอ ขาด {lackOf.get(r.skill)!.short} คน</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <LeftoverStaff key={`${sel.date}-${sel.shift}`} pool={data.pool} date={sel.date} shift={sel.shift} canEditDate={sel.date >= today} />
        </>
      )}
    </AppShell>
  );
}

function Kpi({ icon, color, label, value, tint, hint, wide }: { icon: IconName; color: string; label: string; value: number | null; tint?: string; hint?: string; wide?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-[20px] p-4 ring-1 ring-line ${wide ? "col-span-2 lg:col-span-1" : ""}`} style={{ background: tint ?? "#ffffff" }}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white" style={{ background: color }}><Icon name={icon} size={28} /></span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-ink">{label}</p>
        <p className="leading-none"><span className="text-4xl font-bold tabular-nums" style={{ color }}>{value ?? "—"}</span> <span className="text-lg font-semibold" style={{ color }}>คน</span></p>
        {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="px-1 py-1">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="leading-tight"><span className={`text-3xl font-bold tabular-nums ${color}`}>{value ?? "—"}</span> <span className="text-[13px] text-muted">คน</span></p>
    </div>
  );
}

