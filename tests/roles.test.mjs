// ทดสอบกฎบทบาทฝั่งหน้าเว็บ ให้ตรงกับฐานข้อมูล (tests/db-manager-roles.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignableRoles, canApproveRole, isGlobal, isManagerRole, noTimekeeping, ROLE_RANK } from "../src/lib/types.ts";

test("ให้บทบาทได้ต่ำกว่าตัวเองลงไป และไม่มอบผู้บริหารเดิม", () => {
  assert.deepEqual(assignableRoles("admin"), ["employee", "supervisor"]);
  assert.deepEqual(assignableRoles("dept_manager"), ["employee", "supervisor", "admin"]);
  assert.deepEqual(assignableRoles("division_manager"), ["employee", "supervisor", "admin", "dept_manager"]);
  assert.deepEqual(assignableRoles("gm"), ["employee", "supervisor", "admin", "dept_manager", "division_manager", "deputy_gm"]);
  assert.ok(!assignableRoles("super_admin").includes("executive"));
  assert.ok(assignableRoles("super_admin").includes("gm"));
  assert.deepEqual(assignableRoles("supervisor"), ["employee", "supervisor"], "หัวหน้างานให้บทบาทได้เท่าแอดมิน");
  assert.deepEqual(assignableRoles("employee"), []);
});

test("อนุมัติระดับถัดไป (ตรงกับ can_approve_user)", () => {
  assert.equal(canApproveRole("supervisor", "employee", true), true);
  assert.equal(canApproveRole("admin", "employee", false), false, "คลังอื่น");
  assert.equal(canApproveRole("admin", "supervisor", true), false);
  assert.equal(canApproveRole("dept_manager", "supervisor", false), true, "ผู้จัดการทุกคลัง");
  assert.equal(canApproveRole("dept_manager", "dept_manager", true), false);
  assert.equal(canApproveRole("division_manager", "dept_manager", false), true);
  assert.equal(canApproveRole("gm", "division_manager", true), false, "ฝ่ายขึ้นไปไม่มีคำขอ");
});

test("กลุ่มบทบาท", () => {
  assert.equal(isGlobal("dept_manager"), true);
  assert.equal(isGlobal("admin"), false);
  assert.equal(isManagerRole("dept_manager"), true);
  assert.equal(isManagerRole("executive"), false, "ผู้บริหารเดิมไม่ได้สิทธิ์ใหม่");
  assert.equal(noTimekeeping("dept_manager"), false);
  assert.equal(noTimekeeping("division_manager"), true);
  assert.ok(ROLE_RANK.super_admin > ROLE_RANK.gm);
});
