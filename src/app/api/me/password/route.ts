// เปลี่ยนรหัสผ่านของตัวเอง (รวมถึงตอนเข้าครั้งแรกที่ถูกบังคับเปลี่ยน)
import { defaultPassword, getCaller, json, writeAudit } from "@/lib/server";
import { passwordProblem } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    const { password } = await req.json();
    const pw = String(password ?? "");
    const problem = passwordProblem(pw, caller.me.employee_code);
    if (problem) return json({ error: problem }, 400);
    if (pw === defaultPassword()) return json({ error: "ห้ามใช้รหัสผ่านเริ่มต้น" }, 400);

    const { error } = await caller.admin.auth.admin.updateUserById(caller.me.id, { password: pw });
    if (error) return json({ error: error.message }, 400);
    const { error: pe } = await caller.admin.from("profiles").update({ must_change_password: false }).eq("id", caller.me.id);
    if (pe) return json({ error: pe.message }, 500);
    await writeAudit(caller.admin, { actor_id: caller.me.id, action: "password_change", record_id: caller.me.id, warehouse_id: caller.me.warehouse_id });
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
