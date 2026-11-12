"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Field, inputCls } from "@/components/ui";
import { EMPTY_EMPLOYEE, EmployeeForm, toRow, validateEmployee, type EmployeeValues } from "@/components/EmployeeForm";
import { api, sb } from "@/lib/supabase";
import { useOptions } from "@/lib/useOptions";
import { isGlobal } from "@/lib/types";

export default function NewEmployeePage() {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const router = useRouter();
  const opts = useOptions(["position", "employment_type", "subcontractor_company"]);
  const manageable = (isGlobal(me.role) ? warehouses : warehouses.filter((w) => myWarehouseIds.includes(w.id))).filter((w) => w.is_active);
  const [wh, setWh] = useState(manageable.length === 1 ? manageable[0].id : "");
  const [values, setValues] = useState<EmployeeValues>(EMPTY_EMPLOYEE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const problem = validateEmployee(values, true) ?? (!wh ? "กรุณาเลือกคลัง" : null);
    if (problem) return setErr(problem);
    setBusy(true);
    setErr("");
    try {
      const row = toRow(values);
      if (demo) return router.push("/employees");
      const res = await api<{ ok: true; id: string }>("/api/users", "POST", {
        action: "create",
        employee_code: values.employee_code.trim(),
        warehouse_id: wh,
        role: "employee",
        ...row,
      });
      // ตัวเลือกการคำนวณ (ไม่ได้ส่งตอนสร้างบัญชี) บันทึกต่อในนามผู้ใช้
      await sb().from("profiles").update(values.flags).eq("id", res.id);
      router.push(`/employees/${res.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <AppShell title="เพิ่มพนักงาน" back="/employees" minRole="supervisor">
      <Card className="mb-4">
        <Field label="คลัง">
          <select className={inputCls} value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">เลือกคลัง</option>
            {manageable.map((w) => (
              <option key={w.id} value={w.id}>{w.code} {w.name}</option>
            ))}
          </select>
        </Field>
      </Card>
      <Card className="mb-4">
        <EmployeeForm value={values} onChange={setValues} options={opts} isNew />
      </Card>
      <Alert tone="info">บัญชีใหม่เข้าระบบด้วยรหัสพนักงาน + รหัสผ่านเริ่มต้น และต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก</Alert>
      {err && <div className="mt-3"><Alert tone="error">{err}</Alert></div>}
      <div className="sticky bottom-[72px] z-20 mt-4 lg:bottom-4">
        <Button size="lg" className="w-full shadow-lg" onClick={save} disabled={busy}>
          {busy ? "กำลังเพิ่ม..." : "เพิ่มพนักงาน"}
        </Button>
      </div>
    </AppShell>
  );
}
