// หน้าชั่วคราวระหว่างพัฒนา จะถูกแทนด้วยหน้าล็อกอินในโมดูล 0
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">WHA Workforce</h1>
      <p className="text-base text-muted">
        แอปกลางบริหารพนักงานคลังสินค้า WHA (คลัง 5, คลัง 32, คลัง 29, คลัง Ecommerce)
      </p>
      <div className="rounded-xl border border-border bg-card p-4 text-base">
        กำลังพัฒนา: โมดูล 0 (ล็อกอิน บทบาทและสิทธิ์ จัดการคลัง)
      </div>
    </main>
  );
}
