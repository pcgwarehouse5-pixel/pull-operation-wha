"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Field, Loading, Modal, inputCls } from "@/components/ui";
import { EmployeeForm, toRow, validateEmployee, type EmployeeValues } from "@/components/EmployeeForm";
import { api, errText, sb } from "@/lib/supabase";
import { labelOf, useOptions } from "@/lib/useOptions";
import { thaiDate } from "@/lib/format";
import { MISSING_LABEL, missingFields } from "@/lib/employee-check";

function SummaryItem({ label, value, missing }: { label: string; value: string | null | undefined; missing?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl px-3 py-2 ${missing ? "bg-[#fff6d6] ring-1 ring-warn/60" : "bg-paper"}`}>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="font-semibold break-words text-ink">{missing || !value ? <span className="text-[#8a6500]">ยังไม่กรอก</span> : value}</dd>
    </div>
  );
}
import { EMPLOYEE_FLAGS, ROLE_LABEL, ROLE_RANK, fullName, isGlobal, isManager, type Employee, type Skill } from "@/lib/types";

function toValues(e: Employee): EmployeeValues {
  return {
    employee_code: e.employee_code,
    title: e.title ?? "",
    first_name_th: e.first_name_th,
    last_name_th: e.last_name_th ?? "",
    nickname: e.nickname ?? "",
    position: e.position ?? "",
    department: e.department ?? "",
    employment_type: e.employment_type ?? "",
    subcontractor_company: e.subcontractor_company ?? "",
    salary_code: e.salary_code ?? "",
    phone: e.phone ?? "",
    line_id: e.line_id ?? "",
    birth_date: e.birth_date ?? "",
    flags: Object.fromEntries(EMPLOYEE_FLAGS.map((f) => [f.key, !!e[f.key]])),
  };
}

// วันที่วันนี้ตามเวลาไทย (YYYY-MM-DD)
const todayBangkok = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

export default function EmployeePage({ id }: { id: string }) {
  const { profile: me, warehouses, myWarehouseIds, demo } = useApp();
  const router = useRouter();
  const opts = useOptions(["position", "employment_type", "subcontractor_company"]);
  const [emp, setEmp] = useState<Employee | null | undefined>(undefined);
  const [values, setValues] = useState<EmployeeValues | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [savedSkills, setSavedSkills] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"resign" | "reinstate" | "reset" | "delete" | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      const e = demo.previewEmployees().find((x) => x.id === id) ?? null;
      setEmp(e);
      if (e) setValues(toValues(e));
      setSkills(demo.PREVIEW_SKILLS);
      const own = new Set(demo.PREVIEW_EMPLOYEE_SKILLS.filter((s) => s.user_id === id).map((s) => s.skill_id));
      setMine(own);
      setSavedSkills(new Set(own));
      return;
    }
    try {
      const [p, s, es] = await Promise.all([
        sb().from("profiles").select("*").eq("id", id).maybeSingle(),
        sb().from("skills").select("*").order("position").order("sort_order").order("name"),
        sb().from("employee_skills").select("skill_id").eq("user_id", id),
      ]);
      if (p.error) throw p.error;
      const e = p.data as Employee | null;
      setEmp(e);
      if (e) setValues(toValues(e));
      setSkills((s.data ?? []) as Skill[]);
      const set = new Set((es.data ?? []).map((r: { skill_id: string }) => r.skill_id));
      setMine(set);
      setSavedSkills(new Set(set));
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [id, demo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า
    load();
  }, [load]);

  if (emp === undefined || !values) return <AppShell title="ข้อมูลพนักงาน" back="/employees" minRole="supervisor"><Loading /></AppShell>;
  if (emp === null)
    return (
      <AppShell title="ข้อมูลพนักงาน" back="/employees" minRole="supervisor">
        <Alert tone="warning">ไม่พบพนักงานคนนี้ หรือคุณไม่มีสิทธิ์ดู</Alert>
      </AppShell>
    );

  const manageableWh = isGlobal(me.role) || (!!emp.warehouse_id && myWarehouseIds.includes(emp.warehouse_id));
  const canEdit = isManager(me.role) && manageableWh;
  // ลาออก/คืนสภาพ/รีเซ็ตรหัส: ต้องบทบาทสูงกว่า (ตรงกับ can_manage_user ในฐานข้อมูล)
  const canManageUser = canEdit && emp.id !== me.id && (me.role === "super_admin" || ROLE_RANK[emp.role] < ROLE_RANK[me.role]);
  const wh = warehouses.find((w) => w.id === emp.warehouse_id);
  const posSkills = skills.filter((s) => s.position === values.position && (s.is_active || mine.has(s.id)));
  const otherSkills = skills.filter((s) => s.position !== values.position && mine.has(s.id));
  const skillsChanged = mine.size !== savedSkills.size || [...mine].some((x) => !savedSkills.has(x));
  // การ์ดสรุปใช้ข้อมูลที่บันทึกแล้ว (ไม่ใช่ค่าที่กำลังแก้ในฟอร์ม)
  const savedSkillList = skills.filter((s) => savedSkills.has(s.id));
  const missing = missingFields(emp, savedSkills.size);

  async function save() {
    const problem = validateEmployee(values!, false);
    if (problem) return setMsg({ tone: "error", text: problem });
    setBusy(true);
    setMsg(null);
    try {
      if (!demo) {
        const { error } = await sb().from("profiles").update(toRow(values!)).eq("id", id);
        if (error) throw error;
        if (skillsChanged) {
          const { error: se } = await sb().rpc("set_employee_skills", { p_user: id, p_skill_ids: [...mine] });
          if (se) throw se;
        }
        await load();
      }
      setMsg({ tone: "success", text: "บันทึกแล้ว" });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={`${emp.first_name_th} · ${emp.employee_code}`} back="/employees" minRole="supervisor">
      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold text-brand">
              {fullName(emp)} {emp.nickname && <span className="text-base font-semibold text-muted">({emp.nickname})</span>}
            </p>
            <p className="text-muted">{ROLE_LABEL[emp.role]}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {emp.status === "active" ? <Badge tone="green">ทำงานอยู่</Badge> : <Badge tone="red">ลาออก {emp.resigned_date ? thaiDate(emp.resigned_date) : ""}</Badge>}
            {emp.must_change_password && emp.status === "active" && <Badge tone="amber">ยังไม่ตั้งรหัสใหม่</Badge>}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <SummaryItem label="รหัสพนักงาน" value={emp.employee_code} />
          <SummaryItem label="รหัสเงินเดือน" value={emp.salary_code} missing={missing.includes("salary_code")} />
          <SummaryItem label="คลัง" value={wh ? `${wh.code} ${wh.name}` : "ส่วนกลาง"} missing={missing.includes("warehouse")} />
          <SummaryItem label="ตำแหน่ง" value={emp.position} missing={missing.includes("position")} />
          <SummaryItem label="ประเภทพนักงาน" value={emp.employment_type ? labelOf(opts.employment_type, emp.employment_type) : null} missing={missing.includes("employment_type")} />
          <SummaryItem label="นามสกุล" value={emp.last_name_th || (missing.includes("last_name") ? null : "อยู่ในช่องชื่อ")} missing={missing.includes("last_name")} />
        </dl>

        <div className="mt-3">
          <p className="mb-1.5 text-[14px] font-semibold text-muted">ทักษะ ({savedSkillList.length})</p>
          {savedSkillList.length === 0 ? (
            <Badge tone="amber">ยังไม่กรอก</Badge>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {savedSkillList.map((s) => (
                <span key={s.id} className="rounded-full bg-sky px-3 py-1 text-[14px] font-semibold text-brand">{s.name}</span>
              ))}
            </div>
          )}
        </div>

        {missing.length > 0 && (
          <div className="mt-3">
            <Alert tone="warning">
              ข้อมูลยังไม่ครบ: {missing.map((k) => MISSING_LABEL[k]).join(", ")} ·{" "}
              {canEdit ? "กรอกเพิ่มในแบบฟอร์มด้านล่าง แล้วกดบันทึก" : "แจ้งแอดมินคลังให้กรอกเพิ่ม"}
            </Alert>
          </div>
        )}
        {isManager(me.role) && (
          <p className="mt-2 text-[14px] text-muted">
            เปลี่ยนคลังหรือบทบาทได้ที่หน้า <Link href="/users" className="font-semibold text-brand underline">ผู้ใช้และสิทธิ์</Link>
          </p>
        )}
      </Card>

      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <Card className="mb-4">
        <h2 className="mb-3 text-lg font-bold text-brand">ข้อมูลพนักงาน</h2>
        <EmployeeForm value={values} onChange={setValues} options={opts} readOnly={!canEdit} />
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 text-lg font-bold text-brand">ทักษะ</h2>
        <p className="mb-3 text-[14px] text-muted">
          {values.position ? `ทักษะของตำแหน่ง ${values.position}` : "เลือกตำแหน่งก่อน จึงจะเลือกทักษะได้"} (เพิ่มรายการทักษะได้ที่หน้าตั้งค่าตัวเลือก)
        </p>
        {posSkills.length === 0 && otherSkills.length === 0 ? (
          <p className="text-muted">ยังไม่มีรายการทักษะของตำแหน่งนี้</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...posSkills, ...otherSkills].map((s) => {
              const on = mine.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setMine((m) => { const n = new Set(m); if (on) n.delete(s.id); else n.add(s.id); return n; })}
                  className={`min-h-11 rounded-full px-4 text-[15px] font-semibold ring-1 transition ${on ? "bg-brand text-white ring-brand" : "bg-white text-ink ring-line"} disabled:cursor-default`}
                  aria-pressed={on}
                >
                  {on ? "✓ " : ""}{s.name}{s.position !== values.position ? ` (${s.position})` : ""}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {canEdit && (
        <div className="sticky bottom-[72px] z-20 mb-4 lg:bottom-4">
          <Button size="lg" className="w-full shadow-lg" onClick={save} disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึกข้อมูลและทักษะ"}
          </Button>
        </div>
      )}

      {canManageUser && (
        <Card className="mb-4">
          <h2 className="mb-3 text-lg font-bold text-brand">สถานะและบัญชี</h2>
          <div className="flex flex-wrap gap-2">
            {emp.status === "active" ? (
              <Button variant="danger" onClick={() => setDialog("resign")}>บันทึกลาออก</Button>
            ) : (
              <Button onClick={() => setDialog("reinstate")}>คืนสภาพ (กลับมาทำงาน)</Button>
            )}
            {emp.status === "active" && <Button variant="secondary" onClick={() => setDialog("reset")}>รีเซ็ตรหัสผ่าน</Button>}
            {me.role === "super_admin" && <Button variant="ghost" className="text-bad" onClick={() => setDialog("delete")}>ลบบัญชีที่สร้างผิด</Button>}
          </div>
        </Card>
      )}

      {dialog === "resign" && <ResignDialog emp={emp} demo={!!demo} onClose={() => setDialog(null)} onDone={async () => { setMsg({ tone: "success", text: "บันทึกลาออกแล้ว พนักงานคนนี้ล็อกอินไม่ได้แล้ว ประวัติยังอยู่ครบ" }); await load(); }} />}
      {dialog && dialog !== "resign" && (
        <ConfirmAction
          kind={dialog}
          emp={emp}
          demo={!!demo}
          onClose={() => setDialog(null)}
          onDone={async () => {
            if (dialog === "delete") return router.replace("/employees");
            setMsg({ tone: "success", text: dialog === "reinstate" ? "คืนสภาพแล้ว ล็อกอินได้ตามปกติ" : "รีเซ็ตรหัสผ่านแล้ว พนักงานต้องตั้งรหัสใหม่ตอนเข้าครั้งถัดไป" });
            await load();
          }}
        />
      )}
    </AppShell>
  );
}

function ResignDialog({ emp, demo, onClose, onDone }: { emp: Employee; demo: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(todayBangkok());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Modal title={`บันทึกลาออก: ${emp.first_name_th}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="วันที่ลาออก (วันสุดท้ายที่ทำงาน)">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="เหตุผล" hint="เช่น ลาออกเอง, หมดสัญญา, ย้ายบริษัทรับเหมา">
          <textarea className={`${inputCls} min-h-24 py-2.5`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        <Alert tone="warning">พนักงานจะล็อกอินไม่ได้ทันที ข้อมูลและประวัติยังอยู่ครบ คืนสภาพได้ภายหลัง</Alert>
        <p className="text-[13px] text-muted">หมายเหตุ: หน้านี้บันทึกสถานะในแอปเท่านั้น เรื่องเอกสารการเลิกจ้าง ค่าชดเชย และการแจ้งประกันสังคม ให้ดำเนินการตามขั้นตอนของฝ่ายบุคคล</p>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy || !date || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                if (!demo) await api("/api/employees", "POST", { action: "status", user_id: emp.id, status: "resigned", date, reason: reason.trim() });
                await onDone();
                onClose();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังบันทึก..." : "ยืนยันลาออก"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmAction({ kind, emp, demo, onClose, onDone }: { kind: "reinstate" | "reset" | "delete"; emp: Employee; demo: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const text = {
    reinstate: { title: "คืนสภาพพนักงาน", body: `${fullName(emp)} จะกลับมาล็อกอินได้ (ใช้รหัสผ่านเดิม)`, ok: "คืนสภาพ", tone: "primary" as const },
    reset: { title: "รีเซ็ตรหัสผ่าน", body: `รีเซ็ตรหัสผ่านของ ${fullName(emp)} กลับเป็นรหัสเริ่มต้น และต้องตั้งรหัสใหม่ตอนเข้าครั้งถัดไป`, ok: "รีเซ็ตรหัสผ่าน", tone: "danger" as const },
    delete: { title: "ลบบัญชีที่สร้างผิด", body: `ลบบัญชี ${emp.employee_code} ถาวร ใช้ได้เฉพาะบัญชีที่ยังไม่เคยเข้าใช้งาน ถ้าเคยใช้งานแล้วให้บันทึกลาออกแทน`, ok: "ลบถาวร", tone: "danger" as const },
  }[kind];
  return (
    <Modal title={text.title} onClose={onClose}>
      <div className="space-y-4">
        <p>{text.body}</p>
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button
            variant={text.tone}
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                if (!demo) {
                  if (kind === "reinstate") await api("/api/employees", "POST", { action: "status", user_id: emp.id, status: "active" });
                  if (kind === "reset") await api("/api/users", "POST", { action: "reset_password", user_id: emp.id });
                  if (kind === "delete") await api("/api/employees", "POST", { action: "delete", user_id: emp.id });
                }
                await onDone();
                onClose();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังทำรายการ..." : text.ok}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
