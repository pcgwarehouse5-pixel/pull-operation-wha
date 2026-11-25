"use client";

// ผังตำแหน่งพนักงาน (Warehouse Team Layout) สำหรับประชุมก่อนเริ่มงาน (ไฟล์ "Pull-Operation Operation & Dashboard" หน้า 3)
// การ์ดชื่อ + ไอคอนคน (หมวกนิรภัย/เสื้อกั๊กสีตามตำแหน่ง) แยกตามทักษะ พร้อมเวลาพัก · ด้านบนมีแผนที่คลัง 3D ของคลังที่เลือก (ถ้ามีผัง: WH5 / WH32)
// บนแผนที่: คนที่จองแล้วเป็นตัวคน 3D สีตามตำแหน่ง กรองตามคลังต้นทาง/ตำแหน่งได้ · หัวหน้าลากวางแล้วบันทึกลงระบบ (set_pull_positions)
import { useEffect, useMemo, useState } from "react";
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
import { addDays, loadMapHistory } from "@/lib/pull-data";
import { SHIFT_LABEL, hhmm, skillGroup, skillStyle, type Booking, type PoolPerson } from "@/lib/pull";
import { WAREHOUSE_MAPS, warehouseMapKey } from "@/lib/warehouse3d/maps";
import { placePeople, skillAnchors, type HistoryRow } from "@/lib/warehouse3d/placement";
import type { Move, PersonObj } from "@/lib/warehouse3d/scene";
import { Warehouse3D } from "@/components/pull/Warehouse3D";
import { WorkerIcon } from "@/components/pull/WorkerIcon";
import { breakPair, breakShort, breakSlots, type BreakSlot } from "@/lib/break-times";

const BREAK_COLORS = ["#facc15", "#fb923c", "#ef4444", "#38bdf8", "#a78bfa", "#34d399"];
const GROUP_ICON: Record<string, IconName> = { RT: "forklift", Checker: "clipboard", OP: "trolley", Picker: "cart", CT: "box", โหลดสินค้า: "truck", อื่นๆ: "users" };
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
  /* ตัวกรองบนแผนที่: คลังต้นทางของพนักงาน · ตำแหน่งที่ซ่อน */
  const [mapSrc, setMapSrc] = useState("ทั้งหมด");
  /* ตำแหน่งที่ติ๊กเลือกแสดง (ไม่ติ๊กเลย = ทุกตำแหน่ง) · ใช้ทั้งบนแผนที่และการ์ดด้านล่าง (แคปไปประชุมได้ตรงกัน) */
  const [mapOn, setMapOn] = useState<string[]>([]);
  const [hist, setHist] = useState<HistoryRow[]>([]);

  /* เวลาพัก 2 รอบของผลัดที่เลือก: เลือกรอบแรก ระบบรู้รอบ 2 เอง (ตั้งค่าตัวเลือก → เวลาพัก (Pull)) */
  const breaks = useMemo(() => breakSlots(opts.pull_break_time, sel.shift), [opts.pull_break_time, sel.shift]);
  const breakIndex = (t: string | null) => (t ? breaks.findIndex((b) => b.first === t) : -1);
  const breakColor = (t: string | null) => (t ? BREAK_COLORS[Math.max(0, breakIndex(t)) % BREAK_COLORS.length] : null);
  const pairOf = (t: string | null | undefined): BreakSlot | null => breakPair(opts.pull_break_time, sel.shift, t);
  const whCode = whs.find((w) => w.id === sel.wh)?.code ?? "";
  const canEdit = sel.date >= today;
  const mapKey = warehouseMapKey(whCode);

  /* จุดที่แต่ละตำแหน่งเคยวางล่าสุดในคลังนี้ (ใช้วางคนที่ยังไม่ได้ลาก) */
  useEffect(() => {
    if (!sel.wh || !mapKey) return;
    let live = true;
    (async () => {
      try {
        const h = demo ? demo.previewPullMapHistory(sel.wh) : await loadMapHistory(sel.wh);
        if (live) setHist(h);
      } catch {
        if (live) setHist([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [demo, sel.wh, mapKey, at]);

  /* ตำแหน่งบนแผนที่ของทุกคน (คิดจากทุกคน ไม่ขึ้นกับตัวกรอง → กล่องไม่กระโดดเวลาเปลี่ยนตัวกรอง) */
  const mapPos = useMemo(() => {
    if (!data || !mapKey) return {};
    return placePeople(
      data.bookings.map((b) => ({ id: b.id, skill: b.skill_name, x: b.map_x ?? null, y: b.map_y ?? null })),
      skillAnchors(hist),
      WAREHOUSE_MAPS[mapKey],
    );
  }, [data, mapKey, hist]);

  const mapPeople = useMemo<PersonObj[]>(() => {
    if (!data) return [];
    const who = new Map(data.pool.map((p) => [p.user_id, p]));
    const firsts = breakSlots(opts.pull_break_time, sel.shift).map((x) => x.first);
    return data.bookings
      .filter((b) => mapPos[b.id] && (mapOn.length === 0 || mapOn.includes(b.skill_name)))
      .filter((b) => mapSrc === "ทั้งหมด" || who.get(b.user_id)?.warehouse_code === mapSrc)
      .map((b) => {
        const p = who.get(b.user_id), t = hm(b.break_time), pair = breakPair(opts.pull_break_time, b.shift, b.break_time);
        /* ป้ายบนแผนที่: ชื่อเล่น + เวลาพัก 2 รอบ (สีเดียวกับการ์ด) */
        return {
          id: b.id, x: mapPos[b.id].x, y: mapPos[b.id].y, color: skillStyle(b.skill_name).color,
          label: p?.nickname || p?.name.split(" ")[0] || "พนักงาน", group: b.skill_name, groupLabel: b.skill_name,
          sub: pair ? breakShort(pair) : "ยังไม่ตั้งเวลาพัก",
          subBg: t ? BREAK_COLORS[Math.max(0, firsts.indexOf(t)) % BREAK_COLORS.length] : "#eef1f6",
          subFg: t ? "#16204a" : "#5a6482",
        };
      });
  }, [data, mapPos, mapSrc, mapOn, opts.pull_break_time, sel.shift]);

  const bar = (
    <BoardBar
      title="ผังตำแหน่งพนักงาน"
      sub={`Warehouse Team Layout · ${whCode} · ${shortDay(sel.date)} · ${sel.shiftLabel(sel.shift)}`}
      whs={whs} wh={sel.wh} setWh={sel.setWh} date={sel.date} setDate={sel.setDate} shift={sel.shift} setShift={sel.setShift}
      max={addDays(today, 60)} onRefresh={reload} at={at} meetings={sel.meetings}
    />
  );
  if (!sel.wh) return <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>{bar}<Alert tone="warning">คุณยังไม่มีคลังที่ดูแล</Alert></AppShell>;
  if (!data) return <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>{bar}{err ? <Alert tone="error">{err}</Alert> : <Loading />}</AppShell>;

  const byId = new Map(data.pool.map((p) => [p.user_id, p]));
  const placed: Placed[] = data.bookings.map((b) => ({ booking: b, person: byId.get(b.user_id) }));
  const skills = [...new Set([...data.reqs.map((r) => r.skill_name), ...placed.map((p) => p.booking.skill_name)])];
  const groups = [...new Set(skills.map(skillGroup))];
  const ticked = (s: string) => mapOn.length === 0 || mapOn.includes(s);
  const shown = skills.filter((s) => (group === "ทั้งหมด" || skillGroup(s) === group) && ticked(s));
  const inGroup = placed.filter((p) => (group === "ทั้งหมด" || skillGroup(p.booking.skill_name) === group) && ticked(p.booking.skill_name));
  const notPlaced = data.pool.filter((p) => p.warehouse_id === sel.wh && p.status === "ready");
  const starts = [...new Set(inGroup.map((p) => p.person?.start_min).filter((m): m is number => m !== null && m !== undefined))].sort((a, b) => a - b);

  async function setBreak(p: Placed, time: string | null) {
    try {
      if (demo) {
        demo.previewSetPullBreak(p.booking.id, time);
        reload();
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

  /* บันทึกตำแหน่งบนแผนที่ · คนตำแหน่งเดียวกันที่ยังวางอัตโนมัติอยู่ ถูกบันทึกตามที่เห็นไปด้วย (จะได้ไม่ขยับตามคนที่ถูกลาก) */
  async function savePositions(moves: { id: string; x: number | null; y: number | null }[], note: string) {
    if (!data || !canEdit) return;
    const ids = new Set(moves.map((m) => m.id));
    const skillsMoved = new Set(data.bookings.filter((b) => ids.has(b.id)).map((b) => b.skill_name));
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const extra = moves.some((m) => m.x !== null)
      ? data.bookings.filter((b) => !ids.has(b.id) && skillsMoved.has(b.skill_name) && b.map_x == null && mapPos[b.id]).map((b) => ({ id: b.id, x: r1(mapPos[b.id].x), y: r1(mapPos[b.id].y) }))
      : [];
    const items = [...moves, ...extra];
    const at2 = new Map(items.map((i) => [i.id, i]));
    setData((d) => (d ? { ...d, bookings: d.bookings.map((b) => (at2.has(b.id) ? { ...b, map_x: at2.get(b.id)!.x, map_y: at2.get(b.id)!.y } : b)) } : d));
    try {
      if (demo) demo.previewSetPullPositions(items);
      else {
        const { error } = await sb().rpc("set_pull_positions", { p_items: items });
        if (error) throw error;
      }
      setMsg({ tone: "success", text: `${note}${demo ? " · โหมดตัวอย่าง" : ""}` });
    } catch (e) {
      setMsg({ tone: "error", text: `บันทึกตำแหน่งไม่สำเร็จ: ${errText(e)}` });
      reload();
    }
  }
  const onMapMove = (moves: Move[]) => {
    const b = data.bookings.find((x) => x.id === moves[0]?.id);
    const who = b ? byId.get(b.user_id) : undefined;
    void savePositions(moves, moves.length > 1 ? `ย้ายกลุ่ม ${b?.skill_name ?? ""} (${moves.length} คน) แล้ว` : `ย้าย ${who?.nickname || who?.name || "พนักงาน"} แล้ว`);
  };
  const resetMap = () => {
    if (!mapPeople.length || !window.confirm(`จัดเรียง ${mapPeople.length} คนที่แสดงบนแผนที่ใหม่อัตโนมัติ (ตำแหน่งที่ลากไว้ของรอบนี้จะถูกล้าง)?`)) return;
    void savePositions(mapPeople.map((p) => ({ id: p.id, x: null, y: null })), `จัดเรียงใหม่อัตโนมัติ ${mapPeople.length} คนแล้ว`);
  };
  const srcCodes = [...new Set(placed.map((p) => p.person?.warehouse_code).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
  const mapSkills = [...new Set(placed.map((p) => p.booking.skill_name))];
  const chip = (on: boolean) => `min-h-10 shrink-0 rounded-full px-3 text-[14px] font-semibold ring-1 ${on ? "bg-sky text-ink ring-brand" : "bg-white text-muted ring-line"}`;
  /* กรองอยู่ = ซูมเข้าหาคนกลุ่มนั้น · หัวภาพที่บันทึก = คลัง วันที่ กะ + ตำแหน่งที่แสดง (จำนวนคน) */
  const filtered = mapSrc !== "ทั้งหมด" || mapOn.length > 0;
  const shownSkills = mapSkills.filter((s) => mapPeople.some((p) => p.group === s));
  const shot = {
    title: `ผังตำแหน่ง ${whCode} · ${shortDay(sel.date)} · ${sel.shiftLabel(sel.shift)}${mapSrc !== "ทั้งหมด" ? ` · พนักงานจาก ${mapSrc}` : ""}`,
    legend: shownSkills.map((s) => ({ label: `${s} ${mapPeople.filter((p) => p.group === s).length} คน`, color: skillStyle(s).color })),
    file: `ผังตำแหน่ง-${whCode}-${sel.date}-${sel.shift === "morning" ? "กะเช้า" : "กะดึก"}${mapOn.length ? "-" + mapOn.join("+") : ""}.png`.replace(/[\\/:*?"<>|()\s]+/g, "_"),
  };

  return (
    <AppShell title="ผังตำแหน่ง" minRole="supervisor" wide>
      {bar}
      {err && <div className="mb-4"><Alert tone="error">{err}</Alert></div>}
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {mapKey && (
        <Warehouse3D
          mapKey={mapKey} people={mapPeople} editable={canEdit} onMove={onMapMove}
          onTap={(id) => { const p = placed.find((x) => x.booking.id === id); if (p && canEdit) setEditing(p); }}
          focus={filtered} focusKey={`${mapSrc}|${mapOn.join(",")}`} shot={shot}
        >
          {placed.length === 0 ? (
            <p className="text-[14px] text-muted">ยังไม่มีคนที่จองเข้าคลังนี้ในวัน/กะนี้ · จองแล้วจะขึ้นเป็นตัวคนบนแผนที่ สีตามตำแหน่งงาน</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-[14px] font-semibold text-ink">พนักงานจากคลัง</span>
                {["ทั้งหมด", ...srcCodes].map((c) => (
                  <button key={c} type="button" aria-pressed={mapSrc === c} className={chip(mapSrc === c)} onClick={() => setMapSrc(c)}>{c}</button>
                ))}
              </div>
              <fieldset className="rounded-2xl bg-paper p-2.5 ring-1 ring-line">
                <legend className="sr-only">ติ๊กเลือกตำแหน่งที่จะแสดงในผัง</legend>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold text-ink">ติ๊กเลือกตำแหน่งที่จะแสดงในผัง</span>
                  <span className="text-[13px] text-muted">{mapOn.length ? `เลือกไว้ ${mapOn.length} ตำแหน่ง` : "ยังไม่ติ๊ก = แสดงทุกตำแหน่ง"}</span>
                  <span className="flex-1" />
                  <button type="button" className="min-h-10 rounded-lg px-2 text-[14px] font-semibold text-brand underline disabled:text-muted disabled:no-underline" disabled={!mapOn.length} onClick={() => setMapOn([])}>
                    ล้าง (แสดงทุกตำแหน่ง)
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mapSkills.map((s) => {
                    const on = mapOn.includes(s);
                    const c = skillStyle(s).color;
                    return (
                      <label key={s} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl px-3 text-[15px] font-semibold ring-1 select-none ${on ? "bg-white text-ink ring-2" : "bg-white text-muted ring-line"}`} style={on ? { boxShadow: `inset 0 0 0 2px ${c}` } : undefined}>
                        <input type="checkbox" aria-label={`แสดง ${s} ในผัง`} className="h-6 w-6 shrink-0 cursor-pointer" style={{ accentColor: c }} checked={on} onChange={() => setMapOn(on ? mapOn.filter((x) => x !== s) : [...mapOn, s])} />
                        <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: c }} />
                        <span className={on ? "text-ink" : ""}>{s}</span>
                        <span className="rounded-full bg-paper px-2 text-[13px] text-muted">{placed.filter((p) => p.booking.skill_name === s).length}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                แสดงบนแผนที่ {mapPeople.length} จาก {placed.length} คน{filtered ? " · ซูมเข้าหาตำแหน่งที่เลือกให้แล้ว · การ์ดด้านล่างแสดงเฉพาะตำแหน่งที่ติ๊กด้วย" : " · ติ๊กตำแหน่งเพื่อแสดงเฉพาะตำแหน่งนั้น (ติ๊กได้หลายตำแหน่ง)"}
                {canEdit && mapPeople.length > 0 && (
                  <button type="button" onClick={resetMap} className="min-h-10 font-semibold text-brand underline">↺ จัดเรียงใหม่อัตโนมัติ</button>
                )}
              </p>
            </div>
          )}
        </Warehouse3D>
      )}

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
                <span className="text-[14px] font-semibold text-muted">เวลาพัก 2 รอบ</span>
                {breaks.map((b) => (
                  <span key={b.first} className="num flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[14px] font-semibold ring-1 ring-line" title={b.note ? `รอบ 2 ${b.note}` : undefined}>
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: breakColor(b.first)! }} /> {breakShort(b)}
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
            // เรียงตามลำดับเวลาพักของผลัด (ผลัดดึก 23:30 มาก่อน 00:00) · ยังไม่ตั้งอยู่ท้าย
            const order = (t: string | null) => {
              const i = breakIndex(hm(t));
              return i < 0 ? (t ? 900 : 999) : i;
            };
            const people = placed.filter((p) => p.booking.skill_name === s).sort((a, b) => order(a.booking.break_time) - order(b.booking.break_time));
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
                    const pair = pairOf(p.booking.break_time);
                    const other = p.person && p.person.warehouse_id !== sel.wh;
                    return (
                      <li key={p.booking.id}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setEditing(p)}
                          className="flex w-full flex-col items-center overflow-hidden rounded-2xl bg-white text-center shadow-[0_2px_10px_rgba(17,28,65,0.08)] ring-1 ring-line transition active:scale-[0.98] enabled:hover:ring-2 enabled:hover:ring-brand/40 disabled:cursor-default"
                          style={{ backgroundImage: `linear-gradient(to bottom, ${st.color}26, #ffffff 58%)` }}
                          aria-label={`${p.person?.name ?? "พนักงาน"} เวลาพัก ${pair ? `${pair.first}${pair.second ? ` และ ${pair.second}` : ""}` : "ยังไม่ตั้ง"}`}
                        >
                          <span className="mt-3 rounded-full bg-white p-[3px] shadow-[0_4px_14px_rgba(17,28,65,0.18)]">
                            <WorkerIcon color={st.color} seed={p.booking.user_id} size={84} />
                          </span>
                          <span className="mt-2 w-full truncate px-2 text-[18px] leading-tight font-bold text-ink">{p.person?.nickname || p.person?.name.split(" ")[0] || "พนักงาน"}</span>
                          <span className="w-full truncate px-2 text-[12px] text-muted">{p.person?.employee_code}{other ? ` · มาจาก ${p.person?.warehouse_code}` : ""}</span>
                          <span className="num mt-2 flex w-full flex-col py-1.5 leading-tight font-bold" style={{ background: col ?? "#eef1f6", color: col ? "#16204a" : "#5a6482" }}>
                            {pair ? (
                              <>
                                <span className="text-[15px]">{breakShort(pair)}</span>
                                {pair.note && <span className="text-[11px] font-semibold opacity-80">รอบ 2 {pair.note}</span>}
                              </>
                            ) : (
                              <span className="text-[15px]">ยังไม่ตั้งเวลาพัก</span>
                            )}
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
          <p className="text-muted">{editing.booking.skill_name} · {sel.shiftLabel(sel.shift).split(" ")[0]}</p>
          <p className="mt-1 text-[14px] text-muted">เลือกเวลาพักรอบแรก ระบบใส่เวลาพักรอบ 2 ให้อัตโนมัติ และแจ้งพนักงานทั้ง 2 เวลา</p>
          <div className="mt-3 grid gap-2">
            {breaks.map((b) => {
              const on = hm(editing.booking.break_time) === b.first;
              return (
                <button
                  key={b.first}
                  type="button"
                  onClick={() => setBreak(editing, b.first)}
                  aria-pressed={on}
                  className={`num flex min-h-16 items-center gap-3 rounded-xl px-3 text-left ring-1 ${on ? "bg-sky ring-2 ring-brand" : "bg-white ring-line"}`}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: breakColor(b.first)! }} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[18px] font-bold text-ink">พัก {b.first}</span>
                    {b.second && (
                      <span className="block text-[14px] font-semibold text-muted">
                        และ {b.second}
                        {b.note ? ` (${b.note})` : ""}
                      </span>
                    )}
                  </span>
                  {on && <Icon name="check" size={20} className="shrink-0 text-brand" />}
                </button>
              );
            })}
          </div>
          {editing.booking.break_time && breakIndex(hm(editing.booking.break_time)) < 0 && (
            <p className="mt-2 rounded-lg bg-[#fff6d6] px-3 py-2 text-[14px] font-semibold text-[#8a6500]">
              ตอนนี้ตั้งไว้ พัก {hm(editing.booking.break_time)} ซึ่งไม่ใช่เวลาพักของผลัดนี้ กรุณาเลือกใหม่
            </p>
          )}
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
