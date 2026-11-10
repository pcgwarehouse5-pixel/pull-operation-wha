import ShiftsPage from "../ShiftsPage";

// ตารางกะหัวหน้าคลัง (แยกจากตารางกะปกติ) · หน้านี้ต้องรอเช็กการล็อกอินก่อนแสดงผล
export const instant = false;

export default function Page() {
  return <ShiftsPage scope="lead" />;
}
