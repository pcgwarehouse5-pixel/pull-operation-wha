"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Modal, inputCls } from "@/components/ui";
import { PageHelper } from "@/components/Puinun";
import { Icon } from "@/components/Icon";
import { errText, sb } from "@/lib/supabase";
import { isManagerRole, type Warehouse } from "@/lib/types";

type Form = { id?: string; code: string; name: string; address: string; latitude: string; longitude: string; checkin_radius_m: string; color: string; is_active: boolean };

const EMPTY: Form = { code: "", name: "", address: "", latitude: "", longitude: "", checkin_radius_m: "200", color: "#2563eb", is_active: true };

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
  };
}

export default function WarehousesPage() {
  const { profile, warehouses, reload, preview } = useApp();
  const canEdit = isManagerRole(profile.role);
  const [form, setForm] = useState<Form | null>(null);

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

      {warehouses.length === 0 ? (
        <Empty>ยังไม่มีคลัง</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {warehouses.map((w) => (
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
                    <Button variant="secondary" size="sm" onClick={() => setForm(toForm(w))}>
                      แก้ไข
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {form && <WarehouseForm initial={form} preview={preview} onClose={() => setForm(null)} onSaved={reload} />}
    </AppShell>
  );
}

function WarehouseForm({ initial, preview, onClose, onSaved }: { initial: Form; preview: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Form, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

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
    const row = { code, name: f.name.trim(), address: f.address.trim() || null, latitude: lat, longitude: lng, checkin_radius_m: radius, color: f.color, is_active: f.is_active };
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
        <Field label="ที่อยู่ (ไม่บังคับ)">
          <input className={inputCls} value={f.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ละติจูด">
            <input className={inputCls} value={f.latitude} onChange={(e) => set("latitude", e.target.value)} inputMode="decimal" placeholder="13.0827" />
          </Field>
          <Field label="ลองจิจูด">
            <input className={inputCls} value={f.longitude} onChange={(e) => set("longitude", e.target.value)} inputMode="decimal" placeholder="100.9259" />
          </Field>
        </div>
        <p className="-mt-2 text-[13px] text-muted">เปิด Google Maps กดค้างที่คลัง แล้วคัดลอกตัวเลข 2 ชุดมาใส่ (ใช้ตอน Check In)</p>
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
