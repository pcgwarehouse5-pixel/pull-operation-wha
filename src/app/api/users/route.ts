// จัดการบัญชีผู้ใช้: สร้างใหม่ และรีเซ็ตรหัสผ่านกลับเป็นค่าเริ่มต้น
// ใช้กุญแจระดับระบบเฉพาะฝั่งเซิร์ฟเวอร์ และตรวจสิทธิ์ด้วยฟังก์ชันในฐานข้อมูลทุกครั้ง
import { LOGIN_DOMAIN, defaultPassword, getCaller, json, userClient, writeAudit } from "@/lib/server";
import { assignableRoles, type AppRole } from "@/lib/types";

const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;

export async function POST(req: Request) {
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    const body = await req.json();
    const asUser = userClient(caller.token);

    if (body.action === "reset_password") {
      const userId = String(body.user_id ?? "");
      const { data: ok, error } = await asUser.rpc("can_manage_user", { p_user: userId });
      if (error) return json({ error: error.message }, 500);
      if (!ok) return json({ error: "คุณไม่มีสิทธิ์รีเซ็ตรหัสผ่านของผู้ใช้นี้" }, 403);
      const { error: ue } = await caller.admin.auth.admin.updateUserById(userId, { password: defaultPassword() });
      if (ue) return json({ error: ue.message }, 500);
      const { data: t, error: pe } = await caller.admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", userId)
        .select("warehouse_id")
        .single();
      if (pe) return json({ error: pe.message }, 500);
      await writeAudit(caller.admin, { actor_id: caller.me.id, action: "password_reset", record_id: userId, warehouse_id: t.warehouse_id });
      return json({ ok: true });
    }

    if (body.action === "create") {
      const code = String(body.employee_code ?? "").trim();
      const firstName = String(body.first_name_th ?? "").trim();
      const lastName = String(body.last_name_th ?? "").trim();
      const warehouseId = body.warehouse_id ? String(body.warehouse_id) : null;
      const role = String(body.role ?? "employee") as AppRole;
      if (!CODE_RE.test(code)) return json({ error: "รหัสพนักงานใช้ได้เฉพาะ A-Z a-z 0-9 . _ - (ไม่เกิน 30 ตัว)" }, 400);
      if (!firstName) return json({ error: "กรุณาใส่ชื่อ" }, 400);
      if (!assignableRoles(caller.me.role as AppRole).includes(role)) return json({ error: "คุณกำหนดบทบาทนี้ไม่ได้" }, 403);
      if (!warehouseId && role !== "executive" && role !== "super_admin") return json({ error: "กรุณาเลือกคลัง" }, 400);
      if (warehouseId) {
        const { data: can, error } = await asUser.rpc("can_manage_warehouse", { p_wh: warehouseId });
        if (error) return json({ error: error.message }, 500);
        if (!can) return json({ error: "คุณไม่มีสิทธิ์เพิ่มผู้ใช้ในคลังนี้" }, 403);
      }

      const { data: created, error: ce } = await caller.admin.auth.admin.createUser({
        email: `${code.toLowerCase()}@${LOGIN_DOMAIN}`,
        password: defaultPassword(),
        email_confirm: true,
      });
      if (ce) return json({ error: /already/i.test(ce.message) ? "รหัสพนักงานนี้มีบัญชีอยู่แล้ว" : ce.message }, 400);
      const { error: pe } = await caller.admin.from("profiles").insert({
        id: created.user.id,
        employee_code: code,
        first_name_th: firstName,
        last_name_th: lastName || null,
        warehouse_id: warehouseId,
        role,
        must_change_password: true,
      });
      if (pe) {
        await caller.admin.auth.admin.deleteUser(created.user.id);
        return json({ error: /duplicate/i.test(pe.message) ? "รหัสพนักงานนี้มีอยู่แล้ว" : pe.message }, 400);
      }
      await writeAudit(caller.admin, { actor_id: caller.me.id, action: "user_create", record_id: created.user.id, warehouse_id: warehouseId, new_data: { employee_code: code, role } });
      return json({ ok: true });
    }

    return json({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
