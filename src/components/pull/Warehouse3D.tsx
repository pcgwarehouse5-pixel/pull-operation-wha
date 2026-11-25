"use client";

// แผนที่คลัง 3D บนหน้าผังตำแหน่ง · โหลดตัววาด 3D (three.js) แยกไฟล์เฉพาะตอนเปิดแผนที่ ไม่ทำให้หน้าอื่นช้า
// ล็อกมุมกล้องเป็นค่าเริ่ม (เลื่อนหน้าเว็บผ่านแผนที่ได้บนมือถือ) · กด "หมุน/ซูมได้" ถึงลาก/หมุน/ซูม
// คนที่จองแล้วขึ้นเป็นตัวคน 3D สีตามตำแหน่งงาน · กด "จัดตำแหน่ง" แล้วลากตัวคน/ป้ายชื่อ (รายคน) หรือป้ายกลุ่ม (ทั้งกลุ่ม)
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { WAREHOUSE_MAPS } from "@/lib/warehouse3d/maps";
import type { ViewMode } from "@/lib/warehouse3d/types";
import type { Warehouse3D as Engine, Move, PersonObj, Shot } from "@/lib/warehouse3d/scene";

const HIDE_KEY = "wha-map3d-hidden";
const VIEWS: [ViewMode, string][] = [["3d", "มุม 3D"], ["front", "มุมหน้า"], ["top", "มุมบน"]];

function readHidden() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

type Props = {
  mapKey: string;
  people?: PersonObj[];
  /** มีสิทธิ์จัดตำแหน่ง (คลังที่ดูแล และวันนี้หรือล่วงหน้า) */
  editable?: boolean;
  onMove?: (moves: Move[]) => void;
  onTap?: (id: string) => void;
  /** ซูมพอดีคนที่แสดงอยู่ (ตอนกรองตำแหน่ง) · focusKey เปลี่ยน = ซูมใหม่ */
  focus?: boolean;
  focusKey?: string;
  /** หัวภาพและชื่อไฟล์ของปุ่ม "บันทึกภาพ" */
  shot?: Shot & { file: string };
  /** ตัวกรองหรือปุ่มเพิ่มเติม แสดงเหนือแผนที่ */
  children?: ReactNode;
};

export function Warehouse3D({ mapKey, people = [], editable = false, onMove, onTap, focus = false, focusKey = "", shot, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);
  const cb = useRef({ onMove, onTap });
  /* หน้านี้แสดงแผนที่หลังโหลดข้อมูลในเบราว์เซอร์แล้วเท่านั้น จึงอ่านค่าจากเบราว์เซอร์ตอนเริ่มได้ */
  const [hidden, setHidden] = useState(readHidden);
  const [mode, setMode] = useState<ViewMode>("3d");
  const [locked, setLocked] = useState(true);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  const name = WAREHOUSE_MAPS[mapKey]?.name ?? mapKey;
  const editOn = editing && editable;

  useEffect(() => {
    cb.current = { onMove, onTap };
  }, [onMove, onTap]);

  /* สร้างแผนที่ครั้งเดียวเมื่อแสดง · ซ่อน/ออกจากหน้า = คืนหน่วยความจำการ์ดจอ */
  useEffect(() => {
    if (hidden || !box.current) return;
    let alive = true;
    const el = box.current;
    (async () => {
      try {
        const [{ createWarehouse3D }] = await Promise.all([import("@/lib/warehouse3d/scene"), document.fonts?.ready]);
        if (!alive) return;
        const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
        const e = createWarehouse3D(el, { mobile, font: getComputedStyle(document.body).fontFamily });
        e.onMove = (m) => cb.current.onMove?.(m);
        e.onTap = (id) => cb.current.onTap?.(id);
        eng.current = e;
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
      eng.current?.dispose();
      eng.current = null;
      setLocked(true);
    };
  }, [hidden]);

  /* เปลี่ยนคลัง → สร้างฉากคลังนั้น (มุมกล้องคงเดิม) */
  useEffect(() => {
    if (state !== "ready" || !eng.current) return;
    eng.current.view(mode);
    eng.current.show(mapKey);
    // mode ตั้งตอนกดปุ่มแล้ว ไม่ต้องสร้างฉากใหม่ทุกครั้งที่เปลี่ยนมุม
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, mapKey]);

  /* ตัวคนบนแผนที่ (หลังสร้างฉากคลังแล้ว) */
  useEffect(() => {
    if (state === "ready") eng.current?.setPeople(people);
  }, [state, mapKey, people]);

  useEffect(() => {
    if (state === "ready") eng.current?.setEditing(editOn);
  }, [state, editOn]);

  /* กรองตำแหน่ง → กล้องซูมเข้าหาคนกลุ่มนั้น (ป้ายใหญ่ ไม่ทับกัน พร้อมแคป) · ยกเลิกกรอง → กลับทั้งคลัง
     ไม่ซูมใหม่ตอนลากวาง (focusKey ไม่เปลี่ยน) */
  useEffect(() => {
    if (state === "ready") eng.current?.focus(focus);
  }, [state, mapKey, focus, focusKey]);

  async function saveImage() {
    if (!eng.current || !shot || saving) return;
    setSaving(true);
    try {
      const blob = await eng.current.snapshot(shot);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = shot.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } finally {
      setSaving(false);
    }
  }

  function toggleHidden() {
    const next = !hidden;
    if (!next) setState("loading");
    setHidden(next);
    try {
      window.localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      /* เก็บค่าไม่ได้ (โหมดส่วนตัว) ก็ไม่เป็นไร */
    }
  }

  const btn = (on: boolean) => `min-h-11 shrink-0 rounded-xl px-3 text-[15px] font-semibold ring-1 ${on ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line"}`;
  const hint = editOn
    ? touch
      ? "จัดตำแหน่ง: ใช้นิ้วลากตัวคนหรือป้ายชื่อ = ย้ายรายคน · ลากป้ายสี = ย้ายทั้งกลุ่ม · ระบบบันทึกให้ทันที"
      : "จัดตำแหน่ง: ลากตัวคนหรือป้ายชื่อ = ย้ายรายคน · ลากป้ายสี = ย้ายทั้งกลุ่ม · ระบบบันทึกให้ทันที"
    : locked
      ? "มุมกล้องล็อกอยู่ · กด “หมุน/ซูมได้” เพื่อขยับแผนที่ · เลือกตำแหน่งแล้วจะเห็นชื่อ+เวลาพักรายคน"
      : touch
        ? "นิ้วเดียวลาก = เลื่อน · สองนิ้ว = หมุน/ซูม"
        : "ลากซ้าย = เลื่อน · ลากขวา = หมุน · ล้อเมาส์ = ซูม";

  return (
    <section className="mb-4 overflow-hidden rounded-[20px] bg-white ring-1 ring-line">
      <div className="flex items-center gap-2 px-4 py-3">
        <Icon name="warehouse" size={24} className="shrink-0 text-brand" />
        <h2 className="min-w-0 flex-1 text-base leading-snug font-bold text-brand sm:text-lg">แผนที่คลัง 3D · {name}</h2>
        <button type="button" onClick={toggleHidden} className={btn(false)} aria-expanded={!hidden}>
          {hidden ? "แสดงแผนที่" : "ซ่อนแผนที่"}
        </button>
      </div>
      {!hidden && (
        <>
          {children && <div className="px-4 pb-3">{children}</div>}
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {VIEWS.map(([v, t]) => (
              <button
                key={v}
                type="button"
                aria-pressed={mode === v}
                className={btn(mode === v)}
                onClick={() => {
                  setMode(v);
                  eng.current?.view(v);
                }}
              >
                {t}
              </button>
            ))}
            <button type="button" aria-pressed={!locked} className={btn(!locked)} onClick={() => eng.current && setLocked(eng.current.lock(!locked))}>
              {locked ? "✎ หมุน/ซูมได้" : "🔒 ล็อกมุม"}
            </button>
            {editable && people.length > 0 && (
              <button type="button" aria-pressed={editOn} className={`${btn(editOn)} ${editOn ? "" : "!bg-[#fff4d6] !ring-[#f3c623]"}`} onClick={() => setEditing(!editing)}>
                {editOn ? "✓ จัดเสร็จแล้ว" : "✋ จัดตำแหน่ง"}
              </button>
            )}
            {shot && people.length > 0 && state === "ready" && (
              <button type="button" className={`${btn(false)} !bg-[#e8f6ee] !ring-[#1e8e5a]`} onClick={saveImage} disabled={saving}>
                {saving ? "กำลังบันทึก…" : "📷 บันทึกภาพ"}
              </button>
            )}
          </div>
          <div ref={box} className={`relative aspect-[4/3] bg-[#e9f0f7] sm:aspect-auto sm:h-[420px] lg:h-[540px] ${editOn ? "ring-4 ring-[#f3c623] ring-inset" : ""}`} onContextMenu={(e) => (!locked || editOn) && e.preventDefault()}>
            {state === "loading" && <p className="absolute inset-0 flex items-center justify-center text-muted">กำลังโหลดแผนที่ 3D…</p>}
            {state === "error" && <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-muted">เครื่องหรือเบราว์เซอร์นี้แสดงแผนที่ 3D ไม่ได้ (ต้องรองรับ WebGL) ลองเปิดด้วย Chrome</p>}
          </div>
          <p className="px-4 py-2 text-[13px] text-muted">
            {hint}
            {" · "}ผังโดยประมาณจากแบบ Layout คลัง
          </p>
        </>
      )}
    </section>
  );
}
