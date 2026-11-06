"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Loading, PageIntro, inputCls } from "@/components/ui";
import { errText, fetchAll, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { isGlobal, isManager, type HeadcountBudget } from "@/lib/types";

type Person = { position: string | null; warehouse_id: string | null; status: string; show_in_org_chart: boolean };
type OrgNode = { label: string; positions?: string[]; children?: OrgNode[] };

export default function OrganizationPage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const opts = useOptions(["position", "position_group", "org_hierarchy"]);
  const visible = isGlobal(me.role) ? warehouses : warehouses.filter((w) => myWarehouseIds.includes(w.id));
  const [wh, setWh] = useState(isGlobal(me.role) ? "" : (visible[0]?.id ?? ""));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [budgets, setBudgets] = useState<HeadcountBudget[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const canEdit = !!wh && isManager(me.role) && (isGlobal(me.role) || myWarehouseIds.includes(wh));

  const load = useCallback(async () => {
    if (demo) {
      setPeople(demo.previewEmployees());
      setBudgets(demo.PREVIEW_BUDGETS);
      return;
    }
    try {
      const [ps, bs] = await Promise.all([
        fetchAll<Person>((f, t) => sb().from("profiles").select("position, warehouse_id, status, show_in_org_chart").range(f, t)),
        fetchAll<HeadcountBudget>((f, t) => sb().from("headcount_budgets").select("*").range(f, t)),
      ]);
      setPeople(ps);
      setBudgets(bs);
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า
    load();
  }, [load]);

  const active = useMemo(() => (people ?? []).filter((p) => p.status === "active" && p.show_in_org_chart && (!wh || p.warehouse_id === wh)), [people, wh]);
  const actualOf = (pos: string) => active.filter((p) => p.position === pos).length;
  const budgetOf = (pos: string) => budgets.filter((b) => b.position === pos && (!wh || b.warehouse_id === wh)).reduce((s, b) => s + b.budget_count, 0);

  const positions = useMemo(() => {
    const set = new Set<string>();
    (opts.position ?? []).forEach((o) => o.is_active && set.add(o.value));
    budgets.filter((b) => !wh || b.warehouse_id === wh).forEach((b) => set.add(b.position));
    active.forEach((p) => p.position && set.add(p.position));
    return [...set];
  }, [opts.position, budgets, active, wh]);

  // จัดกลุ่มตามกลุ่มตำแหน่ง (ตั้งค่าตัวเลือก → กลุ่มตำแหน่ง)
  const groups = useMemo(() => {
    const out: { name: string; positions: string[] }[] = [];
    const used = new Set<string>();
    for (const g of opts.position_group ?? []) {
      const list = ((g.extra.positions as string[]) ?? []).filter((p) => positions.includes(p) && !used.has(p));
      list.forEach((p) => used.add(p));
      if (list.length) out.push({ name: g.label, positions: list });
    }
    const rest = positions.filter((p) => !used.has(p)).sort((a, b) => a.localeCompare(b, "th"));
    if (rest.length) out.push({ name: "ตำแหน่งอื่นๆ", positions: rest });
    return out;
  }, [opts.position_group, positions]);

  const totalBudget = positions.reduce((s, p) => s + budgetOf(p), 0);
  const totalActual = active.length;
  const short = positions.filter((p) => actualOf(p) < budgetOf(p));

  async function saveBudgets() {
    const changes = Object.entries(edit)
      .map(([position, v]) => ({ position, n: Number(v) }))
      .filter((c) => c.n !== budgetOf(c.position));
    if (changes.some((c) => !Number.isInteger(c.n) || c.n < 0)) return setMsg({ tone: "error", text: "อัตรากำลังต้องเป็นจำนวนเต็มตั้งแต่ 0" });
    setBusy(true);
    setMsg(null);
    try {
      if (!demo && changes.length) {
        const { error } = await sb()
          .from("headcount_budgets")
          .upsert(changes.map((c) => ({ warehouse_id: wh, position: c.position, budget_count: c.n })), { onConflict: "warehouse_id,position" });
        if (error) throw error;
        await load();
      }
      setEdit({});
      setMsg({ tone: "success", text: changes.length ? `บันทึกอัตรากำลัง ${changes.length} ตำแหน่งแล้ว` : "ไม่มีอะไรเปลี่ยน" });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const tree = (opts.org_hierarchy?.[0]?.extra?.hierarchy ?? null) as OrgNode | null;
  const bottom = (opts.org_hierarchy?.[0]?.extra?.bottomPositions ?? []) as OrgNode[];
  const editing = Object.keys(edit).length > 0;

  return (
    <AppShell title="ผังองค์กรและอัตรากำลัง" wide minRole="supervisor">
      <PageIntro title="ผังองค์กรและอัตรากำลัง">จำนวนพนักงานที่ทำงานอยู่จริง เทียบกับอัตรากำลังที่ตั้งไว้ของแต่ละคลัง</PageIntro>

      <Card className="mb-3">
        <label className="block max-w-sm">
          <span className="mb-1.5 block text-[15px] font-semibold">คลัง</span>
          <select className={inputCls} value={wh} onChange={(e) => { setWh(e.target.value); setEdit({}); }}>
            {isGlobal(me.role) && <option value="">ทุกคลัง (รวม)</option>}
            {visible.map((w) => (
              <option key={w.id} value={w.id}>{w.code} {w.name}</option>
            ))}
          </select>
        </label>
        {!wh && isManager(me.role) && <p className="mt-2 text-[14px] text-muted">เลือกคลังเพื่อแก้อัตรากำลัง</p>}
      </Card>

      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      {!people ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat label="อัตรากำลัง" value={totalBudget} />
            <Stat label="คนจริง" value={totalActual} />
            <Stat label="ตำแหน่งที่ขาดคน" value={short.length} tone={short.length ? "bad" : "ok"} />
          </div>

          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g.name} className="!p-0">
                <h2 className="border-b border-line px-4 py-2.5 font-bold text-brand">{g.name}</h2>
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 px-4 py-1 text-[14px] text-muted">
                  <span>ตำแหน่ง</span>
                  <span className="w-20 text-right">อัตรา</span>
                  <span className="w-12 text-right">จริง</span>
                  <span className="w-14 text-right">ขาด/เกิน</span>
                </div>
                <ul>
                  {g.positions.map((p) => {
                    const b = budgetOf(p);
                    const a = actualOf(p);
                    const d = a - b;
                    return (
                      <li key={p} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-t border-line px-4 py-2">
                        <span className="min-w-0 break-words font-semibold">{p}</span>
                        {canEdit ? (
                          <input
                            className={`${inputCls} !min-h-10 !w-20 text-right`}
                            inputMode="numeric"
                            value={edit[p] ?? String(b)}
                            onChange={(e) => setEdit((x) => ({ ...x, [p]: e.target.value.replace(/[^0-9]/g, "") }))}
                            aria-label={`อัตรากำลัง ${p}`}
                          />
                        ) : (
                          <span className="w-20 text-right">{b}</span>
                        )}
                        <span className="w-12 text-right">{a}</span>
                        <span className={`w-14 text-right font-bold ${d < 0 ? "text-bad" : d > 0 ? "text-[#8a5d0f]" : "text-ok"}`}>
                          {b === 0 && a === 0 ? "-" : d > 0 ? `+${d}` : d}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>

          {canEdit && editing && (
            <div className="sticky bottom-[72px] z-20 mt-4 flex gap-2 lg:bottom-4">
              <Button variant="secondary" className="flex-1 shadow-lg" onClick={() => setEdit({})} disabled={busy}>ยกเลิก</Button>
              <Button className="flex-[2] shadow-lg" onClick={saveBudgets} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึกอัตรากำลัง"}</Button>
            </div>
          )}

          {tree && (
            <Card className="mt-4">
              <h2 className="mb-3 text-lg font-bold text-brand">ผังองค์กร</h2>
              <OrgTree node={tree} count={actualOf} />
              {bottom.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  {bottom.map((n) => (
                    <span key={n.label} className="rounded-xl bg-paper px-3 py-2 text-[14px] ring-1 ring-line">
                      {n.label} <b>{(n.positions ?? []).reduce((s, p) => s + actualOf(p), 0)}</b>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[13px] text-muted">ผังนี้มาจากแอปเดิม การแก้โครงสร้างผังจะเพิ่มในรอบถัดไป</p>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function OrgTree({ node, count }: { node: OrgNode; count: (p: string) => number }) {
  const n = (node.positions ?? []).reduce((s, p) => s + count(p), 0);
  const kids = (node.children ?? []).filter((c) => c.label !== "ตำแหน่งใหม่" || (c.positions ?? []).length);
  return (
    <div>
      <div className="inline-flex items-center gap-2 rounded-xl bg-[#eaf0fb] px-3 py-2 text-[15px]">
        <span className="font-semibold text-brand">{node.label}</span>
        {(node.positions ?? []).length > 0 && <span className="rounded-lg bg-white px-2 text-[13px] font-bold">{n} คน</span>}
      </div>
      {kids.length > 0 && (
        <ul className="mt-2 space-y-2 border-l-2 border-line pl-4">
          {kids.map((c, i) => (
            <li key={`${c.label}-${i}`}>
              <OrgTree node={c} count={count} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-line">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`text-2xl font-bold ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : "text-brand"}`}>{value.toLocaleString("th-TH")}</div>
    </div>
  );
}
