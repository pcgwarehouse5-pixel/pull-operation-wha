import EmployeePage from "./EmployeePage";

// หน้านี้ต้องรอเช็กการล็อกอินก่อนแสดงผล จึงไม่ใช่หน้าที่ "แสดงได้ทันที"
export const instant = false;

export default async function Page({ params }: PageProps<"/employees/[id]">) {
  const { id } = await params;
  return <EmployeePage id={id} />;
}
