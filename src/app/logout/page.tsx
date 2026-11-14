import LogoutPage from "./LogoutPage";

// ลิงก์ออกจากระบบสำรอง: เปิด /logout แล้วออกจากระบบในเครื่องนี้ทันที (ใช้เมื่อปุ่มในแอปกดไม่ได้)
export const instant = false;

export default function Page() {
  return <LogoutPage />;
}
