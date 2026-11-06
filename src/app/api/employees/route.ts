// งานพนักงานที่ต้องใช้สิทธิ์ระบบ: ลาออก/คืนสภาพ (ปิด/เปิดล็อกอิน), นำเข้าเป็นชุด, ลบบัญชีที่สร้างผิด
// ตรวจสิทธิ์ด้วยฟังก์ชันในฐานข้อมูลในนามผู้เรียกทุกครั้ง แล้วจึงใช้สิทธิ์ระบบทำส่วนที่เหลือ
import { createEmployeeAccount, getCaller, json, pickEmployeeFields, userClient, writeAudit } from "@/lib/server";

const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const MAX_IMPORT = 1000;

export async function POST(req: Request) {
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "กรุณาเข้าสู่ระบบใหม่" }, 401);
    const body = await req.json();
    const asUser = userClient(caller.token);

    // ---------------- ลาออก / คืนสภาพ ----------------
    if (body.action === "status") {
      const userId = String(body.user_id ?? "");
      const status = body.status === "resigned" ? "resigned" : "active";
      const { error } = await asUser.rpc("set_employee_status", {
        p_user: userId,
        p_status: status,
        p_date: body.date || null,
        p_reason: body.reason || null,
      });
      if (error) return json({ error: error.message }, 400);
      // ปิดล็อกอินคนลาออก (เด้งออกจากทุกเครื่อง) / เปิดคืนเมื่อกลับมาทำงาน
      const { error: be } = await caller.admin.auth.admin.updateUserById(userId, { ban_duration: status === "resigned" ? "876000h" : "none" });
      if (be) return json({ error: `บันทึกสถานะแล้ว แต่${status === "resigned" ? "ปิด" : "เปิด"}การล็อกอินไม่สำเร็จ ลองกดอีกครั้ง (${be.message})` }, 500);
      return json({ ok: true });
    }

    // ---------------- ลบบัญชีที่สร้างผิด (เฉพาะผู้ดูแลระบบสูงสุด, บัญชีที่ไม่เคยเข้าใช้งาน) ----------------
    if (body.action === "delete") {
      if (caller.me.role !== "super_admin") return json({ error: "เฉพาะผู้ดูแลระบบสูงสุดเท่านั้น" }, 403);
      const userId = String(body.user_id ?? "");
      if (userId === caller.me.id) return json({ error: "ลบบัญชีของตัวเองไม่ได้" }, 400);
      const { data: u, error: ue } = await caller.admin.auth.admin.getUserById(userId);
      if (ue || !u.user) return json({ error: "ไม่พบบัญชีนี้" }, 404);
      if (u.user.last_sign_in_at) return json({ error: "บัญชีนี้เคยเข้าใช้งานแล้ว ลบไม่ได้ ให้ใช้ \"ลาออก\" แทน" }, 400);
      const { data: p } = await caller.admin.from("profiles").select("employee_code, warehouse_id").eq("id", userId).maybeSingle();
      const { error: de } = await caller.admin.auth.admin.deleteUser(userId);
      if (de) return json({ error: de.message }, 500);
      await writeAudit(caller.admin, { actor_id: caller.me.id, action: "user_delete", record_id: userId, warehouse_id: p?.warehouse_id ?? null, new_data: { employee_code: p?.employee_code } });
      return json({ ok: true });
    }

    // ---------------- นำเข้าพนักงานเป็นชุด ----------------
    if (body.action === "import") {
      const warehouseId = String(body.warehouse_id ?? "");
      const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
      const updateExisting = body.update_existing === true;
      if (!rows.length) return json({ error: "ไม่มีรายการให้นำเข้า" }, 400);
      if (rows.length > MAX_IMPORT) return json({ error: `นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT} คน` }, 400);
      const { data: can } = await asUser.rpc("can_manage_warehouse", { p_wh: warehouseId });
      if (!can) return json({ error: "คุณไม่มีสิทธิ์เพิ่มพนักงานในคลังนี้" }, 403);

      const results: { line: number; code: string; status: "created" | "updated" | "skipped" | "error"; message?: string }[] = [];
      for (const row of rows) {
        const line = Number(row.line) || 0;
        const code = String(row.employee_code ?? "").trim();
        const fields = pickEmployeeFields(row);
        if (!CODE_RE.test(code) || !fields.first_name_th) {
          results.push({ line, code, status: "error", message: "รหัสพนักงานหรือชื่อไม่ถูกต้อง" });
          continue;
        }
        // ค้นแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ โดยให้ _ และ % เป็นตัวอักษรธรรมดา (ไม่ใช่ตัวแทนอักษร)
        const { data: ex } = await caller.admin
          .from("profiles")
          .select("id, warehouse_id")
          .ilike("employee_code", code.replace(/[\\%_]/g, "\\$&"))
          .maybeSingle();
        if (ex) {
          if (!updateExisting) {
            results.push({ line, code, status: "skipped", message: "มีอยู่แล้ว" });
            continue;
          }
          const { data: canEx } = await asUser.rpc("can_manage_warehouse", { p_wh: ex.warehouse_id });
          if (!canEx) {
            results.push({ line, code, status: "error", message: "เป็นพนักงานของคลังที่คุณไม่มีสิทธิ์จัดการ" });
            continue;
          }
          // อัปเดตในนามผู้เรียก (กฎสิทธิ์และประวัติการแก้ไขทำงานตามปกติ) ไม่แตะบทบาท/คลัง/รหัสผ่าน
          const { error } = await asUser.from("profiles").update(fields).eq("id", ex.id);
          results.push(error ? { line, code, status: "error", message: error.message } : { line, code, status: "updated" });
          continue;
        }
        const created = await createEmployeeAccount(caller.admin, { employee_code: code, warehouse_id: warehouseId, role: "employee", fields });
        results.push(created.error ? { line, code, status: "error", message: created.error } : { line, code, status: "created" });
      }
      const count = (s: string) => results.filter((r) => r.status === s).length;
      await writeAudit(caller.admin, {
        actor_id: caller.me.id,
        action: "employee_import",
        record_id: warehouseId,
        warehouse_id: warehouseId,
        new_data: { created: count("created"), updated: count("updated"), skipped: count("skipped"), error: count("error") },
      });
      return json({ ok: true, results });
    }

    return json({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
