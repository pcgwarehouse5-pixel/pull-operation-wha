"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, inputCls } from "@/components/ui";
import { PageHelper } from "@/components/Puinun";
import { Icon } from "@/components/Icon";
import { api, errText, fetchAll, sb } from "@/lib/supabase";
import { ROLES, ROLE_LABEL, ROLE_RANK, assignableRoles, fullName, isGlobal, type AppRole, type Profile, type Warehouse } from "@/lib/types";

type Row = Profile & { extra: string[] };

const ROLE_TONE: Record<AppRole, "slate" | "blue" | "green" | "amber" | "red"> = {
  employee: "slate",
  supervisor: "blue",
  admin: "green",
  dept_manager: "amber",
  division_manager: "amber",
  deputy_gm: "amber",
  gm: "amber",
  executive: "amber",
  super_admin: "red",
};

export default function UsersPage() {
  const { profile: me, warehouses, myWarehouseIds, preview, demo } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [wh, setWh] = useState("");
  const [role, setRole] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  // คลังที่ฉันจัดการได้ (ตรงกับ can_manage_warehouse ในฐานข้อมูล)
  const manageable = useMemo(
    () => (isGlobal(me.role) ? warehouses : warehouses.filter((w) => myWarehouseIds.includes(w.id))),
    [me.role, warehouses, myWarehouseIds],
  );
  const canManage = useCallback(
    (t: Row) =>
      t.id !== me.id &&
      (isGlobal(me.role) || (!!t.warehouse_id && myWarehouseIds.includes(t.warehouse_id))) &&
      (me.role === "super_admin" || ROLE_RANK[t.role] < ROLE_RANK[me.role]),
    [me, myWarehouseIds],
  );

  const load = useCallback(async () => {
    if (demo) {
      setRows(demo.PREVIEW_USERS.map((p) => ({ ...p, extra: [] })));
      return;
    }
    try {
      const [ps, uw] = await Promise.all([
        fetchAll<Profile>((from, to) => sb().from("profiles").select("*").order("employee_code").range(from, to)),
        fetchAll<{ user_id: string; warehouse_id: string }>((from, to) => sb().from("user_warehouses").select("user_id, warehouse_id").range(from, to)),
      ]);
      setRows(ps.map((p) => ({ ...p, extra: uw.filter((x) => x.user_id === p.id).map((x) => x.warehouse_id) })));
    } catch (e) {
      setErr(errText(e));
    }
  }, [demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า
    load();
  }, [load]);

  const whCode = (id: string | null) => warehouses.find((w) => w.id === id)?.code ?? "-";
  const shown = (rows ?? []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (s && !`${r.employee_code} ${r.first_name_th} ${r.last_name_th ?? ""} ${r.nickname ?? ""}`.toLowerCase().includes(s)) return false;
    if (wh && r.warehouse_id !== wh && !r.extra.includes(wh)) return false;
    if (role && r.role !== role) return false;
    if (pendingOnly && !r.must_change_password) return false;
    return true;
  });
  const pending = (rows ?? []).filter((r) => r.must_change_password && r.status === "active").length;

  return (
    <AppShell title="ผู้ใช้และสิทธิ์" wide minRole="supervisor">
      <PageHelper pose="hello"
        title="ผู้ใช้และสิทธิ์"
        action={
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={20} /> เพิ่มผู้ใช้
          </Button>
        }
      >
        กำหนดบทบาท คลังที่ดูแล และรีเซ็ตรหัสผ่าน
      </PageHelper>

      {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}

      <Card className="mb-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="relative block">
            <span className="sr-only">ค้นหา</span>
            <Icon name="search" size={20} className="pointer-events-none absolute top-3.5 left-3 text-muted" />
            <input className={`${inputCls} pl-10`} placeholder="ค้นหารหัส ชื่อ หรือชื่อเล่น" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className={inputCls} value={wh} onChange={(e) => setWh(e.target.value)} aria-label="คลัง">
            <option value="">ทุกคลัง</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} {w.name}</option>
            ))}
          </select>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="บทบาท">
            <option value="">ทุกบทบาท</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-[15px]">
          <input type="checkbox" className="h-5 w-5" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          เฉพาะคนที่ยังไม่ได้ตั้งรหัสผ่านใหม่ ({pending.toLocaleString("th-TH")} คน)
        </label>
      </Card>

      {!rows ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Empty>ไม่พบผู้ใช้ตามเงื่อนไข</Empty>
      ) : (
        <>
          <p className="mb-2 px-1 text-[14px] text-muted">แสดง {shown.length.toLocaleString("th-TH")} จาก {rows.length.toLocaleString("th-TH")} คน</p>
          <ul className="space-y-2">
            {shown.map((r) => (
              <li key={r.id}>
                <Card className="!p-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-semibold">
                        {fullName(r)} {r.nickname && <span className="font-normal text-muted">({r.nickname})</span>}
                      </p>
                      <p className="text-[14px] text-muted">
                        {r.employee_code} · {r.position ?? "ไม่ระบุตำแหน่ง"} · {whCode(r.warehouse_id)}
                        {r.extra.length > 0 && ` + ${r.extra.map(whCode).join(", ")}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={ROLE_TONE[r.role]}>{ROLE_LABEL[r.role]}</Badge>
                      {r.status !== "active" && <Badge tone="red">ลาออก</Badge>}
                      {r.must_change_password && r.status === "active" && <Badge tone="amber">ยังไม่ตั้งรหัสใหม่</Badge>}
                    </div>
                    {canManage(r) && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>สิทธิ์</Button>
                        <Button size="sm" variant="secondary" onClick={() => setResetting(r)}>รีเซ็ตรหัส</Button>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <AccessForm
          target={editing}
          myRole={me.role}
          manageable={manageable}
          preview={preview}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setNotice(`บันทึกสิทธิ์ของ ${editing.first_name_th} แล้ว`);
            await load();
          }}
        />
      )}
      {resetting && (
        <ResetPassword
          target={resetting}
          preview={preview}
          onClose={() => setResetting(null)}
          onDone={async () => {
            setNotice(`รีเซ็ตรหัสผ่านของ ${resetting.first_name_th} เป็นรหัสเริ่มต้นแล้ว เจ้าของบัญชีต้องตั้งรหัสใหม่ตอนเข้าครั้งถัดไป`);
            await load();
          }}
        />
      )}
      {creating && (
        <CreateUser
          myRole={me.role}
          manageable={manageable}
          preview={preview}
          onClose={() => setCreating(false)}
          onDone={async (code) => {
            setNotice(`เพิ่มผู้ใช้ ${code} แล้ว เข้าครั้งแรกด้วยรหัสผ่านเริ่มต้น และต้องตั้งรหัสใหม่`);
            await load();
          }}
        />
      )}
    </AppShell>
  );
}

function AccessForm({ target, myRole, manageable, preview, onClose, onSaved }: { target: Row; myRole: AppRole; manageable: Warehouse[]; preview: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<AppRole>(target.role);
  const [home, setHome] = useState(target.warehouse_id ?? "");
  const [extra, setExtra] = useState<string[]>(target.extra.filter((x) => manageable.some((w) => w.id === x)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const roles = assignableRoles(myRole);
  const multi = role === "supervisor" || role === "admin";

  async function save() {
    if (!home && !isGlobal(role)) return setErr("กรุณาเลือกคลังหลัก");
    setBusy(true);
    setErr("");
    try {
      if (!preview) {
        const { error } = await sb().rpc("set_user_access", {
          p_user: target.id,
          p_role: role,
          p_home: home || null,
          p_extra: multi ? extra.filter((x) => x !== home) : [],
        });
        if (error) throw error;
      }
      await onSaved();
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={`สิทธิ์ของ ${target.first_name_th} (${target.employee_code})`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="บทบาท">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </Field>
        {isGlobal(role) && <Alert tone="info">{ROLE_LABEL[role]} เห็นและจัดการได้ทุกคลัง</Alert>}
        <Field label="คลังหลัก">
          <select className={inputCls} value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">{isGlobal(role) ? "ไม่ระบุ (ส่วนกลาง)" : "เลือกคลัง"}</option>
            {manageable.map((w) => (
              <option key={w.id} value={w.id}>{w.code} {w.name}</option>
            ))}
          </select>
        </Field>
        {multi && manageable.length > 1 && (
          <fieldset>
            <legend className="mb-1.5 text-[15px] font-semibold">ดูแลคลังเพิ่มเติม</legend>
            <div className="grid grid-cols-2 gap-2">
              {manageable
                .filter((w) => w.id !== home)
                .map((w) => (
                  <label key={w.id} className="flex min-h-11 items-center gap-2 rounded-xl px-3 ring-1 ring-line">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={extra.includes(w.id)}
                      onChange={(e) => setExtra((x) => (e.target.checked ? [...x, w.id] : x.filter((y) => y !== w.id)))}
                    />
                    {w.code}
                  </label>
                ))}
            </div>
          </fieldset>
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

function ResetPassword({ target, preview, onClose, onDone }: { target: Row; preview: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Modal title="รีเซ็ตรหัสผ่าน" onClose={onClose}>
      <div className="space-y-4">
        <p>
          รีเซ็ตรหัสผ่านของ <b>{fullName(target)}</b> ({target.employee_code}) กลับเป็น<b>รหัสผ่านเริ่มต้น</b>
          ใช้เมื่อเจ้าของบัญชีลืมรหัส หรือมีคนอื่นเข้าบัญชีแทน
        </p>
        <Alert tone="warning">แจ้งเจ้าของบัญชีโดยตรง และให้เข้าระบบเพื่อตั้งรหัสใหม่ทันที</Alert>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                if (!preview) await api("/api/users", "POST", { action: "reset_password", user_id: target.id });
                await onDone();
                onClose();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังรีเซ็ต..." : "รีเซ็ตรหัสผ่าน"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreateUser({ myRole, manageable, preview, onClose, onDone }: { myRole: AppRole; manageable: Warehouse[]; preview: boolean; onClose: () => void; onDone: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [wh, setWh] = useState(manageable.length === 1 ? manageable[0].id : "");
  const [role, setRole] = useState<AppRole>("employee");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(code.trim())) return setErr("รหัสพนักงานใช้ได้เฉพาะ A-Z a-z 0-9 . _ -");
    if (!first.trim()) return setErr("กรุณาใส่ชื่อ");
    if (!wh && !isGlobal(role)) return setErr("กรุณาเลือกคลัง");
    setBusy(true);
    setErr("");
    try {
      if (!preview) await api("/api/users", "POST", { action: "create", employee_code: code.trim(), first_name_th: first.trim(), last_name_th: last.trim(), warehouse_id: wh || null, role });
      await onDone(code.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="เพิ่มผู้ใช้" onClose={onClose}>
      <div className="space-y-4">
        <Field label="รหัสพนักงาน" hint="ใช้เป็นชื่อเข้าระบบ">
          <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" maxLength={30} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ชื่อ">
            <input className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="นามสกุล">
            <input className={inputCls} value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="คลัง">
            <select className={inputCls} value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">{isGlobal(role) ? "ส่วนกลาง" : "เลือกคลัง"}</option>
              {manageable.map((w) => (
                <option key={w.id} value={w.id}>{w.code}</option>
              ))}
            </select>
          </Field>
          <Field label="บทบาท">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              {assignableRoles(myRole).map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </Field>
        </div>
        <p className="text-[13px] text-muted">ข้อมูลพนักงานอื่นๆ (ตำแหน่ง ประเภทพนักงาน ทักษะ) จะแก้ได้ในหน้าทะเบียนพนักงาน (โมดูล 1)</p>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button className="flex-1" onClick={save} disabled={busy}>{busy ? "กำลังเพิ่ม..." : "เพิ่มผู้ใช้"}</Button>
        </div>
      </div>
    </Modal>
  );
}
