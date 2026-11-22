// แถบกำลังโหลด: การกดลิงก์นี้เป็นการเปลี่ยนหน้าในแอปไหม (ทดสอบด้วย tests/perf-helpers.test.mjs)
type ClickInfo = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

/** คืน path ปลายทางเมื่อเป็นการเปลี่ยนหน้าในแอปแท็บเดิม · อย่างอื่น (ลิงก์นอก แท็บใหม่ ดาวน์โหลด หน้าเดิม) คืน null */
export function navTargetPath(href: string | null, currentHref: string, click: ClickInfo, target = "", download = false): string | null {
  if (!href || download || (target && target !== "_self")) return null;
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  let to: URL;
  let now: URL;
  try {
    now = new URL(currentHref);
    to = new URL(href, now);
  } catch {
    return null;
  }
  if (to.origin !== now.origin || to.pathname === now.pathname) return null;
  return to.pathname;
}
