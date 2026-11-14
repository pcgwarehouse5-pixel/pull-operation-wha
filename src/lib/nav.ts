// รายการเมนูทั้งแอป (ใช้ร่วมกันทั้งแถบซ้ายบนจอคอม แถบล่างบนมือถือ และหน้ารวมเมนู)
import type { IconName } from "@/components/Icon";
import { ROLE_RANK, noTimekeeping, type AppRole } from "./types";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  desc: string;
  icon: IconName;
  minRole?: AppRole; // บทบาทขั้นต่ำที่เห็นเมนูนี้
  onlyRole?: AppRole; // เฉพาะบทบาทนี้
  short?: string; // ชื่อสั้นบนแถบล่างของมือถือ
  timekeeping?: boolean; // เฉพาะคนที่ลงเวลา/อยู่ในตารางกะ (ซ่อนจากผู้จัดการฝ่ายขึ้นไป)
};

export const NAV_GROUPS: { id: "mine" | "staff" | "pull" | "manage"; title: string; items: NavItem[] }[] = [
  {
    id: "mine",
    title: "ของฉัน",
    items: [
      { key: "home", href: "/", label: "หน้าหลัก", desc: "ภาพรวมของฉัน", icon: "home" },
      { key: "attendance", href: "/attendance", label: "ลงเวลา", desc: "กดเข้า-ออกงาน ดูเวลาย้อนหลัง ขอแก้เวลา", icon: "pin", timekeeping: true },
      { key: "leave", href: "/leave", label: "ลางาน", desc: "ยื่นใบลา ดูวันลาคงเหลือ", icon: "leave", timekeeping: true },
      { key: "my-shifts", href: "/my-shifts", label: "ตารางกะของฉัน", desc: "กะของฉันรายเดือน", icon: "calendar", short: "กะของฉัน", timekeeping: true },
      { key: "my-position", href: "/my-position", label: "ตำแหน่งงานวันนี้", desc: "ตำแหน่งที่หัวหน้าจัดให้ และเวลาพัก", icon: "grid", short: "ตำแหน่ง", timekeeping: true },
      { key: "notifications", href: "/notifications", label: "แจ้งเตือน", desc: "ใบลา คำขอแก้เวลา ตารางกะ ลืมลงเวลา", icon: "bell" },
      { key: "profile", href: "/profile", label: "ข้อมูลของฉัน", desc: "ข้อมูลส่วนตัวและรหัสผ่าน", icon: "user" },
    ],
  },
  {
    id: "staff",
    title: "พนักงาน",
    items: [
      { key: "employees", href: "/employees", label: "ทะเบียนพนักงาน", desc: "ข้อมูล ทักษะ ลาออก นำเข้า Excel", icon: "users", minRole: "supervisor" },
      { key: "shifts", href: "/shifts", label: "ตารางกะ", desc: "วางกะ ประกาศ นำเข้า/ส่งออก", icon: "calendar", minRole: "supervisor" },
      { key: "shifts-leads", href: "/shifts/leads", label: "ตารางกะหัวหน้าคลัง", desc: "แยกจากตารางกะปกติ แก้ได้เฉพาะผู้จัดการ", icon: "calendar", minRole: "supervisor" },
      { key: "team-attendance", href: "/attendance/team", label: "ติดตามการเข้างาน", desc: "มา/สาย/ขาด รายวัน สรุปรายเดือน อนุมัติแก้เวลา", icon: "clock", minRole: "supervisor", short: "การเข้างาน" },
      { key: "leave-approvals", href: "/leave/approvals", label: "อนุมัติใบลา", desc: "อนุมัติ/ตีกลับ ยื่นใบลาแทนพนักงาน", icon: "check", minRole: "supervisor", short: "อนุมัติลา" },
      { key: "ot", href: "/ot", label: "OT", desc: "OT จากเวลาจริง อนุมัติ/ไม่อนุมัติ", icon: "ot", minRole: "supervisor" },
      { key: "reports", href: "/reports", label: "รายงาน", desc: "ภาพรวม OT เบี้ยขยัน ค่าเดินทาง การลา พิมพ์ A4", icon: "chart", minRole: "supervisor" },
      { key: "organization", href: "/organization", label: "ผังองค์กร", desc: "อัตรากำลังเทียบคนจริง", icon: "grid", minRole: "supervisor" },
    ],
  },
  {
    id: "pull",
    title: "Pull Operation",
    items: [
      { key: "pull-board", href: "/pull", label: "สรุปกำลังพล & ดึงคน", desc: "ต้องการ / จองแล้ว / ขาด ต่อตำแหน่ง แล้วดึงคนจากคลังกลาง", icon: "users", minRole: "supervisor" },
      { key: "pull-workload", href: "/pull/workload", label: "กรอกปริมาณงาน", desc: "ยอดงานคาดการณ์ต่อวัน/กะ เห็นคนที่ต้องการทันที", icon: "leave", minRole: "supervisor" },
      { key: "pull-requirements", href: "/pull/requirements", label: "ผลคำนวณกำลังคน", desc: "สูตรและตัวเลขรายทักษะ ตรวจสอบย้อนกลับได้", icon: "chart", minRole: "supervisor" },
      { key: "pull-layout", href: "/pull/layout", label: "ผังตำแหน่งพนักงาน", desc: "ใครอยู่ตำแหน่งไหน เวลาพัก ใช้ประชุมก่อนเริ่มงาน", icon: "grid", minRole: "supervisor" },
      { key: "pull-dashboard", href: "/pull/dashboard", label: "Dashboard ผู้บริหาร", desc: "ความต้องการเทียบจองแล้ว ทุกคลัง แนวโน้ม 7 วัน", icon: "chart", minRole: "supervisor" },
      { key: "pull-settings", href: "/pull/settings", label: "ตั้งค่า Pull", desc: "ทักษะที่ดึงได้ Productivity ประเภทงาน ชั่วโมงต่อกะ", icon: "link", minRole: "admin" },
    ],
  },
  {
    id: "manage",
    title: "จัดการ",
    items: [
      { key: "users", href: "/users", label: "ผู้ใช้และสิทธิ์", desc: "บทบาท คลัง และรีเซ็ตรหัสผ่าน", icon: "key", minRole: "supervisor" },
      { key: "warehouses", href: "/warehouses", label: "คลัง", desc: "รายชื่อคลังและพิกัด", icon: "warehouse", minRole: "supervisor" },
      { key: "holidays", href: "/holidays", label: "วันหยุดประจำปี", desc: "วันหยุดตามประกาศบริษัท แสดงในตารางกะ คิด OT ให้เอง", icon: "calendar", minRole: "supervisor" },
      { key: "settings", href: "/settings", label: "ตั้งค่าตัวเลือก", desc: "ตำแหน่ง รหัสกะ ประเภทลา", icon: "gear", minRole: "supervisor" },
      { key: "audit", href: "/audit", label: "ประวัติการใช้งาน", desc: "ใครทำอะไร เมื่อไร", icon: "clock", minRole: "supervisor" },
    ],
  },
];

export function navFor(role: AppRole) {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (i) => (!i.minRole || ROLE_RANK[role] >= ROLE_RANK[i.minRole]) && (!i.onlyRole || i.onlyRole === role) && !(i.timekeeping && noTimekeeping(role)),
    ),
  })).filter((g) => g.items.length);
}

// ปุ่มบนแถบล่างของมือถือ (ที่เหลืออยู่ในปุ่ม "เมนู")
export function bottomKeys(role: AppRole): string[] {
  if (noTimekeeping(role)) return ["home", "shifts", "team-attendance", "leave-approvals"];
  return ROLE_RANK[role] >= 2 ? ["home", "attendance", "shifts", "team-attendance"] : ["home", "attendance", "leave", "my-shifts"];
}

export function activeKey(pathname: string): string | null {
  if (pathname === "/") return "home";
  // เลือกเมนูที่ตรงยาวที่สุด (/attendance/team ไม่ใช่ /attendance)
  let best: NavItem | null = null;
  for (const g of NAV_GROUPS)
    for (const i of g.items)
      if (i.href !== "/" && (pathname === i.href || pathname.startsWith(i.href + "/")) && (!best || i.href.length > best.href.length)) best = i;
  return best?.key ?? null;
}
