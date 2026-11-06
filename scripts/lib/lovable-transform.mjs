// แปลงข้อมูลที่ export จากแอปเดิม (Lovable) ให้ตรงกับตารางของแอปใหม่
// ไม่แตะฐานข้อมูล (ทดสอบได้ด้วย tests/import.test.mjs)

// คลังที่ย้าย: รหัสเดิม → รหัส/ชื่อใหม่
export const WAREHOUSE_MAP = {
  WH05: { code: "WH5", name: "คลัง 5" },
  WH32: { code: "WH32", name: "คลัง 32" },
};

const ROLE_MAP = { user: "employee", supervisor: "supervisor", admin: "admin" };
const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" || s === "-" ? null : s;
};

export function transform(src) {
  const issues = [];
  const whOld = src.warehouses.filter((w) => WAREHOUSE_MAP[w.code]);
  const keep = new Set(whOld.map((w) => w.id));

  const warehouses = whOld.map((w) => ({
    id: w.id,
    code: WAREHOUSE_MAP[w.code].code,
    name: WAREHOUSE_MAP[w.code].name,
    address: clean(w.address),
    latitude: w.latitude ?? null,
    longitude: w.longitude ?? null,
    checkin_radius_m: Math.min(5000, Math.max(20, Math.round(Number(w.radius_km ?? 0.2) * 1000))),
    color: /^#[0-9a-fA-F]{6}$/.test(w.color ?? "") ? w.color : null,
    is_active: w.is_active !== false,
  }));

  const rolesByUser = {};
  for (const r of src.user_roles) (rolesByUser[r.user_id] ??= []).push(r.role);

  const seen = new Map();
  const profiles = [];
  for (const p of src.profiles) {
    if (!keep.has(p.warehouse_id) || p.is_deleted) continue;
    const code = clean(p.employee_code);
    const first = clean(p.first_name_th);
    if (!code || !CODE_RE.test(code)) {
      issues.push({ type: "รหัสพนักงานใช้ไม่ได้", code: p.employee_code ?? "(ว่าง)" });
      continue;
    }
    if (!first) {
      issues.push({ type: "ไม่มีชื่อ", code });
      continue;
    }
    if (seen.has(code.toLowerCase())) {
      issues.push({ type: "รหัสพนักงานซ้ำ", code });
      continue;
    }
    seen.set(code.toLowerCase(), true);
    // ใช้บทบาทสูงสุดที่มี (ไม่ย้ายบทบาทผู้ดูแลระบบ/ผู้ดูแลรายภาค ให้ไปกำหนดใหม่ในแอป)
    const old = rolesByUser[p.user_id] ?? ["user"];
    const role = old.includes("admin") ? "admin" : old.includes("supervisor") ? "supervisor" : "employee";
    if (old.some((r) => !(r in ROLE_MAP))) issues.push({ type: "บทบาทเดิมไม่ได้ย้าย (ไปกำหนดใหม่ในแอป)", code, detail: old.join("+") });
    profiles.push({
      id: p.user_id,
      employee_code: code,
      title: clean(p.title),
      first_name_th: first,
      last_name_th: clean(p.last_name_th),
      nickname: clean(p.nickname),
      position: clean(p.position),
      department: clean(p.department),
      employment_type: clean(p.employment_type),
      salary_code: clean(p.salary_code),
      birth_date: p.birth_date ?? null,
      phone: clean(p.phone),
      line_id: clean(p.line_id),
      warehouse_id: p.warehouse_id,
      role,
      status: p.status === "resigned" ? "resigned" : "active",
      resigned_date: p.status === "resigned" ? (p.resigned_date ?? null) : null,
      exclude_from_shift: !!p.exclude_from_shift,
      show_in_org_chart: p.is_warehouse_sriracha !== false,
      ot_eligible: p.ot_eligible !== false,
      travel_eligible: !!p.travel_eligible,
      show_in_ot_report: p.show_in_ot_report !== false,
      auto_check_in: !!p.auto_check_in_enabled,
      // ไม่ย้าย: เลขบัตรประชาชน, ที่อยู่, ข้อมูลสุขภาพ (PDPA), สิทธิ์เมนูเฉพาะคน
    });
  }

  // คลังเพิ่มเติมที่ดูแล (ไม่นับคลังหลักซ้ำ)
  const homeOf = Object.fromEntries(profiles.map((p) => [p.id, p.warehouse_id]));
  const userWarehouses = src.warehouse_access_permissions
    .filter((a) => homeOf[a.user_id] && keep.has(a.warehouse_id) && a.warehouse_id !== homeOf[a.user_id])
    .map((a) => ({ user_id: a.user_id, warehouse_id: a.warehouse_id }));

  // ตัวเลือกตั้งค่า + ตำแหน่งที่พนักงานใช้อยู่แต่ไม่มีในรายการ
  const options = src.dropdown_options.map((o) => ({
    id: o.id,
    category: o.category,
    value: o.value,
    label: o.label,
    sort_order: o.sort_order ?? 0,
    extra: o.extra ?? {},
    is_active: o.is_active !== false,
  }));
  const posValues = new Set(options.filter((o) => o.category === "position").map((o) => o.value));
  let sort = Math.max(0, ...options.filter((o) => o.category === "position").map((o) => o.sort_order));
  const addedPositions = [...new Set(profiles.map((p) => p.position).filter((x) => x && !posValues.has(x)))].sort();
  // ใส่ ID ให้ด้วย (นำเข้าพร้อมรายการเดิมที่มี ID ถ้าเว้นไว้ฐานข้อมูลจะได้ค่าว่าง)
  for (const v of addedPositions)
    options.push({ id: crypto.randomUUID(), category: "position", value: v, label: v, sort_order: ++sort, extra: {}, is_active: true });

  // ทักษะ (ใช้ ID เดิม) และทักษะของพนักงานที่ย้าย
  const skills = (src.skills ?? []).map((s) => ({ id: s.id, position: clean(s.position), name: clean(s.name), sort_order: 0, is_active: true })).filter((s) => s.position && s.name);
  const skillIds = new Set(skills.map((s) => s.id));
  const movedIds = new Set(profiles.map((p) => p.id));
  const employeeSkills = (src.employee_skills ?? [])
    .filter((x) => movedIds.has(x.user_id) && skillIds.has(x.skill_id))
    .map((x) => ({ user_id: x.user_id, skill_id: x.skill_id }));

  // อัตรากำลัง: แอปเดิมตั้งรวมไม่แยกคลัง → ใส่ให้คลัง 5 ก่อน (แก้ภายหลังในแอป) ข้ามตำแหน่งที่ตั้งเป็น 0
  const wh5 = whOld.find((w) => w.code === "WH05");
  const budgets = wh5
    ? (src.organization_budget ?? [])
        .filter((b) => clean(b.position) && Number(b.budget_count) > 0)
        .map((b) => ({ warehouse_id: wh5.id, position: clean(b.position), budget_count: Number(b.budget_count) }))
    : [];

  return { warehouses, profiles, userWarehouses, options, addedPositions, issues, skills, employeeSkills, budgets };
}
