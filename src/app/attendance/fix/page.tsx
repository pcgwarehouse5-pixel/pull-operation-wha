import AttendancePage from "../AttendancePage";
import { NoTimekeepingGuard } from "@/components/NoTimekeepingGuard";

// เมนู "ขอแก้เวลา": หน้าลงเวลาเดิม แต่เปิดฟอร์มขอแก้เวลาของวันนี้ให้ทันที (ลืมกดเข้า-ออก / GPS ใช้ไม่ได้)
export const instant = false;

export default function Page() {
  return (
    <NoTimekeepingGuard>
      <AttendancePage openFix />
    </NoTimekeepingGuard>
  );
}
