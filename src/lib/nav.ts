// รายการเมนูทั้งแอป (ใช้ร่วมกันทั้งแถบซ้ายบนจอคอม แถบล่างบนมือถือ และหน้ารวมเมนู)
import type { IconName } from "@/components/Icon";
import { ROLE_RANK, type AppRole } from "./types";

export type NavItem = {
  key: string;
  href: string;
  label: string;
  desc: string;
  icon: IconName;
  minRole?: AppRole; // บทบาทขั้นต่ำที่เห็นเมนูนี้
  onlyRole?: AppRole; // เฉพาะบทบาทนี้
};

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "ของฉัน",
    items: [
      { key: "home", href: "/", label: "หน้าหลัก", desc: "ภาพรวมของฉัน", icon: "home" },
      { key: "profile", href: "/profile", label: "ข้อมูลของฉัน", desc: "ข้อมูลส่วนตัวและรหัสผ่าน", icon: "user" },
    ],
  },
  {
    title: "พนักงาน",
    items: [
      { key: "employees", href: "/employees", label: "ทะเบียนพนักงาน", desc: "ข้อมูล ทักษะ ลาออก นำเข้า Excel", icon: "users", minRole: "supervisor" },
      { key: "organization", href: "/organization", label: "ผังองค์กร", desc: "อัตรากำลังเทียบคนจริง", icon: "grid", minRole: "supervisor" },
    ],
  },
  {
    title: "จัดการ",
    items: [
      { key: "users", href: "/users", label: "ผู้ใช้และสิทธิ์", desc: "บทบาท คลัง และรีเซ็ตรหัสผ่าน", icon: "key", minRole: "admin" },
      { key: "warehouses", href: "/warehouses", label: "คลัง", desc: "รายชื่อคลังและพิกัด", icon: "warehouse", minRole: "admin" },
      { key: "settings", href: "/settings", label: "ตั้งค่าตัวเลือก", desc: "ตำแหน่ง รหัสกะ ประเภทลา", icon: "gear", minRole: "admin" },
      { key: "audit", href: "/audit", label: "ประวัติการใช้งาน", desc: "ใครทำอะไร เมื่อไร", icon: "clock", minRole: "admin" },
    ],
  },
];

export function navFor(role: AppRole) {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.minRole || ROLE_RANK[role] >= ROLE_RANK[i.minRole]) && (!i.onlyRole || i.onlyRole === role)),
  })).filter((g) => g.items.length);
}

// ปุ่มบนแถบล่างของมือถือ (ที่เหลืออยู่ในปุ่ม "เมนู")
export function bottomKeys(role: AppRole): string[] {
  return ROLE_RANK[role] >= 3 ? ["home", "employees", "users"] : ROLE_RANK[role] >= 2 ? ["home", "employees", "profile"] : ["home", "profile"];
}

export function activeKey(pathname: string): string | null {
  if (pathname === "/") return "home";
  for (const g of NAV_GROUPS) for (const i of g.items) if (i.href !== "/" && pathname.startsWith(i.href)) return i.key;
  return null;
}
