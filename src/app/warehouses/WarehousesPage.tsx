"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Modal, inputCls } from "@/components/ui";
import { PageHelper } from "@/components/Puinun";
import { Icon } from "@/components/Icon";
import { CurrentLocation } from "@/components/warehouses/CurrentLocation";
import { errText, sb } from "@/lib/supabase";
import { UNIT_MODULES, isManagerRole, type Unit, type UnitModule, type Warehouse } from "@/lib/types";

type Form = { id?: string; code: string; name: string; address: string; latitude: string; longitude: string; checkin_radius_m: string; color: string; is_active: boolean; unit_id: string };

const EMPTY: Form = { code: "", name: "", address: "", latitude: "", longitude: "", checkin_radius_m: "200", color: "#2563eb", is_active: true, unit_id: "" };

function toForm(w: Warehouse): Form {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    address: w.address ?? "",
    latitude: w.latitude?.toString() ?? "",
    longitude: w.longitude?.toString() ?? "",
    checkin_radius_m: String(w.checkin_radius_m),
    color: w.color ?? "#2563eb",
    is_active: w.is_active,
    unit_id: w.unit_id ?? "",
  };
}

export default function WarehousesPage() {
  const { profile, warehouses, units, reload, preview } = useApp();
  const canEdit = isManagerRole(profile.role);
  const isSuper = profile.role === "super_admin";
  const [form, setForm] = useState<Form | null>(null);
  const [autoLocate, setAutoLocate] = useState(false);
  const [unitForm, setUnitForm] = useState<Unit | "new" | null>(null);
  // เห็นมากกว่า 1 หน่วยงาน (ผู้ดูแลระบบสูงสุด / คนที่สังกัด 2 หน่วยงาน) → แบ่งกลุ่มตามหน่วยงาน
  const groups: { unit: Unit | null; items: Warehouse[] }[] =
    units.length > 1
      ? [
          ...units.map((u) => ({ unit: u as Unit | null, items: warehouses.filter((w) => w.unit_id === u.id) })),
          { unit: null, items: warehouses.filter((w) => !units.some((u) => u.id === w.unit_id)) },
        ].filter((g) => g.unit || g.items.length)
      : [{ unit: null, items: warehouses }];
  const defaultUnit = (units.find((u) => u.is_default) ?? units[0])?.id ?? "";

  return (
    <AppShell title="คลัง" minRole="supervisor">
      <PageHelper pose="point"
        title="คลัง"
        action={
          canEdit && (
            <Button onClick={() => setForm(EMPTY)}>
              <Icon name="plus" size={20} /> เพิ่มคลัง
            </Button>
          )
        }
      >
        {canEdit ? "เพิ่ม แก้ไข หรือปิดใช้งานคลัง" : "เฉพาะผู้ดูแลระบบสูงสุดที่เพิ่มหรือแก้ไขคลังได้"}
      </PageHelper>

      {isSuper && <UnitsPanel units={units} warehouses={warehouses} onAdd={() => setUnitForm("new")} onEdit={setUnitForm} />}

      {warehouses.length === 0 ? (
        <Empty>ยังไม่มีคลัง</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.unit?.id ?? "none"} className="mb-5">
            {units.length > 1 && (
              <h2 className="mb-2 flex flex-wrap items-center gap-2 text-[17px] font-bold text-ink">
                {g.unit ? g.unit.name : "ยังไม่ระบุหน่วยงาน"}
                {g.unit && !g.unit.modules.includes("pull") && <Badge>ไม่ใช้ Pull</Badge>}
              </h2>
            )}
            {g.items.length === 0 ? (
              <Empty>ยังไม่มีคลังในหน่วยงานนี้</Empty>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {g.items.map((w) => (
                  <li key={w.id}>
                    <Card className="h-full">
                      <div className="flex items-start gap-3">
                        <span className="mt-1 h-4 w-4 shrink-0 rounded-full ring-2 ring-white" style={{ background: w.color ?? "#94a3b8" }} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-bold text-brand">{w.code}</span>
                            {w.is_active ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="red">ปิดใช้งาน</Badge>}
                          </div>
                          <p className="font-semibold">{w.name}</p>
                          <p className="mt-1 text-[14px] text-muted">
                            {w.latitude != null && w.longitude != null ? `พิกัด ${w.latitude.toFixed(5)}, ${w.longitude.toFixed(5)}` : "ยังไม่ได้ตั้งพิกัด"} · รัศมี Check In {w.checkin_radius_m} ม.
                          </p>
                        </div>
                        {canEdit && (
                          <Button variant="secondary" size="sm" onClick={() => { setAutoLocate(false); setForm(toForm(w)); }}>
                            แก้ไข
                          </Button>
                        )}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => { setAutoLocate(true); setForm(toForm(w)); }}
                          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky font-semibold text-brand hover:bg-[#dbe5f8]"
                        >
                          <Icon name="pin" size={18} /> ตั้งพิกัดจากจุดที่ฉันยืนอยู่
                        </button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}

      {form && (
        <WarehouseForm
          initial={form.id ? form : { ...form, unit_id: form.unit_id || defaultUnit }}
          preview={preview}
          autoLocate={autoLocate}
          units={isSuper ? units : []}
          warehouses={warehouses}
          onClose={() => setForm(null)}
          onSaved={reload}
        />
      )}
      {unitForm && <UnitForm initial={unitForm === "new" ? null : unitForm} preview={preview} onClose={() => setUnitForm(null)} onSaved={reload} />}
    </AppShell>
  );
}

function WarehouseForm({
  initial,
  preview,
  autoLocate,
  units,
  warehouses,
  onClose,
  onSaved,
}: {
  initial: Form;
  preview: boolean;
  autoLocate: boolean;
  units: Unit[]; // ว่าง = ไม่ใช่ผู้ดูแลระบบสูงสุด (เลือก/ย้ายหน่วยงานไม่ได้ คลังใหม่อยู่หน่วยงานของผู้สร้าง)
  warehouses: Warehouse[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Form, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  // คลังอื่นที่ตั้งพิกัดแล้ว (เช่น หน้าร้านอยู่จุดเดียวกับคลัง 5)
  const sameAs = warehouses.filter((w) => w.id !== f.id && w.latitude != null && w.longitude != null);

  async function save() {
    const code = f.code.trim().toUpperCase();
    const lat = f.latitude.trim() ? Number(f.latitude) : null;
    const lng = f.longitude.trim() ? Number(f.longitude) : null;
    const radius = Number(f.checkin_radius_m);
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return setErr("รหัสคลังใช้ A-Z 0-9 _ - ยาว 2-20 ตัว เช่น WH29, ECOM");
    if (!f.name.trim()) return setErr("กรุณาใส่ชื่อคลัง");
    if ((lat === null) !== (lng === null)) return setErr("ใส่พิกัดให้ครบทั้งละติจูดและลองจิจูด");
    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) return setErr("ละติจูดไม่ถูกต้อง");
    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) return setErr("ลองจิจูดไม่ถูกต้อง");
    if (!Number.isInteger(radius) || radius < 20 || radius > 5000) return setErr("รัศมีต้องเป็นตัวเลข 20-5000 เมตร");
    const row = {
      code,
      name: f.name.trim(),
      address: f.address.trim() || null,
      latitude: lat,
      longitude: lng,
      checkin_radius_m: radius,
      color: f.color,
      is_active: f.is_active,
      ...(units.length > 0 && f.unit_id ? { unit_id: f.unit_id } : {}),
    };
    setBusy(true);
    setErr("");
    try {
      if (!preview) {
        const q = f.id ? sb().from("warehouses").update(row).eq("id", f.id) : sb().from("warehouses").insert(row);
        const { error } = await q;
        if (error) throw error;
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={f.id ? `แก้ไขคลัง ${initial.code}` : "เพิ่มคลัง"} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="รหัสคลัง">
            <input className={inputCls} value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="WH29" maxLength={20} />
          </Field>
          <Field label="ชื่อคลัง">
            <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="คลัง 29" />
          </Field>
        </div>
        {units.length > 0 && (
          <Field label="หน่วยงาน">
            <select className={inputCls} value={f.unit_id} onChange={(e) => set("unit_id", e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.code} · {u.name}</option>
              ))}
            </select>
            {f.id && f.unit_id !== initial.unit_id && (
              <p className="mt-1 text-[13px] font-semibold text-bad">ย้ายหน่วยงานแล้ว พนักงานของคลังนี้จะไปอยู่หน่วยงานใหม่ทั้งหมด และผู้จัดการของหน่วยงานเดิมจะมองไม่เห็นอีก</p>
            )}
          </Field>
        )}
        <Field label="ที่อยู่ (ไม่บังคับ)">
          <input className={inputCls} value={f.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        {sameAs.length > 0 && (
          <Field label="ใช้พิกัดเดียวกับคลัง (ไม่บังคับ)">
            <select
              className={inputCls}
              value=""
              onChange={(e) => {
                const w = sameAs.find((x) => x.id === e.target.value);
                if (w) setF((x) => ({ ...x, latitude: String(w.latitude), longitude: String(w.longitude), checkin_radius_m: String(w.checkin_radius_m) }));
              }}
            >
              <option value="">— เลือกคลังเพื่อคัดลอกพิกัดและรัศมี —</option>
              {sameAs.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="ละติจูด">
            <input className={inputCls} value={f.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" placeholder="13.0827" />
          </Field>
          <Field label="ลองจิจูด">
            <input className={inputCls} value={f.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" placeholder="100.9259" />
          </Field>
        </div>
        <CurrentLocation
          auto={autoLocate}
          prev={initial.latitude && initial.longitude ? { lat: Number(initial.latitude), lng: Number(initial.longitude) } : null}
          onFix={(lat, lng) => setF((x) => ({ ...x, latitude: lat, longitude: lng }))}
        />
        <p className="-mt-2 text-[13px] text-muted">หรือเปิด Google Maps กดค้างที่คลัง แล้วคัดลอกตัวเลข 2 ชุดมาใส่ (ใช้ตอน Check In)</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="รัศมี Check In (เมตร)">
            <input className={inputCls} value={f.checkin_radius_m} onChange={(e) => set("checkin_radius_m", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="สีประจำคลัง">
            <input type="color" className={`${inputCls} p-1`} value={f.color} onChange={(e) => set("color", e.target.value)} />
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          เปิดใช้งาน
        </label>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="flex-1" onClick={save} disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// หน่วยงาน (เฉพาะผู้ดูแลระบบสูงสุด): แยกข้อมูลของแต่ละหน่วยงานออกจากกัน และเลือกเมนูเสริมที่ใช้
function UnitsPanel({ units, warehouses, onAdd, onEdit }: { units: Unit[]; warehouses: Warehouse[]; onAdd: () => void; onEdit: (u: Unit) => void }) {
  return (
    <Card className="mb-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-ink">หน่วยงาน</h2>
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <Icon name="plus" size={18} /> เพิ่มหน่วยงาน
        </Button>
      </div>
      <p className="mb-2 text-[14px] text-muted">
        แต่ละหน่วยงานเห็นเฉพาะพนักงาน ตารางกะ เวลาเข้าออก และรายงานของตัวเอง (ผู้ดูแลระบบสูงสุดเห็นทั้งหมด) · แอดมินที่ต้องดูแลหลายหน่วยงาน ให้เพิ่ม &quot;คลังเพิ่มเติม&quot; ในหน้าผู้ใช้และสิทธิ์
      </p>
      <ul className="divide-y divide-line">
        {units.map((u) => (
          <li key={u.id} className="flex items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <span className="text-brand">{u.code}</span> · {u.name} {u.is_default && <Badge tone="blue">หน่วยงานหลัก</Badge>}
              </p>
              <p className="text-[14px] text-muted">
                {warehouses.filter((w) => w.unit_id === u.id).map((w) => w.code).join(", ") || "ยังไม่มีคลัง"} · {u.modules.includes("pull") ? "ใช้ Pull Operation" : "ไม่ใช้ Pull Operation"}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onEdit(u)}>แก้ไข</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function UnitForm({ initial, preview, onClose, onSaved }: { initial: Unit | null; preview: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [mods, setMods] = useState<UnitModule[]>(initial?.modules ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const c = code.trim().toUpperCase();
    if (!initial && !/^[A-Z0-9_-]{2,20}$/.test(c)) return setErr("รหัสหน่วยงานใช้ A-Z 0-9 _ - ยาว 2-20 ตัว เช่น SHOP5");
    if (!name.trim()) return setErr("กรุณาใส่ชื่อหน่วยงาน");
    setBusy(true);
    setErr("");
    try {
      if (!preview) {
        const { error } = await sb().rpc("save_unit", { p_id: initial?.id ?? null, p_code: c, p_name: name.trim(), p_modules: mods });
        if (error) throw error;
        await onSaved();
      }
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? `แก้ไขหน่วยงาน ${initial.code}` : "เพิ่มหน่วยงาน"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="รหัสหน่วยงาน" hint={initial ? "ตั้งครั้งเดียวตอนสร้าง แก้ไม่ได้" : undefined}>
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SHOP5" maxLength={20} disabled={!!initial} />
        </Field>
        <Field label="ชื่อหน่วยงาน">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="หน้าร้านคลัง 5" maxLength={100} />
        </Field>
        <fieldset>
          <legend className="mb-1 font-semibold">เมนูเสริมที่ใช้</legend>
          {UNIT_MODULES.map((m) => (
            <label key={m.key} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={mods.includes(m.key)}
                onChange={(e) => setMods((x) => (e.target.checked ? [...x, m.key] : x.filter((k) => k !== m.key)))}
              />
              {m.label}
            </label>
          ))}
          <p className="text-[13px] text-muted">ตารางกะ ลงเวลา ลา OT และรายงาน ใช้ได้ทุกหน่วยงานเสมอ</p>
        </fieldset>
        {initial?.is_default && initial.modules.includes("pull") && !mods.includes("pull") && (
          <Alert tone="warning">ปิด Pull ของหน่วยงานหลักแล้ว ทุกคนในหน่วยงานนี้จะไม่เห็นเมนู Pull Operation</Alert>
        )}
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
        </div>
      </div>
    </Modal>
  );
}
