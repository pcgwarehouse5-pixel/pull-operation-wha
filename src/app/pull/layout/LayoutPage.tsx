"use client";

// ผังตำแหน่งพนักงาน (Warehouse Team Layout) สำหรับประชุมก่อนเริ่มงาน (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 3)
// รุ่นแรก: การ์ดชื่อ + ตัวย่อแทนรูป แยกตามทักษะ พร้อมเวลาพัก (รูปถ่ายและแผนผังคลังจะเพิ่มภายหลัง)
import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Loading, Modal } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { BoardBar, SkillIcon } from "@/components/pull/PullUI";
import { usePullSelection } from "@/components/pull/usePullSelection";
import { usePullBoard } from "@/components/pull/usePullBoard";
import { errText, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { todayIso } from "@/lib/shifts";
import { shortDay } from "@/lib/format";
import { isGlobal } from "@/lib/types";
import { addDays } from "@/lib/pull-data";
import { SHIFT_LABEL, hhmm, skillGroup, skillStyle, type Booking, type PoolPerson } from "@/lib/pull";

const BREAK_COLORS = ["#facc15", "#fb923c", "#ef4444", "#38bdf8", "#a78bfa", "#34d399"];
const GROUP_ICON: Record<string, IconName> = { RT: "forklift", Checker: "clipboard", OP: "trolley", Picker: "cart", CT: "box", โหลดสินค้า: "truck", อื่นๆ: "users" };
const AV = ["#7c3aed", "#2563eb", "#0f8b8d", "#e5484d", "#e8930c", "#1e8e5a", "#db2777"];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("");
const avColor = (id: string) => AV[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % AV.length];
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

type Placed = { booking: Booking; person: PoolPerson | undefined };

export default function LayoutPage() {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const today = todayIso();
  const whs = useMemo(() => {
    const act = warehouses.filter((w) => w.is_active).sort((a, b) => a.code.localeCompare(b.code, "th", { numeric: true }));
    return isGlobal(profile.role) ? act : act.filter((w) => myWarehouseIds.includes(w.id));
  }, [warehouses, myWarehouseIds, profile.role]);
  const sel = usePullSelection(whs, profile.warehouse_id);
  const { data, setData, err, reload, at } = usePullBoard(sel.wh, sel.date, sel.shift);
  const opts = useOptions(["pull_break_time"]);
  const [group, setGroup] = useState("ทั้งหมด");
  const [editing, setEditing] = useState<Placed | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const breaks = (opts.pull_break_time ?? []).filter((o) => o.is_active).map((o) => o.value);
  const breakColor = (t: string | null) => (t ? BREAK_COLORS[Math.max(0, breaks.indexOf(t)) % BREAK_COLORS.length] : null);
  const whCode = whs.find((w) => w.id === sel.wh)?.code ?? "";
  const canEdit = sel.date >= today;

  const bar = (
    <BoardBar
      title="ผังตำแหน่งพนักงาน"
      sub={`Warehouse Team Layout · ${whCode} · ${shortDay(sel.date)} · ${SHIFT_LABEL[sel.shift]}`}
      whs={whs} wh={sel.wh} setWh={sel.setWh} date={sel.date} setDate={sel.setDate} shift={sel.shift} setShift={sel.setShift}
      max={addDays(today, 60)} onRefresh={reload} at={at}
    />
  );
  if (!sel.wh) return <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>{bar}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;
  if (!data) return <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>{bar}{err ? <Alert tone="error">{err}</Alert> : <Loading />}</AppShell>;

  const byId = new Map(data.pool.map((p) => [p.user_id, p]));
  const placed: Placed[] = data.bookings.map((b) => ({ booking: b, person: byId.get(b.user_id) }));
  const skills = [...new Set([...data.reqs.map((r) => r.skill_name), ...placed.map((p) => p.booking.skill_name)])];
  const groups = [...new Set(skills.map(skillGroup))];
  const shown = skills.filter((s) => group === "ทั้งหมด" || skillGroup(s) === group);
  const inGroup = placed.filter((p) => group === "ทั้งหมด" || skillGroup(p.booking.skill_name) === group);
  const notPlaced = data.pool.filter((p) => p.warehouse_id === sel.wh && p.status === "ready");
  const starts = [...new Set(inGroup.map((p) => p.person?.start_min).filter((m): m is number => m !== null && m !== undefined))].sort((a, b) => a - b);

  async function setBreak(p: Placed, time: string | null) {
    try {
      if (demo) {
        setData((d) => d && { ...d, bookings: d.bookings.map((b) => (b.id === p.booking.id ? { ...b, break_time: time ? `${time}:00` : null } : b)) });
      } else {
        const { error } = await sb().rpc("set_pull_break", { p_id: p.booking.id, p_time: time });
        if (error) throw error;
        reload();
      }
      setEditing(null);
      setMsg({ tone: "success", text: `ตั้งเวลาพัก ${p.person?.name ?? ""} ${time ?? "(ล้าง)"} แล้ว${demo ? " · โหมดตัวอย่าง" : ""}` });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
      setEditing(null);
    }
  }

  return (
    <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>
      {bar}
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 font-bold text-brand">เลือกตำแหน่งหลัก</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {["ทั้งหมด", ...groups].map((g) => {
                const on = g === group;
                const n = placed.filter((p) => g === "ทั้งหมด" || skillGroup(p.booking.skill_name) === g).length;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroup(g)}
                    aria-pressed={on}
                    className={`flex min-h-14 shrink-0 items-center gap-3 rounded-2xl px-3 text-left ring-1 ${on ? "bg-sky ring-brand" : "bg-white ring-line"}`}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full text-white" style={{ background: g === "ทั้งหมด" ? "#1b2a5c" : skillStyle(skills.find((s) => skillGroup(s) === g) ?? g).color }}>
                      <Icon name={GROUP_ICON[g] ?? "users"} size={22} />
                    </span>
                    <span className="flex-1 text-[17px] font-bold text-ink">{g}</span>
                    <span className="text-[15px] font-semibold text-muted">{n}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="hidden lg:block">
            <h2 className="font-bold text-brand">สรุปจำนวนพนักงาน ({group})</h2>
            <p className="mt-2 flex items-center gap-2 text-ink"><Icon name="users" size={24} className="text-[#2563eb]" /> ทั้งหมด <b className="ml-auto text-3xl text-[#2563eb]">{inGroup.length}</b> คน</p>
            <ul className="mt-2 space-y-1.5">
              {shown.map((s) => (
                <li key={s} className="flex items-center gap-2 text-[15px]">
                  <SkillIcon name={s} size={26} />
                  <span className="min-w-0 flex-1 truncate">{s}</span>
                  <b>{placed.filter((p) => p.booking.skill_name === s).length}</b>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[15px] text-ink">
              <Icon name={sel.shift === "morning" ? "sun" : "moon"} size={22} className="text-[#f97316]" />
              {SHIFT_LABEL[sel.shift]} · เข้างาน {starts.length ? starts.map(hhmm).join(", ") : "—"}
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ background: group === "ทั้งหมด" ? "#1b2a5c" : skillStyle(shown[0] ?? group).color }}>
                <Icon name={GROUP_ICON[group] ?? "users"} size={30} />
              </span>
              <h2 className="text-3xl font-bold text-brand">{group}</h2>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-muted">เวลาพัก</span>
                {breaks.map((b) => (
                  <span key={b} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[14px] font-semibold ring-1 ring-line">
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: breakColor(b)! }} /> พัก {b}
                  </span>
                ))}
                {breaks.length === 0 && <span className="text-[13px] text-muted">ยังไม่ได้ตั้งเวลาพัก (ตั้งค่าตัวเลือก → เวลาพัก)</span>}
              </div>
            </div>
            {canEdit && placed.length > 0 && <p className="mt-2 text-[13px] text-muted">แตะการ์ดพนักงานเพื่อตั้งเวลาพัก</p>}
          </Card>

          {placed.length === 0 && (
            <Alert tone="warning">
              ยังไม่มีคนที่จองเข้าคลังนี้ในวัน/กะนี้ <Link href="/pull" className="font-semibold underline">ไปหน้าดึงคน</Link>
            </Alert>
          )}

          {shown.map((s) => {
            const people = placed.filter((p) => p.booking.skill_name === s).sort((a, b) => (a.booking.break_time ?? "99").localeCompare(b.booking.break_time ?? "99"));
            if (!people.length) return null;
            const st = skillStyle(s);
            return (
              <section key={s} className="overflow-hidden rounded-[20px] bg-white ring-1 ring-line">
                <h3 className="flex items-center gap-2 px-4 py-2.5 text-lg font-bold text-white" style={{ background: st.color }}>
                  <SkillIcon name={s} size={30} /> {s} <span className="ml-auto text-[15px] font-semibold">{people.length} คน</span>
                </h3>
                <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-5">
                  {people.map((p) => {
                    const t = hm(p.booking.break_time);
                    const col = breakColor(t);
                    const other = p.person && p.person.warehouse_id !== sel.wh;
                    return (
                      <li key={p.booking.id}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setEditing(p)}
                          className="flex w-full flex-col items-center overflow-hidden rounded-2xl bg-[#fffbea] text-center ring-1 ring-[#f3e3a1] disabled:cursor-default"
                          aria-label={`${p.person?.name ?? "พนักงาน"} เวลาพัก ${t ?? "ยังไม่ตั้ง"}`}
                        >
                          <span className="mt-3 flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white ring-4 ring-white" style={{ background: avColor(p.booking.user_id) }}>
                            {initials(p.person?.name ?? "?")}
                          </span>
                          <span className="mt-2 w-full truncate px-2 text-[17px] font-bold text-ink">{p.person?.nickname || p.person?.name.split(" ")[0] || "พนักงาน"}</span>
                          <span className="w-full truncate px-2 text-[12px] text-muted">{p.person?.employee_code}{other ? ` · มาจาก ${p.person?.warehouse_code}` : ""}</span>
                          <span className="mt-2 w-full py-1.5 text-[15px] font-bold" style={{ background: col ?? "#eef1f6", color: col ? "#16204a" : "#5a6482" }}>
                            {t ? `พัก ${t}` : "ยังไม่ตั้งเวลาพัก"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {group === "ทั้งหมด" && notPlaced.length > 0 && (
            <Card>
              <h3 className="font-bold text-ink">คนในคลัง {whCode} ที่เข้ากะนี้แต่ยังไม่ได้จัดลงงาน ({notPlaced.length} คน)</h3>
              <p className="text-[13px] text-muted">จองให้ที่หน้าดึงคน เพื่อให้ขึ้นในผังตำแหน่ง</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {notPlaced.map((p) => (
                  <li key={p.user_id} className="rounded-full bg-paper px-3 py-1.5 text-[14px] ring-1 ring-line">
                    {p.nickname || p.name} <span className="text-muted">· {p.skills.slice(0, 2).join(", ") || "ไม่มีทักษะ"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={`เวลาพัก · ${editing.person?.name ?? "พนักงาน"}`} onClose={() => setEditing(null)}>
          <p className="text-muted">{editing.booking.skill_name}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {breaks.map((b) => (
              <button key={b} type="button" onClick={() => setBreak(editing, b)} className={`flex min-h-14 items-center justify-center gap-2 rounded-xl font-bold ring-1 ${hm(editing.booking.break_time) === b ? "bg-sky ring-brand" : "bg-white ring-line"}`}>
                <span className="h-4 w-4 rounded-full" style={{ background: breakColor(b)! }} /> พัก {b}
              </button>
            ))}
          </div>
          {breaks.length === 0 && <p className="mt-2 text-[14px] text-muted">ยังไม่มีรายการเวลาพัก แอดมินเพิ่มได้ที่ ตั้งค่าตัวเลือก → เวลาพัก (Pull)</p>}
          <div className="mt-4 flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setBreak(editing, null)} disabled={!editing.booking.break_time}>ล้างเวลาพัก</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>ปิด</Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
