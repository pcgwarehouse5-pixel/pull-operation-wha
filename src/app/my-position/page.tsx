import MyPositionPage from "./MyPositionPage";
import { NoTimekeepingGuard } from "@/components/NoTimekeepingGuard";
import { ModuleGuard } from "@/components/ModuleGuard";

// หน้านี้ต้องรอเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที"
export const instant = false;

export default function Page() {
  return (
    <NoTimekeepingGuard>
      <ModuleGuard module="pull">
        <MyPositionPage />
      </ModuleGuard>
    </NoTimekeepingGuard>
  );
}
