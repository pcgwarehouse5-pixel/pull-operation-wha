"use client";

// ตารางกะแบบ Excel: ลากเลือก / Shift+คลิก / ลูกศร / พิมพ์เวลา / Ctrl+C Ctrl+X Ctrl+V (วางจาก Excel ได้) /
// ลากจุดมุมเพื่อเติม / ลากขอบเพื่อย้าย (Ctrl = คัดลอก) / Delete / Ctrl+Z Ctrl+Y / คลิกขวา
// กลุ่มตามตำแหน่ง: พับ/กาง และลากหัวกลุ่มเพื่อเรียงลำดับ · ลากจุด ⋮⋮ หน้าชื่อเพื่อเรียงคนในกลุ่ม (ใช้ได้ทั้งเมาส์และนิ้ว)
// บนจอสัมผัส: แตะช่องเพื่อเลือกกะจากรายการ (ลากคลุมช่วงชนกับการเลื่อนจอ)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { empName, type Emp } from "./common";
import { Icon } from "../Icon";
import { THAI_DAYS_SHORT, keyOf, weekday, type Cell, type Change, type Grid, type ShiftDef } from "@/lib/shifts";
import {
  OT_DAY_COLOR, autoHolidayWork, cellCopyText, cellLines, fillPlan, fromTsv, inRange, moveItem, moveTarget, norm, otDayKind, parseCellText, pastePlan, size, toTsv,
  type Pos, type Range,
} from "@/lib/shift-grid";

export type Group = { position: string; emps: Emp[] };

type Props = {
  groups: Group[];
  collapsed: Set<string>;
  onToggle: (position: string) => void;
  onReorder: (positions: string[]) => void;
  onReorderEmps?: (position: string, ids: string[]) => void; // ไม่ส่ง = เรียงรายชื่อไม่ได้ (ดูอย่างเดียว)
  dates: string[];
  grid: Grid;
  pending: Record<string, Cell | null>;
  defs: Map<string, ShiftDef>;
  activeDefs: ShiftDef[];
  holidayMap: Map<string, string>;
  brush: { code: string | null; holiday_work: Cell["holiday_work"] } | null;
  onChanges: (c: Change[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenCell: (e: Emp, date: string) => void;
  onMessage: (tone: "error" | "warning" | "success", text: string) => void;
};

type Drag = { kind: "select" } | { kind: "fill"; to: Pos } | { kind: "move"; grab: Pos; to: Pos; copy: boolean } | null;
type Rect = { left: number; top: number; width: number; height: number };
const noGroup = "ไม่ระบุตำแหน่ง";

export function ExcelGrid(p: Props) {
  const { groups, collapsed, dates, grid, pending, defs, holidayMap } = p;
  const scroller = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const clip = useRef<{ tsv: string; cells: (Cell | null)[][] } | null>(null);
  const lastPointer = useRef<string>("mouse");

  // แถวที่มองเห็น (ไม่รวมกลุ่มที่พับ) — ตำแหน่งแถวในตารางใช้ลำดับนี้
  const rows = useMemo(() => groups.flatMap((g) => (collapsed.has(g.position) ? [] : g.emps)), [groups, collapsed]);
  const R = rows.length;
  const C = dates.length;

  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [drag, setDrag] = useState<Drag>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [empDrag, setEmpDrag] = useState<{ group: string; id: string; over: string } | null>(null);
  const sel = useMemo(() => norm(anchor, focus), [anchor, focus]);

  const clamp = useCallback((q: Pos): Pos => ({ r: Math.max(0, Math.min(R - 1, q.r)), c: Math.max(0, Math.min(C - 1, q.c)) }), [R, C]);
  const cellAt = useCallback((r: number, c: number) => grid[rows[r]?.id]?.[dates[c]], [grid, rows, dates]);

  // ช่วงที่เลือกต้องอยู่ในตารางเสมอ (เช่น หลังพับกลุ่ม)
  useEffect(() => {
    if (!R) return;
    if (anchor.r >= R || focus.r >= R) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- จำนวนแถวเปลี่ยนเมื่อพับกลุ่ม
      setAnchor(clamp(anchor));
      setFocus(clamp(focus));
    }
  }, [R, anchor, focus, clamp]);

  // ---------- เปลี่ยนค่าในช่อง ----------
  const commit = useCallback(
    (list: [number, number, Cell | null][]) => {
      // เปลี่ยนเป็นกะทำงานในวันหยุด (OFF แดง / วันหยุดประจำปี) → ติดธง "ทำงานวันหยุด" ให้เอง = ได้ OT
      const changes: Change[] = list
        .filter(([r, c]) => rows[r] && dates[c])
        .map(([r, c, cell]) => ({
          user_id: rows[r].id,
          work_date: dates[c],
          cell: autoHolidayWork(grid[rows[r].id]?.[dates[c]], cell, defs, holidayMap.has(dates[c])),
        }));
      if (changes.length) p.onChanges(changes);
    },
    [rows, dates, p, grid, defs, holidayMap],
  );

  const forRange = (g: Range, f: (r: number, c: number) => Cell | null): [number, number, Cell | null][] => {
    const out: [number, number, Cell | null][] = [];
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) out.push([r, c, f(r, c)]);
    return out;
  };

  const clearSel = () => commit(forRange(sel, () => null));
  const fillSel = (code: string) => {
    const d = defs.get(code);
    commit(forRange(sel, () => ({ shift_code: code, holiday_work: null, is_volunteer: false })));
    if (d) p.onMessage("success", `ใส่ ${d.working ? `${d.label}` : d.label} แล้ว ${size(sel).h * size(sel).w} ช่อง`);
  };

  const copyMatrix = () => {
    const cells: (Cell | null)[][] = [];
    const text: string[][] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const cr: (Cell | null)[] = [];
      const tr: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) {
        const cell = cellAt(r, c);
        cr.push(cell ?? null);
        tr.push(cellCopyText(cell, cell ? defs.get(cell.shift_code) : undefined));
      }
      cells.push(cr);
      text.push(tr);
    }
    const tsv = toTsv(text);
    clip.current = { tsv, cells };
    return tsv;
  };

  const pasteText = (text: string) => {
    let data: (Cell | null)[][];
    if (clip.current && text.replace(/\r\n?/g, "\n").trim() === clip.current.tsv.replace(/\r\n?/g, "\n").trim()) {
      data = clip.current.cells;
    } else {
      const errors: string[] = [];
      data = fromTsv(text).map((row) =>
        row.map((t) => {
          const res = parseCellText(t, p.activeDefs);
          if (!res.ok) {
            errors.push(res.error);
            return undefined as unknown as Cell | null;
          }
          return res.cell;
        }),
      );
      if (errors.length) p.onMessage("warning", `${errors[0]}${errors.length > 1 ? ` (และอีก ${errors.length - 1} ช่อง)` : ""} · ช่องที่อ่านไม่ได้ถูกข้าม`);
    }
    const plan = pastePlan(data, sel, R, C).filter(([, , v]) => v !== undefined);
    commit(plan);
    if (plan.length) {
      const last = plan[plan.length - 1];
      setFocus({ r: Math.max(sel.r1, last[0]), c: Math.max(sel.c1, last[1]) });
    }
  };

  // ---------- เมาส์ ----------
  // หาช่องจากองค์ประกอบใต้เมาส์ (ไม่โดนคอลัมน์ชื่อที่ติดซ้ายบังจุดคำนวณ)
  const posFromEvent = (e: { target: EventTarget | null; clientX: number; clientY: number }): Pos | null => {
    const t = e.target instanceof Element ? e.target : null;
    const el = (t?.closest("[data-r]") ?? document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-r]")) as HTMLElement | null;
    if (!el) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const q = posFromEvent(e);
      // เลื่อนจออัตโนมัติเมื่อลากชิดขอบ
      const s = scroller.current;
      if (s) {
        const b = s.getBoundingClientRect();
        if (e.clientX > b.right - 30) s.scrollLeft += 18;
        else if (e.clientX < b.left + 190) s.scrollLeft -= 18;
        if (e.clientY > b.bottom - 30) s.scrollTop += 18;
        else if (e.clientY < b.top + 50) s.scrollTop -= 18;
      }
      if (!q) return;
      if (drag.kind === "select") setFocus(q);
      else if (drag.kind === "fill") setDrag({ ...drag, to: q });
      else setDrag({ ...drag, to: q, copy: e.ctrlKey || e.metaKey });
    };
    const up = () => {
      if (drag.kind === "fill") {
        const { area, from } = fillPlan(sel, drag.to);
        if (area) {
          commit(forRange(area, (r, c) => {
            const f = from(r, c);
            return cellAt(f.r, f.c) ?? null;
          }));
          setAnchor({ r: Math.min(sel.r0, area.r0), c: Math.min(sel.c0, area.c0) });
          setFocus({ r: Math.max(sel.r1, area.r1), c: Math.max(sel.c1, area.c1) });
        }
      } else if (drag.kind === "move") {
        const t = moveTarget(sel, drag.to.r - drag.grab.r, drag.to.c - drag.grab.c, R, C);
        if (t.r0 !== sel.r0 || t.c0 !== sel.c0) {
          const list: [number, number, Cell | null][] = [];
          if (!drag.copy) for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) if (!inRange(t, r, c)) list.push([r, c, null]);
          list.push(...forRange(t, (r, c) => cellAt(sel.r0 + (r - t.r0), sel.c0 + (c - t.c0)) ?? null));
          commit(list);
          setAnchor({ r: t.r0, c: t.c0 });
          setFocus({ r: t.r1, c: t.c1 });
        }
      } else if (drag.kind === "select" && p.brush) {
        // เลือกกะไว้ (โหมดทาสี) + ลากคลุม = ใส่กะทั้งช่วง
        const b = p.brush;
        commit(forRange(sel, () => (b.code ? { shift_code: b.code, holiday_work: defs.get(b.code)?.working ? b.holiday_work : null, is_volunteer: false } : null)));
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ใช้ค่าล่าสุดของ sel/commit ตอนปล่อยเมาส์
  }, [drag, sel]);

  function onCellPointerDown(e: React.PointerEvent) {
    lastPointer.current = e.pointerType;
    const q = posFromEvent(e);
    if (!q || e.button === 2) return;
    if (e.pointerType === "touch") return; // จอสัมผัส: ใช้การแตะ (click)
    e.preventDefault();
    setMenu(null);
    if (editing) finishEdit(true);
    scroller.current?.focus({ preventScroll: true });
    if (e.shiftKey) setFocus(q);
    else {
      setAnchor(q);
      setFocus(q);
    }
    setDrag({ kind: "select" });
  }

  function onCellClick(e: React.MouseEvent) {
    if (lastPointer.current !== "touch") return;
    const q = posFromEvent(e);
    if (!q) return;
    setAnchor(q);
    setFocus(q);
    if (p.brush) {
      const b = p.brush;
      commit([[q.r, q.c, b.code ? { shift_code: b.code, holiday_work: defs.get(b.code)?.working ? b.holiday_work : null, is_volunteer: false } : null]]);
    } else p.onOpenCell(rows[q.r], dates[q.c]);
  }

  function onCellDoubleClick(e: React.MouseEvent) {
    const q = posFromEvent(e);
    if (q) p.onOpenCell(rows[q.r], dates[q.c]);
  }

  function onContext(e: React.MouseEvent) {
    const q = posFromEvent(e);
    if (!q) return;
    e.preventDefault();
    if (!inRange(sel, q.r, q.c)) {
      setAnchor(q);
      setFocus(q);
    }
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 360) });
  }

  // ---------- คีย์บอร์ด ----------
  function startEdit(text?: string) {
    const cell = cellAt(focus.r, focus.c);
    setEditing({ r: focus.r, c: focus.c, text: text ?? cellCopyText(cell, cell ? defs.get(cell.shift_code) : undefined) });
  }

  function finishEdit(save: boolean, move?: "down" | "right" | "left") {
    if (!editing) return;
    const ed = editing;
    setEditing(null);
    if (save) {
      const res = parseCellText(ed.text, p.activeDefs);
      if (!res.ok) p.onMessage("error", res.error);
      else commit([[ed.r, ed.c, res.cell]]);
    }
    if (move) {
      const q = clamp({ r: ed.r + (move === "down" ? 1 : 0), c: ed.c + (move === "right" ? 1 : move === "left" ? -1 : 0) });
      setAnchor(q);
      setFocus(q);
    }
    scroller.current?.focus({ preventScroll: true });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing || !R) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const go = (dr: number, dc: number) => {
      e.preventDefault();
      const q = clamp({ r: focus.r + dr, c: focus.c + dc });
      setFocus(q);
      if (!e.shiftKey) setAnchor(q);
    };
    if (k === "ArrowDown") return go(1, 0);
    if (k === "ArrowUp") return go(-1, 0);
    if (k === "ArrowRight") return go(0, 1);
    if (k === "ArrowLeft") return go(0, -1);
    if (k === "Tab") return go(0, e.shiftKey ? -1 : 1);
    if (k === "Enter") {
      e.preventDefault();
      return go(e.shiftKey ? -1 : 1, 0);
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      return clearSel();
    }
    if (k === "Escape") {
      setMenu(null);
      return setAnchor(focus);
    }
    if (k === "F2") {
      e.preventDefault();
      return startEdit();
    }
    if (ctrl && (k === "z" || k === "Z")) {
      e.preventDefault();
      return e.shiftKey ? p.onRedo() : p.onUndo();
    }
    if (ctrl && (k === "y" || k === "Y")) {
      e.preventDefault();
      return p.onRedo();
    }
    if (ctrl && (k === "a" || k === "A")) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      return setFocus({ r: R - 1, c: C - 1 });
    }
    if (!ctrl && !e.altKey && k.length === 1) {
      e.preventDefault();
      startEdit(k);
    }
  }

  // คัดลอก/ตัด/วาง ผ่านคลิปบอร์ดของระบบ (ใช้กับ Excel ได้)
  function onCopy(e: React.ClipboardEvent) {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copyMatrix());
    p.onMessage("success", `คัดลอก ${size(sel).h * size(sel).w} ช่องแล้ว กด Ctrl+V เพื่อวาง (วางใน Excel ได้)`);
  }
  function onCut(e: React.ClipboardEvent) {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copyMatrix());
    clearSel();
  }
  function onPaste(e: React.ClipboardEvent) {
    if (editing) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData("text/plain"));
  }

  async function menuCopy(cut: boolean) {
    const tsv = copyMatrix();
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {}
    if (cut) clearSel();
    setMenu(null);
  }
  async function menuPaste() {
    setMenu(null);
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      if (clip.current) pasteText(clip.current.tsv);
      else p.onMessage("warning", "เบราว์เซอร์ไม่ให้อ่านคลิปบอร์ด กด Ctrl+V แทน");
    }
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  // ช่องที่เลือกอยู่ต้องมองเห็นเสมอ
  useEffect(() => {
    const el = wrap.current?.querySelector(`[data-r="${focus.r}"][data-c="${focus.c}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);

  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);

  // ---------- กรอบที่เลือก (วาดทับตาราง) ----------
  const [boxes, setBoxes] = useState<{ sel?: Rect; ghost?: Rect; cell?: Rect }>({});
  const rectOf = useCallback((g: Range): Rect | undefined => {
    const w = wrap.current;
    const a = w?.querySelector(`[data-r="${g.r0}"][data-c="${g.c0}"]`) as HTMLElement | null;
    const b = w?.querySelector(`[data-r="${g.r1}"][data-c="${g.c1}"]`) as HTMLElement | null;
    if (!w || !a || !b) return undefined;
    const base = w.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return { left: ra.left - base.left, top: ra.top - base.top, width: rb.right - ra.left, height: rb.bottom - ra.top };
  }, []);

  useLayoutEffect(() => {
    if (!R) return;
    let ghost: Rect | undefined;
    if (drag?.kind === "fill") {
      const { area } = fillPlan(sel, drag.to);
      ghost = area ? rectOf(area) : undefined;
    } else if (drag?.kind === "move") {
      ghost = rectOf(moveTarget(sel, drag.to.r - drag.grab.r, drag.to.c - drag.grab.c, R, C));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ตำแหน่งกรอบอ่านจากตารางที่วาดแล้ว
    setBoxes({ sel: rectOf(sel), ghost, cell: editing ? rectOf({ r0: editing.r, c0: editing.c, r1: editing.r, c1: editing.c }) : undefined });
  }, [sel, drag, editing, rectOf, R, C, rows, grid]);

  // ---------- หัวกลุ่ม: ลากเรียงลำดับ ----------
  const order = groups.map((g) => g.position);
  const moveGroup = (from: string, to: string) => {
    if (from === to) return;
    const list = order.filter((x) => x !== from);
    list.splice(list.indexOf(to), 0, from);
    p.onReorder(list);
  };
  const shiftGroup = (pos: string, d: -1 | 1) => {
    const i = order.indexOf(pos);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const list = [...order];
    [list[i], list[j]] = [list[j], list[i]];
    p.onReorder(list);
  };

  // ---------- รายชื่อในกลุ่ม: ลากจุด ⋮⋮ ขึ้น/ลง (pointer events จึงใช้ได้ทั้งเมาส์และจอสัมผัส) ----------
  const groupIds = (pos: string) => groups.find((g) => g.position === pos)?.emps.map((e) => e.id) ?? [];
  const dropEmp = (group: string, id: string, over: string) => {
    const ids = groupIds(group);
    const next = moveItem(ids, id, over);
    if (next !== ids) p.onReorderEmps?.(group, next);
  };
  const empHandle = (g: Group, e: Emp) => (
    <span
      role="button"
      tabIndex={0}
      className="-ml-1 flex w-6 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded text-[15px] font-bold text-ink/45 select-none hover:bg-sky active:cursor-grabbing"
      title="ลากขึ้น/ลงเพื่อเรียงลำดับ (หรือกดปุ่มลูกศรขึ้น/ลง)"
      aria-label={`เลื่อนลำดับ ${empName(e)} (ลูกศรขึ้น/ลง)`}
      onPointerDown={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        setEmpDrag({ group: g.position, id: e.id, over: e.id });
      }}
      onPointerMove={(ev) => {
        if (!empDrag) return;
        // เลื่อนจออัตโนมัติเมื่อลากใกล้ขอบบน/ล่าง
        if (ev.clientY < 90) window.scrollBy(0, -12);
        else if (ev.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("tr[data-emp]");
        if (row && row.dataset.group === empDrag.group && row.dataset.emp !== empDrag.over) setEmpDrag({ ...empDrag, over: row.dataset.emp! });
      }}
      onPointerUp={() => {
        if (empDrag) dropEmp(empDrag.group, empDrag.id, empDrag.over);
        setEmpDrag(null);
      }}
      onPointerCancel={() => setEmpDrag(null)}
      onKeyDown={(ev) => {
        if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
        ev.preventDefault();
        ev.stopPropagation();
        const ids = groupIds(g.position);
        const over = ids[ids.indexOf(e.id) + (ev.key === "ArrowUp" ? -1 : 1)];
        if (over) dropEmp(g.position, e.id, over);
      }}
    >
      ⋮⋮
    </span>
  );

  // ---------- ตัวตาราง (ไม่ขึ้นกับการเลือก จึงไม่วาดใหม่ตอนลากเมาส์) ----------
  const working = (emps: Emp[], d: string) => emps.filter((e) => defs.get(grid[e.id]?.[d]?.shift_code ?? "")?.working).length;
  const body = useMemo(() => {
    let r = -1;
    const out: ReactNode[] = [];
    for (const g of groups) {
      const closed = collapsed.has(g.position);
      out.push(
        <tr key={`g-${g.position}`} className={dragGroup && dragGroup !== g.position ? "[&>th]:bg-sky" : ""}>
          <th
            scope="rowgroup"
            className="sticky left-0 z-10 border-y border-r border-line bg-[#eef2fa] px-1.5 py-1 text-left"
            draggable
            onDragStart={(e) => {
              setDragGroup(g.position);
              e.dataTransfer.setData("text/x-group", g.position);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDragGroup(null)}
            onDragOver={(e) => e.dataTransfer.types.includes("text/x-group") && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/x-group");
              if (from) moveGroup(from, g.position);
              setDragGroup(null);
            }}
          >
            <span className="flex items-center gap-1">
              <span className="cursor-grab px-0.5 text-muted select-none active:cursor-grabbing" title="ลากเพื่อเรียงลำดับกลุ่ม" aria-hidden="true">⋮⋮</span>
              <button type="button" onClick={() => p.onToggle(g.position)} className="flex min-w-0 flex-1 items-center gap-1 rounded text-left" aria-expanded={!closed}>
                <span className={`inline-block text-[10px] text-muted transition ${closed ? "" : "rotate-90"}`} aria-hidden="true">▶</span>
                <span className="truncate text-[13px] font-bold text-brand">{g.position || noGroup}</span>
                <span className="text-[12px] font-semibold text-muted">({g.emps.length})</span>
              </button>
              <button type="button" className="rounded px-0.5 text-[11px] text-muted hover:bg-white" onClick={() => shiftGroup(g.position, -1)} aria-label={`เลื่อนกลุ่ม ${g.position} ขึ้น`}>▲</button>
              <button type="button" className="rounded px-0.5 text-[11px] text-muted hover:bg-white" onClick={() => shiftGroup(g.position, 1)} aria-label={`เลื่อนกลุ่ม ${g.position} ลง`}>▼</button>
            </span>
          </th>
          {dates.map((d) => (
            <td key={d} className="border-y border-line bg-[#eef2fa] text-center text-[11px] font-semibold text-muted" title="คนทำงานในกลุ่มนี้">
              {working(g.emps, d) || ""}
            </td>
          ))}
          <td className="border-y border-l border-line bg-[#eef2fa]" />
        </tr>,
      );
      if (closed) continue;
      const ids = g.emps.map((e) => e.id);
      for (const e of g.emps) {
        r++;
        const row = grid[e.id] ?? {};
        const workDays = dates.filter((d) => defs.get(row[d]?.shift_code ?? "")?.working).length;
        // เส้นบอกตำแหน่งที่จะวาง: ลากลง = ใต้แถว · ลากขึ้น = เหนือแถว
        const isOver = empDrag && empDrag.group === g.position && empDrag.over === e.id && empDrag.over !== empDrag.id;
        const dropLine = isOver
          ? ids.indexOf(empDrag.id) < ids.indexOf(e.id)
            ? "[&>*]:shadow-[inset_0_-3px_0_var(--color-brand)]"
            : "[&>*]:shadow-[inset_0_3px_0_var(--color-brand)]"
          : "";
        out.push(
          <tr key={e.id} data-emp={e.id} data-group={g.position} className={`${dropLine} ${empDrag?.id === e.id ? "opacity-50" : ""}`}>
            <th scope="row" className={`sticky left-0 z-10 max-w-36 border-b border-r border-line bg-white py-0.5 text-left font-normal sm:max-w-48 ${p.onReorderEmps ? "pr-2 pl-1" : "px-2"}`}>
              <span className="flex items-stretch gap-1">
              {p.onReorderEmps && empHandle(g, e)}
              <button
                type="button"
                className="block min-w-0 flex-1 text-left"
                onClick={() => {
                  const rr = rows.indexOf(e);
                  setAnchor({ r: rr, c: 0 });
                  setFocus({ r: rr, c: C - 1 });
                  scroller.current?.focus({ preventScroll: true });
                }}
                title="คลิกเพื่อเลือกทั้งแถว"
              >
                <span className="block truncate text-[13px] font-semibold">{empName(e)}</span>
                <span className="block truncate text-[11px] text-muted">
                  {e.employee_code}
                  {e.status === "resigned" ? " · ลาออก" : ""}
                </span>
              </button>
              </span>
            </th>
            {dates.map((d, c) => {
              const cell = row[d];
              const def = cell ? defs.get(cell.shift_code) : undefined;
              const lines = cellLines(cell, def);
              const otDay = otDayKind(cell, def, holidayMap.has(d)); // มาทำงานวันหยุด = สีทั้งช่อง (แดง/ม่วง)
              const color = otDay ? OT_DAY_COLOR[otDay] : { bg: def?.bg ?? "#94a3b8", text: def?.text ?? "#fff" };
              const changed = keyOf(e.id, d) in pending;
              return (
                <td key={d} data-r={r} data-c={c} className="h-[42px] min-w-[52px] border-r border-b border-line/70 p-[2px]">
                  <div
                    className={`relative flex h-full w-full flex-col items-center justify-center rounded-[5px] text-[11px] leading-[1.15] font-semibold ${cell ? "" : "text-transparent"} ${changed ? "outline-2 -outline-offset-2 outline-ink outline-dashed" : ""}`}
                    style={cell ? { background: color.bg, color: color.text } : undefined}
                    title={otDay === "HOL" ? `ทำงานวันหยุดประจำปี${holidayMap.get(d) ? ` (${holidayMap.get(d)})` : ""} · ได้ OT` : otDay === "OFF" ? "ทำงานวันหยุดประจำสัปดาห์ (OFF) · ได้ OT" : def?.noOt ? "วันหยุดที่บริษัทให้พิเศษ · มาทำงานไม่ได้ OT" : undefined}
                  >
                    {lines ? (
                      <>
                        <span className="num">{lines[0]}</span>
                        {lines[1] && <span className="num opacity-90">{lines[1]}</span>}
                      </>
                    ) : (
                      "·"
                    )}
                  </div>
                </td>
              );
            })}
            <td className="border-b border-l border-line text-center text-[13px] font-semibold">{workDays}</td>
          </tr>,
        );
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- วาดใหม่เมื่อข้อมูล/กลุ่มเปลี่ยนเท่านั้น
  }, [groups, collapsed, grid, pending, defs, dates, rows, dragGroup, empDrag, p.onReorderEmps, holidayMap]);

  const allEmps = useMemo(() => groups.flatMap((g) => g.emps), [groups]);
  const S = boxes.sel;

  return (
    <div
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      className="relative max-h-[72vh] overflow-auto rounded-[20px] bg-white ring-1 ring-line outline-none select-none focus-visible:ring-2 focus-visible:ring-brand"
      aria-label="ตารางกะ (ใช้แป้นลูกศร พิมพ์เวลา Ctrl+C Ctrl+V ได้เหมือน Excel)"
    >
      <div ref={wrap} className="relative inline-block min-w-full align-top">
        <table className="border-separate border-spacing-0 text-[13px]" onPointerDown={onCellPointerDown} onClick={onCellClick} onDoubleClick={onCellDoubleClick} onContextMenu={onContext}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 min-w-36 border-r border-b border-line bg-white px-2 py-1.5 text-left font-semibold sm:min-w-48">
                พนักงาน ({allEmps.length})
              </th>
              {dates.map((d, c) => {
                const wd = weekday(d);
                const hol = holidayMap.get(d);
                const on = c >= sel.c0 && c <= sel.c1;
                return (
                  <th
                    key={d}
                    title={hol ?? "คลิกเพื่อเลือกทั้งวัน"}
                    onClick={() => {
                      if (!R) return;
                      setAnchor({ r: 0, c });
                      setFocus({ r: R - 1, c });
                      scroller.current?.focus({ preventScroll: true });
                    }}
                    className={`sticky top-0 z-20 cursor-pointer border-b border-line px-0.5 py-1 text-center font-semibold ${on ? "!bg-sky text-brand" : ""} ${hol ? "bg-[#7c3aed] text-white" : wd === 0 || wd === 6 ? "bg-[#eef2fa]" : "bg-white"}`}
                  >
                    <span className="block text-[14px] leading-tight">{Number(d.slice(8))}</span>
                    <span className="block text-[11px] font-normal">{hol ? "วันหยุด" : THAI_DAYS_SHORT[wd]}</span>
                  </th>
                );
              })}
              <th className="sticky top-0 z-20 min-w-14 border-b border-l border-line bg-white px-1 text-center text-[12px] font-semibold">วันทำงาน</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
          <tfoot>
            <tr>
              <th className="sticky bottom-0 left-0 z-30 border-t border-r border-line bg-[#f6f8fc] px-2 py-1.5 text-left text-[12px] font-semibold">คนทำงาน/วัน</th>
              {dates.map((d) => (
                <td key={d} className="sticky bottom-0 z-20 border-t border-line bg-[#f6f8fc] text-center font-bold text-brand">{working(allEmps, d)}</td>
              ))}
              <td className="sticky bottom-0 z-20 border-t border-l border-line bg-[#f6f8fc]" />
            </tr>
          </tfoot>
        </table>

        {/* กรอบที่เลือก: ขอบลากย้าย + จุดมุมลากเติม */}
        {S && R > 0 && (
          <div className="pointer-events-none absolute z-[5] rounded-[3px] border-2 border-brand bg-brand/10" style={S}>
            {(["top", "bottom", "left", "right"] as const).map((side) => (
              <span
                key={side}
                className="pointer-events-auto absolute cursor-move"
                style={
                  side === "top" ? { left: 0, right: 0, top: -5, height: 7 }
                  : side === "bottom" ? { left: 0, right: 10, bottom: -5, height: 7 }
                  : side === "left" ? { top: 0, bottom: 0, left: -5, width: 7 }
                  : { top: 0, bottom: 10, right: -5, width: 7 }
                }
                title="ลากเพื่อย้าย (กด Ctrl ค้าง = คัดลอก)"
                onPointerDown={(e) => {
                  if (e.pointerType === "touch") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const grab = posFromEvent(e) ?? { r: sel.r0, c: sel.c0 };
                  setDrag({ kind: "move", grab: clamp(grab), to: clamp(grab), copy: e.ctrlKey || e.metaKey });
                }}
              />
            ))}
            <span
              className="pointer-events-auto absolute -right-[5px] -bottom-[5px] h-[10px] w-[10px] cursor-crosshair border-2 border-white bg-brand"
              title="ลากเพื่อเติม (ซ้ำรูปแบบ)"
              onPointerDown={(e) => {
                if (e.pointerType === "touch") return;
                e.preventDefault();
                e.stopPropagation();
                setDrag({ kind: "fill", to: { r: sel.r1, c: sel.c1 } });
              }}
            />
          </div>
        )}
        {boxes.ghost && (
          <div className={`pointer-events-none absolute z-[6] rounded-[3px] border-2 border-dashed ${drag?.kind === "move" ? "border-ink bg-ink/5" : "border-brand"}`} style={boxes.ghost} />
        )}

        {/* ช่องพิมพ์แก้ */}
        {editing && boxes.cell && (
          <input
            ref={editor}
            list="shift-input-options"
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finishEdit(true, "down");
              } else if (e.key === "Tab") {
                e.preventDefault();
                finishEdit(true, e.shiftKey ? "left" : "right");
              } else if (e.key === "Escape") {
                e.preventDefault();
                finishEdit(false);
              }
            }}
            onBlur={() => finishEdit(true)}
            className="absolute z-[8] rounded-[4px] border-2 border-brand bg-white px-1 text-[13px] font-semibold text-ink shadow-lg outline-none"
            style={{ left: boxes.cell.left - 2, top: boxes.cell.top - 2, width: Math.max(150, boxes.cell.width + 4), height: boxes.cell.height + 4 }}
            aria-label="พิมพ์เวลา เช่น 8-17 หรือรหัสกะ แล้วกด Enter"
          />
        )}
        <datalist id="shift-input-options">
          {p.activeDefs.map((d) => (
            <option key={d.code} value={cellCopyText({ shift_code: d.code, holiday_work: null, is_volunteer: false }, d)}>
              {d.code}
            </option>
          ))}
        </datalist>
      </div>

      {/* เมนูคลิกขวา */}
      {menu && (
        <div
          className="fixed z-50 w-56 overflow-hidden rounded-2xl bg-white py-1 text-[14px] shadow-[0_10px_30px_rgba(17,28,65,0.22)] ring-1 ring-line"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        >
          <MenuItem onClick={() => menuCopy(false)} keys="Ctrl+C">คัดลอก</MenuItem>
          <MenuItem onClick={() => menuCopy(true)} keys="Ctrl+X">ตัด</MenuItem>
          <MenuItem onClick={menuPaste} keys="Ctrl+V">วาง</MenuItem>
          <MenuItem
            onClick={() => {
              clearSel();
              setMenu(null);
            }}
            keys="Delete"
          >
            ลบกะ
          </MenuItem>
          {sel.r0 === sel.r1 && sel.c0 === sel.c1 && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                p.onOpenCell(rows[sel.r0], dates[sel.c0]);
              }}
            >
              เลือกจากรายการ / ทำงานวันหยุด
            </MenuItem>
          )}
          <p className="mt-1 border-t border-line px-3 pt-1.5 pb-1 text-[12px] font-semibold text-muted">ใส่กะในช่องที่เลือก</p>
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto px-2 pb-2">
            {p.activeDefs.map((d) => (
              <button
                key={d.code}
                type="button"
                className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold"
                style={{ background: d.bg, color: d.text }}
                onClick={() => {
                  fillSel(d.code);
                  setMenu(null);
                }}
                title={d.code}
              >
                {d.working && d.start !== null && d.end !== null ? cellLines({ shift_code: d.code, holiday_work: null, is_volunteer: false }, d)!.join("-") : d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, keys }: { children: ReactNode; onClick: () => void; keys?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-sky">
      <span>{children}</span>
      {keys && <span className="text-[12px] text-muted">{keys}</span>}
    </button>
  );
}

/** แถบช่วยจำปุ่มลัด (จอคอม) */
export function GridHelp() {
  const items: [string, string][] = [
    ["ลากเมาส์ / Shift+คลิก", "เลือกหลายช่อง"],
    ["พิมพ์ 8-17 แล้ว Enter", "ใส่กะตามเวลา"],
    ["Ctrl+C / Ctrl+V", "คัดลอก-วาง (กับ Excel ได้)"],
    ["ลากจุดมุมขวาล่าง", "เติมซ้ำรูปแบบ"],
    ["ลากขอบกรอบ", "ย้าย (Ctrl = คัดลอก)"],
    ["Delete", "ลบ"],
    ["Ctrl+Z", "ย้อนกลับ"],
    ["ดับเบิลคลิก / คลิกขวา", "เลือกจากรายการ"],
  ];
  return (
    <div className="mt-2 hidden flex-wrap gap-x-4 gap-y-1 px-1 text-[12.5px] text-muted lg:flex">
      <Icon name="tool" size={15} className="mt-0.5" />
      {items.map(([k, v]) => (
        <span key={k}>
          <kbd className="rounded bg-white px-1 font-sans font-semibold text-ink ring-1 ring-line">{k}</kbd> {v}
        </span>
      ))}
    </div>
  );
}
