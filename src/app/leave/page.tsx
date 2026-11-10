import LeavePage from "./LeavePage";
import { NoTimekeepingGuard } from "@/components/NoTimekeepingGuard";

// หน้านี้ต้องรอเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที"
export const instant = false;

export default function Page() {
  return (
    <NoTimekeepingGuard>
      <LeavePage />
    </NoTimekeepingGuard>
  );
}
