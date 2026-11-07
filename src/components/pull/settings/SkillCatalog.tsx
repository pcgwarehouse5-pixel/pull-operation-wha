"use client";

// ขั้นที่ 1 ตั้งค่าทักษะ (Skill Catalogue): เลือกทักษะที่คลังนี้ดึงคนได้ + ตารางคลัง × ทักษะ
import { useMemo, useState } from "react";
import { Card, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SkillIcon, Toggle } from "@/components/pull/PullUI";
import { SaveBar } from "@/components/pull/SaveBar";
import type { PullConfig } from "@/lib/pull";
import type { Warehouse } from "@/lib/types";

export function SkillCatalog({
  cfg,
  wh,
  warehouses,
  canEdit,
  onSave,
}: {
  cfg: PullConfig;
  wh: string;
  warehouses: Warehouse[];
  canEdit: boolean;
  onSave: (skills: string[]) => Promise<boolean>;
}) {
  const saved = useMemo(
    () => cfg.pullSkills.filter((s) => s.warehouse_id === wh).sort((a, b) => a.sort_order - b.sort_order).map((s) => s.skill_name),
    [cfg, wh],
  );
  const [picked, setPicked] = useState<string[]>(saved);
  const [q, setQ] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const on = new Set(picked);
  const added = picked.filter((s) => !saved.includes(s));
  const removed = saved.filter((s) => !on.has(s));
  const dirty = added.length + removed.length > 0;
  const count = (w: string, s: string) => cfg.counts.find((c) => c.warehouse_id === w && c.skill_name === s)?.people ?? 0;
  const total = (s: string) => cfg.counts.filter((c) => c.skill_name === s).reduce((n, c) => n + c.people, 0);

  const shown = cfg.skillNames.filter((s) => (!onlyOn || on.has(s)) && s.toLowerCase().includes(q.trim().toLowerCase()));
  // เปิดแล้วขึ้นก่อน (ตามลำดับที่ตั้ง) แล้วตามด้วยที่เหลือตามตัวอักษร
  shown.sort((a, b) => (on.has(a) === on.has(b) ? (on.has(a) ? picked.indexOf(a) - picked.indexOf(b) : a.localeCompare(b, "th")) : on.has(a) ? -1 : 1));

  const matrixSkills = [...new Set([...cfg.pullSkills.map((s) => s.skill_name), ...picked])].sort((a, b) => a.localeCompare(b, "th"));
  const pulledBy = (w: string, s: string) => (w === wh ? on.has(s) : cfg.pullSkills.some((p) => p.warehouse_id === w && p.skill_name === s));

  async function save() {
    setBusy(true);
    await onSave(picked);
    setBusy(false);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">ค้นหาทักษะ</span>
            <Icon name="search" size={20} className="pointer-events-none absolute top-3.5 left-3 text-muted" />
            <input className={`${inputCls} pl-10`} placeholder="ค้นหาทักษะ" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="flex min-h-12 items-center gap-2 text-[15px] font-semibold">
            <Toggle on={onlyOn} onChange={setOnlyOn} label="แสดงเฉพาะที่เปิด" />
            เฉพาะที่เปิด ({picked.length})
          </label>
        </div>
        <p className="mt-2 text-[14px] text-muted">
          เปิดทักษะที่คลังนี้ต้องการดึงคน ระบบจะดึงเฉพาะคนที่มีทักษะตรงงาน · รายการทักษะเพิ่ม/แก้ได้ที่หน้าตั้งค่าตัวเลือก
        </p>

        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {shown.map((s) => (
            <li key={s} className={`flex items-center gap-3 rounded-2xl p-3 ring-1 transition ${on.has(s) ? "bg-white ring-brand/30 shadow-sm" : "bg-paper ring-line"}`}>
              <SkillIcon name={s} size={46} />
              <div className="min-w-0 flex-1">
                <p className="text-[17px] leading-snug font-bold break-words text-ink">{s}</p>
                <p className="text-[13px] text-muted">
                  คลังนี้ {count(wh, s)} คน · ทุกคลัง {total(s)} คน
                </p>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <Toggle on={on.has(s)} disabled={!canEdit} label={`เปิดให้ดึง ${s}`} onChange={(v) => setPicked((p) => (v ? [...p, s] : p.filter((x) => x !== s)))} />
                <span className="text-[12px] text-muted">{on.has(s) ? "เปิดใช้งาน" : "ปิด"}</span>
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="col-span-full py-6 text-center text-muted">ไม่พบทักษะ</li>}
        </ul>
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-bold text-brand">คลังที่อนุญาตให้ดึงทักษะ</h2>
          <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl ring-1 ring-line">
            <table className="w-full text-[15px]">
              <thead className="sticky top-0 bg-sky">
                <tr>
                  <th className="px-3 py-2.5 text-left font-bold text-ink">ทักษะ</th>
                  {warehouses.map((w) => (
                    <th key={w.id} className={`px-2 py-2.5 text-center font-bold ${w.id === wh ? "text-brand" : "text-ink"}`}>{w.code}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixSkills.map((s) => (
                  <tr key={s} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2"><SkillIcon name={s} size={26} /><span className="min-w-0 break-words">{s}</span></span>
                    </td>
                    {warehouses.map((w) => (
                      <td key={w.id} className="px-2 py-2 text-center">
                        {pulledBy(w.id, s) ? <Icon name="check" size={22} className="inline text-ok" /> : <span className="text-[#a9b2c8]">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
                {matrixSkills.length === 0 && (
                  <tr><td colSpan={warehouses.length + 1} className="px-3 py-6 text-center text-muted">ยังไม่มีคลังไหนเปิดทักษะ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="bg-sky">
          <div className="flex gap-3">
            <Icon name="users" size={28} className="shrink-0 text-brand" />
            <p className="text-[15px] text-ink">
              <b>พนักงาน 1 คน มีได้หลายทักษะ</b> เช่น RT รับ + RT เติม ระบบนำไปกรองคนบนหน้าดึงคนได้ทั้ง 2 งาน
              (ทักษะของแต่ละคนตั้งที่หน้าทะเบียนพนักงาน)
            </p>
          </div>
        </Card>
      </div>

      {dirty && canEdit && (
        <SaveBar text={`ยังไม่บันทึก: เปิด ${added.length} · ปิด ${removed.length}`} busy={busy} onCancel={() => setPicked(saved)} onSave={save} />
      )}
    </div>
  );
}
