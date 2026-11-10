// โลโก้แอป "คลังรวมพลัง": หลังคาคลัง + ทีมงาน 3 คน + แถบขาว-แดงแบบขอบเสื้อโปโล (ต้นฉบับ public/brand/logo.svg)
export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#1B2A5C" />
      <path d="M11 29 L32 13 L53 29" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19" cy="37.5" r="4.2" fill="#9FB3E0" />
      <path d="M11 50.5a8 8 0 0 1 16 0Z" fill="#9FB3E0" />
      <circle cx="45" cy="37.5" r="4.2" fill="#9FB3E0" />
      <path d="M37 50.5a8 8 0 0 1 16 0Z" fill="#9FB3E0" />
      <circle cx="32" cy="33.5" r="5.5" fill="#fff" />
      <path d="M21.5 50.5a10.5 10.5 0 0 1 21 0Z" fill="#fff" />
      <rect x="12" y="53.6" width="40" height="1.6" rx=".8" fill="#fff" />
      <rect x="12" y="56.2" width="40" height="3" rx="1.5" fill="#D72638" />
    </svg>
  );
}
