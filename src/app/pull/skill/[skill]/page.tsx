import PullSkillPage from "./PullSkillPage";

// หน้านี้ต้องรอเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที"
export const instant = false;

export default async function Page({ params }: PageProps<"/pull/skill/[skill]">) {
  const { skill } = await params;
  let name = skill;
  try {
    name = decodeURIComponent(skill);
  } catch {
    // ชื่อไม่ได้เข้ารหัส ใช้ตามเดิม
  }
  return <PullSkillPage skill={name} />;
}
