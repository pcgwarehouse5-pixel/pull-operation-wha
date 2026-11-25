// ตัววาดแผนที่คลัง 3D (Digital Twin) สำหรับหน้าผังตำแหน่ง
// แปลงจาก map3d.js ของชุด Export แผนที่ 3D (IOT Dashboard) ให้เป็นโมดูลของแอปนี้ · รายละเอียดผังและรูปทรงเหมือนเดิม
// ที่ปรับ: ใช้ three จากแพ็กเกจ (ไม่โหลดจากเว็บนอก) · ไม่มีตัวแปรกลางของหน้าเว็บ · สร้าง/ทำลายได้ตามคอมโพเนนต์
//          ใช้วัสดุร่วมกัน + รวมชิ้นส่วนที่อยู่นิ่งเป็นก้อนเดียวต่อวัสดุ (วาดเร็วขึ้นมาก) · มือถือลดความละเอียดเงา/จอ
//          วาดเฉพาะตอนภาพเปลี่ยน และหยุดเมื่อแผนที่พ้นจอหรือสลับแท็บ · ตัดส่วนที่หน้านี้ไม่ใช้ (หมุดเซนเซอร์ Heatmap คลัง WH29)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WAREHOUSE_MAPS } from "./maps";
import type { ViewMode, WhMap } from "./types";

/** ตัวคนบนแผนที่ (หน้าผังตำแหน่ง) · x/y = พิกัดผัง */
export type PersonObj = {
  id: string;
  x: number;
  y: number;
  color: string;
  label: string;
  group: string;
  groupLabel: string;
  /** บรรทัดที่ 2 ของป้าย เช่น "พัก 12:00" · สีพื้น/สีตัวอักษรของแถบนั้น */
  sub?: string;
  subBg?: string;
  subFg?: string;
};
/** หัวภาพที่บันทึก: ชื่อผัง + รายการตำแหน่ง (สี) */
export type Shot = { title: string; legend: { label: string; color: string }[] };
export type Move = { id: string; x: number; y: number };

export type Warehouse3D = {
  show(key: string): void;
  view(mode?: ViewMode): void;
  lock(on: boolean): boolean;
  /** วางตัวคน (แทนชุดเดิมทั้งหมด) */
  setPeople(list: PersonObj[]): void;
  /** โหมดจัดตำแหน่ง: ลากตัวคน/ป้ายชื่อ/ป้ายกลุ่มได้ */
  setEditing(on: boolean): void;
  /** ลากวางเสร็จ → ตำแหน่งใหม่ของคนที่ย้าย */
  onMove: ((moves: Move[]) => void) | null;
  /** แตะป้ายชื่อ (ไม่ได้ลาก) */
  onTap: ((id: string) => void) | null;
  /** ซูมกล้องพอดีตัวคนที่แสดงอยู่ (true) หรือกลับทั้งคลัง (false) */
  focus(on: boolean): void;
  /** ภาพแผนที่ความละเอียดสูง + ป้ายชื่อ + หัวกระดาษ (PNG) */
  snapshot(shot: Shot): Promise<Blob | null>;
  dispose(): void;
};

/* สีหลัก: เสาฟ้าสด · คานส้มสด · สินค้าหลายสี (ลังน้ำตาลอ่อน + ฟิล์มสี) */
const COL = { navy: 0x1670e0, beam: 0xff6a00, wood: 0xd9a066, box: [0xd9ac72, 0xe8c48e, 0xeef2f6, 0xd9ac72, 0xf3c623, 0xe8c48e, 0xdfe6ee, 0xc99a5b, 0xf3c623, 0x4a86d9, 0xd9ac72, 0xe0533d] };
const TH = { bg: 0xe9f0f7, ground: 0xdfe7ef, floor: 0xf6f9fc };

type MatOpts = { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number; side?: THREE.Side; depthWrite?: boolean };
type Mover = THREE.Group;

function rand(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function createWarehouse3D(el: HTMLElement, opt: { mobile: boolean; font?: string }): Warehouse3D {
  const MAPS = WAREHOUSE_MAPS;
  const FONT = opt.font || "'IBM Plex Sans Thai Looped', sans-serif";
  let LOCKED = true;
  let EDIT = false;
  /* โฟกัส = กล้องซูมพอดีตัวคนที่แสดงอยู่ (ใช้ตอนกรองทีละตำแหน่ง) */
  let FOCUS = false;
  let cur: string | null = null;
  let VMODE: ViewMode = "3d";
  let needs = true;
  let raf = 0;
  let onScreen = true;
  let root: THREE.Group | null = null;

  /* ---------- วัสดุร่วม (สีและค่าเดียวกัน = วัสดุชิ้นเดียว) ---------- */
  const matCache = new Map<string, THREE.Material>();
  const stdMat = (p: THREE.MeshStandardMaterialParameters) => {
    const k = "s" + JSON.stringify(p);
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial(p);
      m.userData.shared = true;
      matCache.set(k, m);
    }
    return m;
  };
  const basicMat = (color: number) => {
    const k = "b" + color;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      m.userData.shared = true;
      matCache.set(k, m);
    }
    return m;
  };

  /* ---------- ตัววาด กล้อง แสง ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opt.mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  el.prepend(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(TH.bg);
  scene.fog = new THREE.Fog(TH.bg, 4000, 9000);
  const fog = scene.fog;
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  /* ควบคุมแบบแผนที่: ลากซ้าย/นิ้วเดียว = เลื่อน · ลากขวา/สองนิ้ว = หมุน (จำกัดมุม) · ล้อ/บีบ = ซูม · มุมก้ม 20–70° */
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.minPolarAngle = Math.PI * 0.02;
  controls.maxPolarAngle = Math.PI * 0.39;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.5;
  controls.panSpeed = 0.9;
  controls.zoomSpeed = 0.9;
  const applyLock = () => {
    controls.enabled = !LOCKED;
    /* ล็อกอยู่ = ปล่อยให้เลื่อนหน้าเว็บผ่านแผนที่ได้ (มือถือ) */
    /* โหมดจัดตำแหน่ง = แผนที่รับนิ้วเองทั้งหมด (ลากตัวคนบนมือถือได้) */
    canvas.style.touchAction = LOCKED && !EDIT ? "pan-y" : "none";
  };
  applyLock();
  controls.addEventListener("change", () => {
    needs = true;
    const M = cur ? MAPS[cur] : null;
    const B = M ? M.view || M.bounds : null;
    if (!B) return;
    const t = controls.target;
    const cx = Math.min(Math.max(t.x, B[0]), B[2]);
    const cz = Math.min(Math.max(t.z, B[1]), B[3]);
    if (cx !== t.x || cz !== t.z) {
      const dx = cx - t.x, dz = cz - t.z;
      t.x = cx;
      t.z = cz;
      camera.position.x += dx;
      camera.position.z += dz;
    }
  });
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c6d4, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opt.mobile ? 1024 : 2048, opt.mobile ? 1024 : 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const sizeToEl = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return false;
    const c = renderer.getSize(new THREE.Vector2());
    if (c.x !== w || c.y !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needs = true;
    }
    return true;
  };
  const ro = new ResizeObserver(() => {
    if (sizeToEl() && LOCKED && cur) view();
    needs = true;
  });
  ro.observe(el);
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; if (onScreen) needs = true; }) : null;
  io?.observe(el);

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!onScreen || document.hidden) return;
    if (controls.update() || needs) {
      renderer.render(scene, camera);
      placeLabels();
      needs = false;
    }
  }

  /* ---------- ชิ้นส่วนพื้นฐาน ---------- */
  const box = (w: number, h: number, d: number, c: number, o: MatOpts = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat({ color: c, roughness: 0.8, metalness: 0.05, ...o }));
    m.castShadow = m.receiveShadow = !o.transparent;
    return m;
  };
  const cyl = (r: number, h: number, seg: number, color: number, o: MatOpts = {}) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), stdMat({ color, ...o }));
  const add = (o: THREE.Object3D) => root!.add(o);

  function textSprite(t: string, size: number, color = "#0b2a4a", bg: string | null = null) {
    const c = document.createElement("canvas"), x = c.getContext("2d")!, f = `700 ${size}px ${FONT}`;
    x.font = f;
    c.width = Math.ceil(x.measureText(t).width) + size;
    c.height = size * 1.6;
    x.font = f;
    if (bg) {
      x.fillStyle = bg;
      x.beginPath();
      const r = size * 0.4, W = c.width, H = c.height;
      if (typeof x.roundRect === "function") x.roundRect(0, 0, W, H, r);
      else {
        /* Safari รุ่นเก่ายังไม่มี roundRect */
        x.moveTo(r, 0); x.arcTo(W, 0, W, H, r); x.arcTo(W, H, 0, H, r); x.arcTo(0, H, 0, 0, r); x.arcTo(0, 0, W, 0, r); x.closePath();
      }
      x.fill();
    }
    x.fillStyle = color;
    x.textBaseline = "middle";
    x.fillText(t, size / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  /* Mezzanine เหล็กฟ้า 2 ชั้น: เสา · พื้นชั้นบน · ราวกันตก + ตะแกรง · ลังบนชั้นบน · บันไดลิงกรงส้ม · โต๊ะแพ็กด้านล่าง */
  function mezzanine(z: NonNullable<WhMap["mezz"]>[number], P: number) {
    const [x, y, w, h] = z.r, H = P * (z.h || 3.6), blue = 0x1f63d6, R = rand(911);
    for (let xx = x; xx <= x + w + 0.1; xx += w / Math.max(1, Math.round(w / (P * 4))))
      for (let yy = y; yy <= y + h + 0.1; yy += h / Math.max(1, Math.round(h / (P * 6)))) { const c = box(P * 0.3, H, P * 0.3, blue); c.position.set(xx, H / 2, yy); add(c); }
    const deck = box(w, P * 0.25, h, 0x9aa6b4); deck.position.set(x + w / 2, H, y + h / 2); add(deck);
    for (const [a, b, c, d] of [[x, y, x + w, y], [x, y + h, x + w, y + h], [x, y, x, y + h], [x + w, y, x + w, y + h]]) {
      const L = Math.hypot(c - a, d - b), along = a === c;
      const bm = box(along ? P * 0.3 : L, P * 0.35, along ? L : P * 0.3, blue); bm.position.set((a + c) / 2, H - P * 0.1, (b + d) / 2); add(bm);
      const rl = box(along ? P * 0.12 : L, P * 0.1, along ? L : P * 0.12, blue); rl.position.set((a + c) / 2, H + P * 1.1, (b + d) / 2); add(rl);
      const mesh = box(along ? P * 0.05 : L, P * 1, along ? L : P * 0.05, 0x6f9fe8, { transparent: true, opacity: 0.35 }); mesh.position.set((a + c) / 2, H + P * 0.6, (b + d) / 2); add(mesh);
    }
    const n = Math.floor(w / (P * 1.3)), m = Math.floor(h / (P * 1.3));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      if (R() < 0.3) continue;
      const hh = P * (0.6 + R() * 1.4), b = box(P * 1.15, hh, P * 1.15, R() < 0.8 ? 0xd9ac72 : 0xe8c48e);
      b.position.set(x + ((i + 0.5) * w) / n, H + P * 0.13 + hh / 2, y + ((j + 0.5) * h) / m); add(b);
    }
    const lx = x - P * 0.5, ly = y + P * 0.8; // บันไดลิงกรงส้ม
    for (const dx of [-P * 0.3, P * 0.3]) { const r = box(P * 0.08, H + P * 1.2, P * 0.08, 0xf08a1c); r.position.set(lx + dx, (H + P * 1.2) / 2, ly); add(r); }
    for (let yy = P * 2; yy < H + P * 1.2; yy += P * 0.6) { const ring = box(P * 0.8, P * 0.06, P * 0.8, 0xf08a1c, { transparent: true, opacity: 0.6 }); ring.position.set(lx, yy, ly + P * 0.3); add(ring); }
    for (let k = 0; k < Math.floor(h / (P * 5)); k++) {
      const t = box(P * 1.8, P * 0.9, P * 0.9, 0xf2f4f7); t.position.set(x + w * 0.3, P * 0.45, y + P * 3 + k * P * 5); add(t);
      const bx = box(P * 1, P * 0.8, P * 1, 0xd9ac72); bx.position.set(x + w * 0.72, P * 0.4, y + P * 3.5 + k * P * 5); add(bx);
    }
    if (z.t) { const s = textSprite(z.t, P * 1.6, "#1f63d6", "rgba(255,255,255,.9)"); s.position.set(x + w / 2, H + P * 2.4, y + h / 2); add(s); }
  }

  /* ห้องประชุม/สำนักงาน 2 ชั้น: ผนังเขียวเทา · หน้าต่างกรอบดำ · ประตูกระจก · บันไดเหล็กดำด้านข้าง · ราวบนหลังคา */
  function meetingRoom(b: NonNullable<WhMap["bldg"]>[number], P: number) {
    const [x, y, w, h] = b.r, H = P * (b.h || 7), col = b.c || 0x9fb5a6, face = b.face || "w";
    const body = box(w, H, h, col, { roughness: 0.9 }); body.position.set(x + w / 2, H / 2, y + h / 2); add(body);
    const fx = face === "w" ? x - P * 0.05 : x + w + P * 0.05, nW = Math.max(2, Math.floor(h / (P * 5)));
    for (let i = 0; i < nW; i++) {
      const zc = y + ((i + 0.6) * h) / (nW + 0.4);
      for (const [y0, hh] of [[P * 1.2, P * 1.4], [P * 4.2, P * 1.7]]) {
        const fr = box(P * 0.12, hh + P * 0.15, P * 2.2, 0x15181c); fr.position.set(fx, y0 + hh / 2, zc); add(fr);
        const gl = box(P * 0.14, hh, P * 2, 0x2b3f55, { metalness: 0.5, roughness: 0.2 }); gl.position.set(fx, y0 + hh / 2, zc); add(gl);
      }
    }
    const door = box(P * 0.14, P * 2.4, P * 1.8, 0x7fa8c4, { transparent: true, opacity: 0.75 }); door.position.set(fx, P * 1.2, y + h - P * 2.5); add(door);
    const df = box(P * 0.16, P * 2.6, P * 2, 0x15181c); df.position.set(fx + (face === "w" ? -P * 0.02 : P * 0.02), P * 1.3, y + h - P * 2.5); add(df);
    for (let k = 0; k < 14; k++) { const st = box(P * 1.1, P * 0.12, P * 0.35, 0x1b1d21); st.position.set(fx + (face === "w" ? -P * 0.7 : P * 0.7), ((k + 1) * H) / 14, y + h + P * 0.3 + k * P * 0.32); add(st); }
    const rail = box(P * 0.08, P * 1, h, 0x1b1d21); rail.position.set(fx, H + P * 0.5, y + h / 2); add(rail);
    if (b.t) { const s = textSprite(b.t, P * 1.6, "#2d3e33", "rgba(255,255,255,.9)"); s.position.set(x + w / 2, H + P * 0.3, y + h / 2); add(s); }
  }

  /* กลุ่มชิ้นส่วนที่จัดตำแหน่งในหน่วยเมตร (คูณ P) */
  const grp = (P: number) => {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, col: number, px: number, py: number, pz: number, o?: MatOpts) => { const m = box(w * P, h * P, d * P, col, o); m.position.set(px * P, py * P, pz * P); g.add(m); return m; };
    return { g, part };
  };

  /* รถโฟล์คลิฟท์ (Counterbalance) · ตัวรถเหลือง · เสายก · งา · หลังคากันของตก · ล้อ */
  function forklift(x: number, z: number, r: number, c = 0xffb300, P: number): Mover {
    const { g, part } = grp(P);
    part(1.15, 0.9, 2.1, c, 0, 0.75, 0); part(1.1, 0.7, 0.55, 0x2b2f36, 0, 1.0, 0.95);
    part(0.12, 2.3, 0.12, 0x2b2f36, -0.4, 1.15, -1.1); part(0.12, 2.3, 0.12, 0x2b2f36, 0.4, 1.15, -1.1);
    part(0.12, 0.06, 1.1, 0x9aa3ad, -0.3, 0.25, -1.7); part(0.12, 0.06, 1.1, 0x9aa3ad, 0.3, 0.25, -1.7);
    part(1.05, 0.06, 1.2, 0x2b2f36, 0, 2.2, 0.05);
    for (const sx of [-0.48, 0.48]) for (const sz of [-0.1, 0.2]) part(0.06, 1, 0.06, 0x2b2f36, sx, 1.7, sz * 3);
    part(0.45, 0.35, 0.4, 0x1d2a3a, 0, 1.35, 0.2);
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.65, 0.7]) { const w = cyl(0.28 * P, 0.25 * P, 12, 0x15171a); w.rotation.z = Math.PI / 2; w.position.set(sx * P, 0.28 * P, sz * P); g.add(w); }
    g.position.set(x, 0, z); g.rotation.y = r;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    add(g);
    return g;
  }

  /* รถเทรลเลอร์ (หัวลาก + ตู้) · ตู้ยาวไปทาง +z */
  function trailer(x: number, z: number, r: number, rr: number, P: number) {
    const L = P * 12, Wt = P * 2.5, Ht = P * 3.9, g = new THREE.Group(), col = [0xf3f5f8, 0x2f6fb5, 0xd9541e][Math.floor(rr * 3)];
    const tr = box(Wt, Ht, L, col); tr.position.set(0, Ht / 2 + P * 1.1, L / 2 + P * 0.7); g.add(tr);
    const ch = box(Wt * 0.9, P * 0.5, L * 0.9, 0x3a3f46); ch.position.set(0, P * 0.8, L / 2 + P * 0.7); g.add(ch);
    const cab = box(Wt, P * 3, P * 2.6, 0xe9edf2); cab.position.set(0, P * 1.9, L + P * 2.3); g.add(cab);
    const ws = box(Wt * 0.92, P * 1, P * 0.1, 0x1d2a3a); ws.position.set(0, P * 2.6, L + P * 3.62); g.add(ws);
    for (const zz of [L * 0.2, L * 0.3, L + P * 1.6, L + P * 3.1]) for (const sx of [-1, 1]) { const w = cyl(P * 0.5, P * 0.35, 14, 0x1b1d21); w.rotation.z = Math.PI / 2; w.position.set(sx * Wt * 0.45, P * 0.5, zz); g.add(w); }
    g.position.set(x, 0, z); g.rotation.y = r;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
    add(g);
  }

  /* รถบรรทุกตู้ทึบ 6 ล้อ / 10 ล้อ สีเดียว (WH32 · M.rigid) */
  function rigidTruck(x: number, z: number, r: number, rr: number, P: number, M: WhMap) {
    const ten = rr >= 0.5, L = P * (ten ? 9.2 : 6.6), Wt = P * 2.45, Ht = P * (ten ? 3.4 : 3.1), g = new THREE.Group(), col = M.truckCol ?? 0xa3a9b1;
    const bx = box(Wt, Ht, L, col, { roughness: 0.6 }); bx.position.set(0, Ht / 2 + P * 1.15, L / 2 + P * 0.6); g.add(bx);
    const rib = box(Wt * 1.01, P * 0.12, L, 0x8a9098); rib.position.set(0, P * 1.2, L / 2 + P * 0.6); g.add(rib);
    const ch = box(Wt * 0.8, P * 0.45, L + P * 1.6, 0x2f343b); ch.position.set(0, P * 0.85, L / 2 + P * 1.3); g.add(ch);
    const cab = box(Wt, P * 2.7, P * 2.2, 0xc5cad1); cab.position.set(0, P * 1.95, L + P * 1.95); g.add(cab);
    const ws = box(Wt * 0.9, P * 0.95, P * 0.1, 0x1d2a3a); ws.position.set(0, P * 2.6, L + P * 3.07); g.add(ws);
    const ax = ten ? [L * 0.62, L * 0.78, L + P * 2.1] : [L * 0.72, L + P * 2.1];
    for (const az of ax) for (const sx of [-1, 1]) { const w = cyl(P * 0.48, P * (az > L ? 0.3 : 0.55), 14, 0x1b1d21); w.rotation.z = Math.PI / 2; w.position.set(sx * Wt * 0.42, P * 0.48, az); g.add(w); }
    g.position.set(x, 0, z); g.rotation.y = r; add(g);
  }
  const truckAt = (x: number, z: number, r: number, rr: number, P: number, M: WhMap) => (M.rigid ? rigidTruck(x, z, r, rr, P, M) : trailer(x, z, r, rr, P));

  /* อุปกรณ์โหลดหน้าประตู Dock: robot = Robot Arm + Conveyor · gravity = สายพานลูกกลิ้ง · mobile = สายพานล้อลาก */
  function dockEquip(d: NonNullable<WhMap["docks"]>[number], y: number, P: number) {
    const { g, part } = grp(P);
    const steel = { metalness: 0.5, roughness: 0.4 };
    if (d.eq === "robot") {
      for (let k = 0; k < 6; k++) part(0.9, 0.25, 1.6, 0x2b2f36, 0, 1.0, -1 - k * 1.6);
      part(0.95, 0.08, 9.6, 0x1b1d21, 0, 1.16, -5.3);
      for (const sx of [-0.5, 0.5]) part(0.1, 0.45, 9.6, 0xc9ced4, sx, 1.05, -5.3, steel);
      for (let k = 0; k < 5; k++) for (const sx of [-0.4, 0.4]) part(0.1, 1, 0.1, 0x9aa3ad, sx, 0.5, -1.5 - k * 2.1, steel);
      part(0.85, 0.2, 4, 0x2b2f36, 0, 1.05, 2.2);
      const by = 0, bz = -1.6;
      part(1.5, 0.5, 1.5, 0x3a3f46, 1.4, by + 0.25, bz); part(1.1, 1, 1.1, 0xf29a05, 1.4, by + 1, bz);
      const a1 = part(0.5, 2.8, 0.5, 0xf2b705, 1.4, by + 2.7, bz + 0.5); a1.rotation.x = 0.35;
      const a2 = part(0.45, 0.45, 2.6, 0xf2b705, 1.0, by + 3.9, bz + 2.2); a2.rotation.x = 0.3; a2.rotation.y = -0.35;
      part(0.9, 0.6, 0.4, 0x2b2f36, 0.6, by + 3.2, bz + 3.4);
      const lb = textSprite(d.lb || "Robot Arm", P * 1.5, "#8a4b00", "rgba(255,255,255,.9)"); lb.position.set(0, P * 5.2, -P * 4); g.add(lb);
    } else if (d.eq === "gravity") {
      const n = 18, len = 8;
      for (const sx of [-0.55, 0.55]) { const rl = part(0.12, 0.22, len, 0xb8c0c8, sx, 0, -len / 2 - 0.4, steel); rl.position.y = P * 0.95; rl.rotation.x = -0.05; }
      for (let k = 0; k < n; k++) { const zz = -0.6 - (k * (len - 0.4)) / (n - 1), r = cyl(P * 0.09, P * 1.05, 10, 0x8e979f, steel); r.rotation.z = Math.PI / 2; r.position.set(0, P * (1 + -zz * 0.05 - 0.05), zz * P); g.add(r); }
      for (let k = 0; k < 4; k++) for (const sx of [-0.55, 0.55]) part(0.1, 0.9 + k * 0.12, 0.1, 0x6f7883, sx, (0.9 + k * 0.12) / 2, -1 - k * 2.3, steel);
      const lb = textSprite(d.lb || "Gravity", P * 1.5, "#3c4a68", "rgba(255,255,255,.9)"); lb.position.set(0, P * 3.4, -P * 4.5); g.add(lb);
    } else if (d.eq === "mobile") {
      const len = 7, belt = new THREE.Group();
      const fr = box(1.1 * P, 0.35 * P, len * P, 0x2f6fb5, steel); belt.add(fr);
      const bt = box(0.95 * P, 0.06 * P, len * P, 0x15171a); bt.position.y = 0.2 * P; belt.add(bt);
      belt.position.set(0, P * 1.35, -P * (len / 2 + 0.3)); belt.rotation.x = -0.12; g.add(belt);
      part(1.4, 0.25, 2.2, 0x3a3f46, 0, 0.55, -len * 0.62);
      for (const sx of [-0.6, 0.6]) part(0.12, 1.1, 0.12, 0x6f7883, sx, 1.05, -len * 0.62, steel);
      for (const sx of [-0.65, 0.65]) for (const sz of [-0.8, 0.8]) { const w = cyl(P * 0.32, P * 0.22, 12, 0x15171a); w.rotation.z = Math.PI / 2; w.position.set(sx * P, P * 0.32, (-len * 0.62 + sz) * P); g.add(w); }
      part(0.08, 0.08, 1.6, 0x9aa3ad, 0, 0.7, -len * 0.62 - 1.8, steel);
      const lb = textSprite(d.lb || "ล้อลาก", P * 1.5, "#1f4fa8", "rgba(255,255,255,.9)"); lb.position.set(0, P * 3.6, -P * 4.5); g.add(lb);
    } else return;
    g.position.set(d.x, 0, y); add(g);
  }

  /* รถเก๋ง / มอเตอร์ไซค์ (ภายนอกคลัง) */
  function car(x: number, z: number, r: number, c: number, P: number) {
    const { g, part } = grp(P);
    part(1.8, 0.75, 4.4, c, 0, 0.6, 0, { metalness: 0.4, roughness: 0.4 }); part(1.6, 0.6, 2.3, 0x24303d, 0, 1.25, -0.1, { metalness: 0.5, roughness: 0.2 }); part(1.55, 0.08, 2.2, c, 0, 1.58, -0.1);
    for (const sx of [-0.82, 0.82]) for (const sz of [-1.4, 1.4]) { const w = cyl(0.34 * P, 0.22 * P, 12, 0x15171a); w.rotation.z = Math.PI / 2; w.position.set(sx * P, 0.34 * P, sz * P); g.add(w); }
    g.position.set(x, 0, z); g.rotation.y = r;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    add(g);
  }
  function moto(x: number, z: number, c: number, P: number) {
    const { g, part } = grp(P);
    part(0.35, 0.45, 1.5, c, 0, 0.55, 0); part(0.3, 0.15, 0.7, 0x1b1d21, 0, 0.85, 0.2); part(0.08, 0.6, 0.08, 0x9aa3ad, 0, 0.9, -0.6); part(0.15, 0.5, 0.5, 0x15171a, 0, 0.25, -0.65); part(0.15, 0.5, 0.5, 0x15171a, 0, 0.25, 0.65);
    g.position.set(x, 0, z); add(g);
  }

  /* สำนักงานชั้นเดียว: ผนังเทาอ่อน · บัวหลังคาน้ำเงินยื่น · เสาใหญ่น้ำเงิน · หน้าต่างกรอบดำ · ทางลาดราวเหลืองดำ · บันไดราวสแตนเลส · ขอบฟุตบาทแดงขาว */
  function officeBldg(o: NonNullable<WhMap["ofb"]>[number], P: number) {
    const [x, y, w, h] = o.r, Hb = P * 4.2, fz = y + h;
    const pl = box(w, P * 0.9, h, 0x8e9aab); pl.position.set(x + w / 2, P * 0.45, y + h / 2); add(pl);
    const wl = box(w, Hb - P * 0.9, h, 0xe3e6e8, { roughness: 0.9 }); wl.position.set(x + w / 2, P * 0.9 + (Hb - P * 0.9) / 2, y + h / 2); add(wl);
    const rf = box(w + P * 1.6, P * 0.3, h + P * 2.4, 0xd9dde2); rf.position.set(x + w / 2, Hb + P * 0.15, y + h / 2 + P * 0.6); add(rf);
    for (const [fw, fd, px, pz] of [[w + P * 1.6, P * 0.25, x + w / 2, fz + P * 1.8], [P * 0.25, h + P * 2.4, x - P * 0.8, y + h / 2 + P * 0.6], [P * 0.25, h + P * 2.4, x + w + P * 0.8, y + h / 2 + P * 0.6]]) {
      const fa = box(fw, P * 0.9, fd, 0x1f4fa8); fa.position.set(px, Hb - P * 0.1, pz); add(fa);
    }
    const col = box(P * 2, Hb, P * 1.4, 0x1f4fa8); col.position.set(x + w * 0.45, Hb / 2, fz + P * 1.1); add(col);
    for (let i = 0; i < 7; i++) {
      if (i === 3) continue;
      const wx = x + P * 2 + (i * (w - P * 4)) / 6.2, win = box(P * 3.2, P * 1.6, P * 0.12, 0x1f2a36, { metalness: 0.5, roughness: 0.2 });
      win.position.set(wx + P * 1.6, P * 2.4, fz + P * 0.02); add(win);
    }
    const dr = box(P * 1.8, P * 2.3, P * 0.12, 0x15181c); dr.position.set(x + w * 0.62, P * 2.05, fz + P * 0.02); add(dr);
    for (let k = 0; k < 6; k++) { const s = box(P * 2.2, P * 0.15 * (6 - k), P * 0.35, 0xeceff2); s.position.set(x + w * 0.62, P * 0.075 * (6 - k), fz + P * 0.3 + k * P * 0.35); add(s); }
    for (const sx of [-1.2, 1.2]) { const rl = box(P * 0.08, P * 1, P * 2.2, 0xc9d1d9, { metalness: 0.8, roughness: 0.2 }); rl.position.set(x + w * 0.62 + sx * P, P * 1.1, fz + P * 1.2); add(rl); }
    const rp = box(w * 0.38, P * 0.5, P * 2.2, 0xa9b3bf); rp.position.set(x + w * 0.2, P * 0.25, fz + P * 1.3); rp.rotation.z = 0.05; add(rp);
    for (let i = 0; i < 12; i++) { const rx = x + (i * w * 0.38) / 11, po = box(P * 0.14, P * 1, P * 0.14, i % 2 ? 0x1b1d21 : 0xf2c200); po.position.set(rx, P * 0.9, fz + P * 2.35); add(po); }
    const hr = box(w * 0.38, P * 0.12, P * 0.14, 0xf2c200); hr.position.set(x + w * 0.19, P * 1.4, fz + P * 2.35); add(hr);
    for (let x2 = x + w * 0.4; x2 < x + w; x2 += P * 1) { const cb = box(P * 1, P * 0.3, P * 0.4, Math.floor((x2 - x) / P) % 2 ? 0xd9341e : 0xf6f6f6); cb.position.set(x2 + P * 0.5, P * 0.15, fz + P * 3); add(cb); }
    if (o.t) { const t = textSprite(o.t, P * 1.6, "#1f4fa8", "rgba(255,255,255,.92)"); t.position.set(x + w / 2, Hb + P * 0.5, y + h / 2); add(t); }
  }

  /* รอบอาคาร: ลานจอด/ถนน · ประตู Dock + เบอร์ + Dock leveler · รถจอดบาง Dock · หลังคา Canopy · รั้ว · ป้ายประตูทางเข้า */
  function siteDetail(M: WhMap) {
    const P = M.pxm, [x0, y0, x1, y1] = M.bounds;
    const flat = (x: number, y: number, w: number, h: number, c: number, yy = 0.4, o: MatOpts = {}) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stdMat({ color: c, roughness: 1, ...o }));
      m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, yy, y + h / 2); m.receiveShadow = true; add(m); return m;
    };
    const edge = box(x1 - x0 + 3, 3, y1 - y0 + 3, 0xcfd6de); edge.position.set((x0 + x1) / 2, -1.2, (y0 + y1) / 2); add(edge);
    for (const a of M.aprons || []) flat(a[0], a[1], a[2], a[3], a[4] || 0xd9dee4, 0.2);
    for (const r of M.roads || []) {
      flat(r[0], r[1], r[2], r[3], 0x4a5361, 0.3);
      for (let x = r[0] + 10; x < r[0] + r[2] - 20; x += 40) flat(x, r[1] + r[3] / 2 - 1, 20, 2, 0xf4f4f4, 0.5);
    }
    const DW = P * 3.2, DH = P * 4.4, R = rand(77 + (M.docks || []).length);
    for (const d of M.docks || []) {
      const x = d.x, y = d.y ?? y1;
      const sh = box(DW + P * 0.6, DH + P * 0.4, P * 0.5, 0x2b313a); sh.position.set(x, (DH + P * 0.4) / 2, y + P * 0.25); add(sh);
      const dr = box(DW, DH, P * 0.3, 0x9aa7b6, { metalness: 0.3 }); dr.position.set(x, DH / 2, y + P * 0.45); add(dr);
      const lv = box(DW * 0.9, P * 0.15, P * 2.4, 0x6f7883); lv.position.set(x, P * 0.1, y - P * 1.2); add(lv);
      flat(x - DW / 2, y + P * 1, DW, P * 0.25, 0xf2c200, 0.45);
      const n = textSprite(String(d.n), P * 1.6, "#0b2a4a", "rgba(255,255,255,.9)"); n.position.set(x, 0.8, y + P * 3); add(n);
      const rr = R();
      if (d.truck ?? (d.eq ? true : rr < (M.trucks ?? 0.45))) truckAt(x, y + P * 0.3, 0, R(), P, M);
      dockEquip(d, y, P);
    }
    /* Canopy โครงเหล็กดำ-ส้ม (ท่อนล่างเหลือง) ฐานคอนกรีต · หลังคาเมทัลชีทขาว · ยางกั้นเหลืองดำแนวเสา */
    for (const c of M.canopies || []) {
      const [cx, cy, cw, ch, ct] = c, Hc = P * 7, oy = cy + ch - 3;
      const rf = box(cw, P * 0.35, ch, 0xe9edf2, { metalness: 0.3 }); rf.position.set(cx + cw / 2, Hc, cy + ch / 2); add(rf);
      const ed = box(cw, P * 0.6, P * 0.3, 0x1b1d21); ed.position.set(cx + cw / 2, Hc - P * 0.3, oy + 3); add(ed);
      const n = Math.max(2, Math.round(cw / (P * 6)));
      for (let i = 0; i <= n; i++) {
        const x = cx + 3 + (i * (cw - 6)) / n;
        const bs = box(P * 1.1, P * 0.9, P * 1.1, 0xc9ced4); bs.position.set(x, P * 0.45, oy); add(bs);
        for (let k = 0; k < 6; k++) { const hh = (Hc - P * 0.9) / 6, col = k === 0 ? 0xf2b705 : k % 2 ? 0x1b1d21 : 0xf04e23; const sg = box(P * 0.45, hh, P * 0.45, col); sg.position.set(x, P * 0.9 + hh * (k + 0.5), oy); add(sg); }
        const br = box(P * 0.3, P * 0.3, ch * 0.55, 0xf04e23); br.position.set(x, Hc - P * 1.2, oy - ch * 0.3); br.rotation.x = 0.35; add(br);
      }
      for (let x = cx; x < cx + cw; x += P * 1.2) { const st = box(P * 1.1, P * 0.25, P * 0.5, Math.round((x - cx) / (P * 1.2)) % 2 ? 0x1b1d21 : 0xf2c200); st.position.set(x + P * 0.6, P * 0.12, oy + P * 1); add(st); }
      if (ct) { const t = textSprite(ct, P * 1.8, "#3c4a68"); t.position.set(cx + cw / 2, Hc + P * 0.4, cy + ch / 2); add(t); }
    }
    /* ด้านหน้า: รั้ว Chainlink สีฟ้า + Footpath ขอบแดงขาว · ที่จอดรถเรียงริมรั้ว · ช่องประตู Gate */
    const F = M.front;
    if (F) {
      const fy = F.fy, gaps = F.gaps || [], gw = F.gw || 40, inGap = (x: number) => gaps.some((g) => Math.abs(x - g) < gw / 2), Hf = P * 2.1;
      flat(x0, F.foot[0], x1 - x0, F.foot[1], 0xd5d9de, 0.5);
      for (let x = x0; x < x1; x += P * 1) { const cb = box(P * 1, P * 0.3, P * 0.4, Math.floor((x - x0) / P) % 2 ? 0xd9341e : 0xf6f6f6); cb.position.set(x + P * 0.5, P * 0.15, F.foot[0] + F.foot[1]); add(cb); }
      const segs: [number, number][] = [];
      let st = x0;
      for (const g of [...gaps].sort((a, b) => a - b)) { segs.push([st, g - gw / 2]); st = g + gw / 2; }
      segs.push([st, x1]);
      const meshMat = stdMat({ color: 0x3b82d6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      for (const [a, b] of segs) {
        if (b - a < 2) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, Hf), meshMat); m.position.set((a + b) / 2, Hf / 2, fy); add(m);
        const rl = box(b - a, P * 0.08, P * 0.08, 0x1f5fb8); rl.position.set((a + b) / 2, Hf, fy); add(rl);
        for (let x = a; x <= b; x += P * 3) { const po = box(P * 0.12, Hf, P * 0.12, 0x1f5fb8); po.position.set(x, Hf / 2, fy); add(po); }
      }
      const RR = rand(901 + Math.round(x0)), cols = [0xf4f5f7, 0x1d2026, 0xb7bec7, 0xf4f5f7, 0x3a4250, 0x9a1f1f];
      if (F.park) {
        const [p0, p1] = F.park;
        const near = (x: number, r: number[]) => x > r[0] - 10 && x < r[0] + r[2] + 10 && r[1] + r[3] > p0;
        const blocked = (x: number) => inGap(x) || (M.offices || []).some((o) => near(x, o as unknown as number[])) || [...(M.carport || []), ...(M.canteen || [])].some((o) => near(x, o.r));
        for (let x = x0 + P * 2; x < x1 - P * 2; x += P * 2.7) { if (blocked(x) || RR() < 0.4) continue; car(x, (p0 + p1) / 2, Math.PI, cols[Math.floor(RR() * cols.length)], P); }
        for (let x = x0; x < x1; x += P * 2.7) flat(x, p0, P * 0.15, p1 - p0, 0xf4f4f4, 0.55);
      }
      for (const t of F.trailers || []) truckAt(t.x, t.y, t.r ?? Math.PI / 2, t.c ?? RR(), P, M);
    }
    for (const o of M.ofb || []) officeBldg(o, P);
    for (const o of M.canteen || []) {
      const [x, y, w, h] = o.r, Hc = P * 3.6;
      const rf = box(w, P * 0.3, h, o.rc ?? 0xb3bcc6, { metalness: o.rc ? 0.1 : 0.4 }); rf.position.set(x + w / 2, Hc, y + h / 2); add(rf);
      const bk = box(w, Hc, P * 0.3, 0x9aa3ad); bk.position.set(x + w / 2, Hc / 2, y + P * 0.2); add(bk);
      if (o.shop !== false) { // ร้าน 7-Eleven (WH5)
        const sh = box(w * 0.3, P * 2.8, h * 0.45, 0xf4f6f8); sh.position.set(x + w * 0.82, P * 1.4, y + h * 0.25); add(sh);
        const sg = box(w * 0.3, P * 0.5, P * 0.1, 0x1a8f3c); sg.position.set(x + w * 0.82, P * 2.6, y + h * 0.48); add(sg);
      }
      const span = w * (o.shop === false ? 1 : 0.6), nt = Math.max(1, Math.min(3, Math.floor(span / (P * 3))));
      for (let i = 0; i < nt; i++) { const tb = box(P * 2.2, P * 0.75, P * 0.8, 0xf4f6f8); tb.position.set(x + ((i + 0.5) * span) / nt, P * 0.4, y + h * 0.55); add(tb); }
      for (let x2 = x; x2 < x + w; x2 += P * 1) { const cb = box(P * 1, P * 0.3, P * 0.4, Math.floor((x2 - x) / P) % 2 ? 0xd9341e : 0xf6f6f6); cb.position.set(x2 + P * 0.5, P * 0.15, y + h); add(cb); }
      if (o.t) { const t = textSprite(o.t, P * 1.4, "#3c4a68", "rgba(255,255,255,.9)"); t.position.set(x + w / 2, Hc + P * 0.3, y + h / 2); add(t); }
    }
    for (const o of M.carport || []) {
      const [x, y, w, h] = o.r, Hc = P * 3.4;
      const rf = box(w, P * 0.25, h, 0x6f7883, { metalness: 0.4 }); rf.position.set(x + w / 2, Hc, y + h / 2); rf.rotation.z = 0.04; add(rf);
      for (const px of [x + 3, x + w / 2, x + w - 3]) { const po = box(P * 0.3, Hc, P * 0.3, 0x3a3f46); po.position.set(px, Hc / 2, y + h - 4); add(po); }
      for (let i = 0; i < 6; i++) moto(x + 6 + i * P * 1, y + 8, [0xd9341e, 0x1d2026, 0xf4f5f7][i % 3], P);
      car(x + w * 0.6, y + h * 0.6, Math.PI / 2, 0x1d2026, P);
      if (o.t) { const t = textSprite(o.t, P * 1.4, "#3c4a68", "rgba(255,255,255,.9)"); t.position.set(x + w / 2, Hc + P * 0.3, y + h / 2); add(t); }
    }
    for (const f of M.forklifts || []) forklift(f.x, f.y, f.r || 0, f.c, P);
    /* เส้นพื้น: เส้นเหลืองแบ่งโซน / เส้นส้ม ([x1,y1,x2,y2,สี,หนา]) */
    for (const l of M.lines || []) {
      const [a, b, c, d, col = 0xf2c200, w = 1.6] = l, len = Math.hypot(c - a, d - b), m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), basicMat(col));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(d - b, c - a); m.position.set((a + c) / 2, 0.7, (b + d) / 2); add(m);
    }
    for (const z of M.mezz || []) mezzanine(z, P);
    for (const b of M.bldg || []) meetingRoom(b, P);
    /* การ์ดเสาชั้นวางเหลืองดำ */
    if (M.rackGuards) {
      const gs: [number, number][] = [];
      for (const [bx, by, bw, bh, t] of M.boxes) if (t === "rack") for (const yy of [by, by + bh]) for (const xx of [bx, bx + bw]) gs.push([xx, yy]);
      const m4 = new THREE.Matrix4();
      const ym = new THREE.InstancedMesh(new THREE.BoxGeometry(P * 0.45, P * 0.9, P * 0.45), new THREE.MeshStandardMaterial({ color: 0xf5c400 }), gs.length);
      gs.forEach(([x, z], i) => { m4.makeTranslation(x, P * 0.45, z); ym.setMatrixAt(i, m4); }); add(ym);
      const bk = new THREE.InstancedMesh(new THREE.BoxGeometry(P * 0.47, P * 0.18, P * 0.47), new THREE.MeshStandardMaterial({ color: 0x1b1d21 }), gs.length);
      gs.forEach(([x, z], i) => { m4.makeTranslation(x, P * 0.55, z); bk.setMatrixAt(i, m4); }); add(bk);
    }
    /* ยางกั้นล้อ */
    for (const w of M.stops || []) {
      const [x, ya, yb, step] = w;
      for (let y = ya; y < yb; y += step * P) {
        const m = box(P * 0.25, P * 0.12, P * 1.6, 0x1b1d21); m.position.set(x, P * 0.06, y); add(m);
        const s = box(P * 0.26, P * 0.13, P * 0.35, 0xf5c400); s.position.set(x, P * 0.065, y); add(s);
      }
    }
    /* พัดลมยักษ์ (HVLS) Ø ~7.3 ม. สูง ~12.5 ม. · ใบเหลือง ปลายดำ · ดุมแดง · ป้าย */
    for (const f of M.fans || []) {
      const g = new THREE.Group(), r = (P * (f.d || 7.3)) / 2, y = P * (f.h || 12.5), cm = { metalness: 0.6, roughness: 0.35 };
      const rod = box(P * 0.15, P * 1.6, P * 0.15, 0x9aa3ad, cm); rod.position.y = P * 0.8; g.add(rod);
      g.add(cyl(P * 0.45, P * 0.5, 16, 0xd9341e, cm));
      const lb = textSprite("Giant Fan", P * 1.5, "#0b2a4a", "rgba(250,204,21,.95)"); lb.position.set(0, P * 2.4, 0); g.add(lb);
      for (let k = 0; k < 6; k++) { const tip = box(r * 0.16, P * 0.1, P * 0.36, 0x1b1d21, cm); tip.position.set(r + P * 0.3 - r * 0.08, 0, 0); const a2 = new THREE.Group(); a2.rotation.y = (k * Math.PI) / 3 + (f.a || 0); a2.add(tip); g.add(a2); }
      for (let k = 0; k < 6; k++) { const bl = box(r, P * 0.08, P * 0.42, 0xfacc15, cm); bl.position.set(r / 2 + P * 0.3, 0, 0); const a = new THREE.Group(); a.rotation.y = (k * Math.PI) / 3 + (f.a || 0); a.add(bl); g.add(a); }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = false; });
      g.position.set(f.x, y, f.y); add(g);
    }
    /* อุปกรณ์หน้า Flow Rack ด้านใน: ทางม้าลาย · รถลากพาเลทเหลือง · เครื่อง Pallet Magazine */
    for (const o of M.props || []) {
      if (o.k === "cross") { for (let i = 0; i < 4; i++) flat(o.x, o.y + (i * (o.h || 0)) / 4, o.w || 0, (o.h || 0) / 8, 0xf4f4f4, 0.75); continue; }
      const { g, part } = grp(P);
      if (o.k === "jack") { part(0.18, 0.08, 1.15, 0xf2d000, -0.28, 0.06, 0.55); part(0.18, 0.08, 1.15, 0xf2d000, 0.28, 0.06, 0.55); part(0.7, 0.35, 0.3, 0xf2d000, 0, 0.2, -0.1); part(0.06, 1.1, 0.06, 0x1b1d21, 0, 0.8, -0.25); part(0.5, 0.06, 0.06, 0x1b1d21, 0, 1.35, -0.25); }
      if (o.k === "magazine") {
        part(2.2, 2.6, 1.8, 0x1f6fd0, 0, 1.3, 0); part(1.6, 0.12, 1.4, 0xf2c200, 0, 2.66, 0); part(1.2, 1.4, 0.3, 0xd9341e, -1.6, 0.7, 0.6);
        for (let k = 0; k < 8; k++) part(1.2, 0.13, 1.0, 0x1f4fa8, 0, 0.1 + k * 0.16, 1.6);
        const t = textSprite("Pallet Magazine", P * 1.1, "#1b1d21", "rgba(242,194,0,.95)"); t.position.set(0, P * 2.8, 0); g.add(t);
      }
      g.position.set(o.x, 0, o.y); g.rotation.y = o.r || 0;
      g.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
      add(g);
    }
    for (const g of M.gates || []) { const t = textSprite(g.t, P * 2.4, "#ffffff", "rgba(15,92,140,.92)"); t.position.set(g.x, 1, g.y); add(t); }
  }

  /* รวมชิ้นส่วนที่อยู่นิ่งและใช้วัสดุเดียวกันเป็นก้อนเดียว (ภาพเหมือนเดิม แต่วาดเร็วขึ้นมาก) */
  function mergeStatic(g: THREE.Group) {
    g.updateMatrixWorld(true);
    const buckets = new Map<string, THREE.Mesh[]>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      const mat = m.material as THREE.Material;
      if (Array.isArray(m.material) || !mat.userData.shared || mat.transparent) return;
      const k = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
      const list = buckets.get(k);
      if (list) list.push(m);
      else buckets.set(k, [m]);
    });
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const m4 = new THREE.Matrix4();
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        const geo = m.geometry.clone();
        geo.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
        return geo;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((x) => x.dispose());
      if (!merged) continue;
      const one = new THREE.Mesh(merged, list[0].material);
      one.castShadow = list[0].castShadow;
      one.receiveShadow = list[0].receiveShadow;
      for (const m of list) { m.removeFromParent(); m.geometry.dispose(); }
      g.add(one);
    }
    /* กลุ่มที่ว่างแล้ว (ชิ้นส่วนถูกรวมไปหมด) ตัดทิ้ง */
    const empty: THREE.Object3D[] = [];
    g.traverse((o) => { if (o !== g && (o as THREE.Group).isGroup && o.children.length === 0) empty.push(o); });
    empty.forEach((o) => o.removeFromParent());
  }

  function disposeTree(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
      if (!Array.isArray(m.material) && !mat.userData.shared) { mat.map?.dispose(); mat.dispose(); }
    });
  }

  /* ---------- สร้างคลัง ---------- */
  function build(key: string) {
    const M = MAPS[key];
    if (!M) return;
    if (root) { scene.remove(root); disposeTree(root); }
    root = new THREE.Group();
    scene.add(root);
    cur = key;
    const [x0, y0, x1, y1] = M.bounds, W = x1 - x0, D = y1 - y0, cx = (x0 + x1) / 2, cz = (y0 + y1) / 2, H = M.rackH;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, D * 3), new THREE.MeshStandardMaterial({ color: TH.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -1, cz); ground.receiveShadow = true; add(ground);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 4, D), new THREE.MeshStandardMaterial({ color: TH.floor, roughness: 0.9 }));
    floor.position.set(cx, -2, cz); floor.receiveShadow = true; add(floor);
    for (const z of M.zones || []) {
      const [zx, zy, zw, zh] = z.r, p = new THREE.Mesh(new THREE.PlaneGeometry(zw, zh), new THREE.MeshStandardMaterial({ color: z.c, roughness: 1 }));
      p.rotation.x = -Math.PI / 2; p.position.set(zx + zw / 2, 0.6, zy + zh / 2); p.receiveShadow = true; add(p);
      if (z.t) { const s = textSprite(z.t, Math.min(28, zh * 0.35) * (z.s || 1), "#b58500"); s.position.set(zx + zw / 2, 1.2, zy + zh / 2); add(s); }
    }
    siteDetail(M);
    for (const [ox, oy, ow, oh, t] of M.offices || []) {
      const o = box(ow, H * 0.45, oh, 0xdbe6f1); o.position.set(ox + ow / 2, H * 0.225, oy + oh / 2); add(o);
      const s = textSprite(t, 22); s.position.set(ox + ow / 2, H * 0.45 + 1, oy + oh / 2); add(s);
    }
    /* ชั้นวาง: เสา · คาน · พาเลท + กล่องสินค้า (วาดแบบ Instanced = หลายพันชิ้นในครั้งเดียว) */
    type B6 = [number, number, number, number, number, number];
    const ups: B6[] = [], beams: B6[] = [], pals: B6[] = [], goods: B6[] = [], shut: B6[] = [], shU: B6[] = [], shB: B6[] = [], shG: B6[] = [], yel: B6[] = [], blk: B6[] = [], blu: B6[] = [], roll: B6[] = [];
    const R = rand(key.length * 7919 + M.boxes.length);
    /* โซนสีชั้นวาง (rackZones): ชั้นวางในโซนใช้สีโซน + พื้นโซน + ป้ายท้ายแถว + ป้ายโซนลอย */
    const RZ = (M.rackZones || []).map((z) => ({ ...z, U: [] as B6[], B: [] as B6[], G: [] as B6[], rows: [] as number[][] }));
    const zoneOf = (x: number, y: number) => RZ.find((z) => x >= z.r[0] && x <= z.r[0] + z.r[2] && y >= z.r[1] && y <= z.r[1] + z.r[3]);
    let RU = ups, RB = beams, RG = goods;
    /* ชั้นวางตามแบบ Typical Rack: สูง 11.3 ม. · คาน 7 ชั้น + วางพื้น = 8 ชั้น · ช่องละ 2.7 ม. วาง 2 พาเลท · หลังชนหลัง */
    const rackSpec = (bx: number, by: number, bw: number, bh: number) => {
      const S = M.rack!, P = M.pxm, along = bh >= bw, L = along ? bh : bw, WdAll = along ? bw : bh;
      const nb = Math.max(1, Math.round(L / (P * S.bay))), step = L / nb, top = P * S.h;
      const unit = P * (S.depth || 2.1), nr = Math.max(1, Math.round(WdAll / (unit * 1.25))), pitch = WdAll / nr, Wd = Math.min(unit, pitch * 0.9);
      const side = P * (S.side || 0.9), lv = [0, ...S.beams].map((v) => v * P);
      for (let r = 0; r < nr; r++) {
        const off = r * pitch + (pitch - Wd) / 2, Pt = (u: number, v: number) => (along ? [bx + off + v, by + u] : [bx + u, by + off + v]);
        for (let i = 0; i <= nb; i++) for (const v of [0.6, side, Wd - side, Wd - 0.6]) { const [px, pz] = Pt(i * step, v); RU.push([px, top / 2, pz, 1.6, top, 1.6]); }
        for (const y of lv.slice(1)) for (const v of [0.6, side, Wd - side, Wd - 0.6]) { const [px, pz] = Pt(L / 2, v); RB.push(along ? [px, y - 1, pz, 1.4, 2, L] : [px, y - 1, pz, L, 2, 1.4]); }
        for (let i = 0; i < nb; i++) for (let k = 0; k < lv.length; k++) for (const v of [side / 2, Wd - side / 2]) for (let q = 0; q < S.per; q++) {
          if (R() < 0.2) continue;
          const u = i * step + (step * (q + 0.5)) / S.per, [px, pz] = Pt(u, v), y = lv[k] + (k ? 0 : 0.2), gh = P * 1.2 * (0.55 + R() * 0.4);
          const pw = Math.min(P * 1.0, (step / S.per) * 0.86), pd = Math.min(P * 1.2, side * 0.95);
          const [w1, d1] = along ? [pd, pw] : [pw, pd];
          pals.push([px, y + 0.8, pz, w1, 1.6, d1]); RG.push([px, y + 1.6 + gh / 2, pz, w1 * 0.94, gh, d1 * 0.94]);
        }
      }
    };
    for (const [bx, by, bw, bh, t] of M.boxes) {
      if (t === "flowrack") {
        /* Flow Rack ทะลุผนัง Dock · 1 ชุด = 2 ช่องทาง · ชั้นล่าง = รางลูกกลิ้งเอียงมีพาเลทสินค้า · ชั้นบน = กองพาเลทเปล่าสีน้ำเงิน */
        const P = M.pxm, along = bh >= bw, L = along ? bh : bw, Wd = along ? bw : bh, top = P * 6, deck = P * 3.3;
        const Pt = (u: number, v: number) => (along ? [bx + v, by + u] : [bx + u, by + v]);
        const bx3 = (u: number, v: number, y: number, du: number, h: number, dv: number): B6 => { const [px, pz] = Pt(u, v); return along ? [px, y, pz, dv, h, du] : [px, y, pz, du, h, dv]; };
        const nf = Math.max(2, Math.round(L / (P * 3)));
        for (let i = 0; i <= nf; i++) for (const v of [0.5, Wd / 2, Wd - 0.5]) { const u = (i * L) / nf; ups.push(bx3(u, v, top / 2, 1.1, top, 1.1)); if (i === 0) yel.push(bx3(u - 0.3, v, P * 0.5, 1.5, P * 1, 1.5)); }
        for (const v of [0.5, Wd / 2, Wd - 0.5]) for (const y of [deck, top - 1]) beams.push(bx3(L / 2, v, y, L, 1.3, 1.1));
        for (let i = 0; i <= nf; i++) { const u = (i * L) / nf; beams.push(bx3(u, Wd / 2, deck, 1.1, 1.3, Wd)); }
        for (let i = 0; i < nf; i++) for (const k of [0.3, 0.7]) ups.push(bx3(((i + 0.5) * L) / nf, Wd / 2, top * k, (L / nf) * 1.15, 0.5, 0.5));
        const lane = Wd / 2, n = Math.max(2, Math.floor(L / (P * 1.35)));
        for (const lvl of [0, 1]) {
          const vc = lane * (lvl + 0.5);
          roll.push(bx3(L / 2, vc, P * 0.35, L, 0.6, lane * 0.85));
          blk.push(bx3(-P * 1.2, vc, 0.25, P * 2.4, 0.5, lane * 0.9));
          for (let i = 0; i < n; i++) {
            if (R() < 0.3) continue;
            const u = ((i + 0.5) * L) / n, y = P * 0.45 + (P * 0.15 * u) / L;
            pals.push(bx3(u, vc, y + P * 0.07, P * 1.15, P * 0.14, lane * 0.8)); const gh = P * (1 + R() * 0.35); goods.push(bx3(u, vc, y + P * 0.14 + gh / 2, P * 1.1, gh, lane * 0.76));
          }
          for (let i = 0; i < n; i++) {
            if (R() < 0.35) continue;
            const u = ((i + 0.5) * L) / n, k = 3 + Math.floor(R() * 6);
            blu.push(bx3(u, vc, deck + 0.7 + k * P * 0.075, P * 1.15, k * P * 0.15, lane * 0.8));
          }
        }
        continue;
      }
      if (t === "pyramid") {
        /* กองพาเลทบนพื้นแบบพีระมิด (กลางกองสูงสุด ขอบเตี้ย) · กองละ 6×6 ช่อง มีทางเดินคั่น */
        const P = M.pxm, cw = P * 1.15, ch = P * 1.35, gap = P * 2.2, bk = 6;
        const nx = Math.floor((bw + gap) / (cw * bk + gap)) || 1, nz = Math.floor((bh + gap) / (ch * bk + gap)) || 1;
        for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) for (let i = 0; i < bk; i++) for (let j = 0; j < bk; j++) {
          const lvl = Math.min(4, 1 + Math.min(i, bk - 1 - i, j, bk - 1 - j)), px = bx + a * (cw * bk + gap) + (i + 0.5) * cw, pz = by + b * (ch * bk + gap) + (j + 0.5) * ch;
          for (let k = 0; k < lvl; k++) { const y = k * P * 1.35; pals.push([px, y + P * 0.07, pz, cw * 0.9, P * 0.14, ch * 0.9]); goods.push([px, y + P * 0.14 + P * 0.6, pz, cw * 0.86, P * 1.2, ch * 0.86]); }
        }
        continue;
      }
      if (t === "shuttle") {
        /* Shuttle Rack 7 ชั้น (WH32) · โครงเทาเข้ม · รางเขียว · สินค้าห่อฟิล์มโทนขาว-ฟ้า · 2 บล็อก มีทางเดินกลาง · รถ Shuttle แดงบางช่อง */
        const P = M.pxm, lvN = 7, lh = P * 1.5, top = lvN * lh + P * 0.4, laneW = P * 1.4, pd = P * 1.25, aisle = P * 4;
        const nl = Math.max(1, Math.floor(bw / laneW)), lw = bw / nl, blkD = (bh - aisle) / 2;
        for (const yA of [by, by + blkD + aisle]) {
          const np = Math.max(1, Math.floor(blkD / pd)), sp = blkD / np, nposts = Math.max(1, Math.round(blkD / (P * 2.7)));
          for (let i = 0; i <= nl; i++) {
            const x = bx + i * lw;
            for (let j = 0; j <= nposts; j++) shU.push([x, top / 2, yA + (j * blkD) / nposts, 1.3, top, 1.3]);
            for (let k = 1; k <= lvN; k++) shB.push([x, k * lh - 1, yA + blkD / 2, 1.5, 1.2, blkD]);
          }
          for (let k = 1; k <= lvN; k++) for (const yy of [yA, yA + blkD]) shB.push([bx + bw / 2, k * lh - 0.4, yy, bw, 1.6, 1.2]);
          for (let i = 0; i < nl; i++) for (let k = 0; k < lvN; k++) {
            const fill = 0.78 + R() * 0.2;
            for (let j = 0; j < np; j++) {
              if (R() > fill) continue;
              const px = bx + (i + 0.5) * lw, pz = yA + (j + 0.5) * sp, y = k * lh + (k ? 0 : 0.3), gh = P * (0.9 + R() * 0.3);
              pals.push([px, y + 0.7, pz, lw * 0.82, 1.4, sp * 0.9]); shG.push([px, y + 1.4 + gh / 2, pz, lw * 0.78, gh, sp * 0.86]);
            }
            if (R() < 0.06) { const zf = yA === by ? yA + blkD - P * 0.5 : yA + P * 0.5; shut.push([bx + (i + 0.5) * lw, k * lh + P * 0.35, zf, lw * 0.7, P * 0.3, P * 1.0]); }
          }
        }
        continue;
      }
      if (t === "pallet") {
        /* พื้นที่วางพาเลทบนพื้น */
        const n = Math.max(1, Math.floor(bw / (M.pxm * 1.3))), m = Math.max(1, Math.floor(bh / (M.pxm * 1.3)));
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          if (R() < 0.25) continue;
          const px = bx + ((i + 0.5) * bw) / n, pz = by + ((j + 0.5) * bh) / m, hh = H * (0.12 + R() * 0.14);
          goods.push([px, hh / 2, pz, (bw / n) * 0.82, hh, (bh / m) * 0.82]);
        }
        continue;
      }
      if (M.rack) {
        const z = zoneOf(bx + bw / 2, by + bh / 2);
        RU = z ? z.U : ups; RB = z ? z.B : beams; RG = z ? z.G : goods;
        rackSpec(bx, by, bw, bh);
        if (z) z.rows.push([bx, by, bw, bh]);
      }
    }
    const inst = (list: B6[], color: number, o: { metal?: number; vary?: number[] } = {}) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: o.metal || 0 }), list.length);
      const m4 = new THREE.Matrix4(), c = new THREE.Color();
      list.forEach((b, i) => { m4.makeScale(b[3], b[4], b[5]); m4.setPosition(b[0], b[1], b[2]); mesh.setMatrixAt(i, m4); if (o.vary) mesh.setColorAt(i, c.setHex(o.vary[i % o.vary.length])); });
      mesh.castShadow = mesh.receiveShadow = true;
      add(mesh);
    };
    inst(ups, COL.navy, { metal: 0.3 }); inst(beams, COL.beam, { metal: 0.2 });
    for (const z of RZ) {
      inst(z.U, z.u, { metal: 0.3 }); inst(z.B, z.b, { metal: 0.2 }); inst(z.G, 0xffffff, { vary: z.g || COL.box });
      const [zx, zy, zw, zh] = z.r, P = M.pxm, top = P * (M.rack ? M.rack.h : 8), css = "#" + z.b.toString(16).padStart(6, "0");
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(zw, zh), stdMat({ color: new THREE.Color(z.f).getHex(), roughness: 1 })); fl.rotation.x = -Math.PI / 2; fl.position.set(zx + zw / 2, 0.5, zy + zh / 2); fl.receiveShadow = true; add(fl);
      for (const [a, b2, w, h] of [[zx, zy, zw, 1.6], [zx, zy + zh - 1.6, zw, 1.6], [zx, zy, 1.6, zh], [zx + zw - 1.6, zy, 1.6, zh]]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basicMat(z.b)); e.rotation.x = -Math.PI / 2; e.position.set(a + w / 2, 0.9, b2 + h / 2); add(e); }
      /* ป้ายท้ายแถว (ฝั่งทางเดินหน้า) สีโซน */
      for (const [bx, by, bw, bh] of z.rows) { const along = bh >= bw, sg = box(along ? bw * 0.9 : P * 0.2, P * 1.6, along ? P * 0.2 : bh * 0.9, z.b); sg.position.set(along ? bx + bw / 2 : bx + bw + P * 0.2, top * 0.78, along ? by + bh + P * 0.2 : by + bh / 2); add(sg); }
      if (z.cap) { const cp = new THREE.Mesh(new THREE.PlaneGeometry(zw, zh), new THREE.MeshBasicMaterial({ color: z.cap, transparent: true, opacity: z.co || 0.28, depthWrite: false })); cp.rotation.x = -Math.PI / 2; cp.position.set(zx + zw / 2, top + 1.5, zy + zh / 2); add(cp); }
      const t = textSprite(z.t, z.sz || Math.min(46, zw * 0.09), z.tc || "#1b1d21", css + "ee"); t.position.set(zx + zw / 2, top + 8, zy + zh - 20); add(t);
    }
    inst(pals, COL.wood); inst(goods, 0xffffff, { vary: COL.box });
    inst(shut, 0xd9341e, { metal: 0.3 });
    inst(shU, 0x46505c, { metal: 0.4 }); inst(shB, 0x16a34a, { metal: 0.2 }); inst(shG, 0xffffff, { vary: [0xeef4fa, 0xdfeaf5, 0xf7f9fc, 0xcfe0f0, 0xe6eef7, 0xbcd4ea] });
    inst(yel, 0xf5c400); inst(blk, 0x1b1d21); inst(blu, 0x1f4fa8); inst(roll, 0x8d98a5, { metal: 0.5 });
    mergeStatic(root);
    /* แสง + เงา + หมอก ตามขนาดคลัง */
    const span = Math.max(W, D);
    sun.position.set(cx - span * 0.35, span * 0.9, cz + span * 0.55); sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -span * 0.7, right: span * 0.7, top: span * 0.7, bottom: -span * 0.7, near: 10, far: span * 3 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    fog.near = span * 1.6; fog.far = span * 4;
    view(VMODE);
    needs = true;
  }

  /* ---------- มุมกล้อง: ฉายมุม 8 จุดของขอบเขต (พื้น + ยอดชั้นวาง) ลงจอ แล้วปรับระยะ/จุดกลางจนเต็มกรอบ ---------- */
  function view(mode?: ViewMode) {
    VMODE = mode || VMODE;
    sizeToEl();
    const M = cur ? MAPS[cur] : null;
    if (!M) return;
    const full = M.view || M.bounds, focus = FOCUS && OBJS.size > 0;
    const [x0, y0, x1, y1] = focus ? peopleArea(full) : full, W = x1 - x0, D = y1 - y0, cx = (x0 + x1) / 2, cz = (y0 + y1) / 2;
    const top = VMODE === "top", front = VMODE === "front";
    const dir = top ? new THREE.Vector3(0, 1, 0.001) : front ? new THREE.Vector3(0, 0.4, 0.92).normalize() : camera.aspect < 1 ? new THREE.Vector3(0, 0.86, 0.5).normalize() : new THREE.Vector3(0, 0.62, 0.78).normalize();
    /* โฟกัส: เผื่อความสูงให้ป้ายชื่อ+เวลาพักเหนือหัว */
    const hh = focus ? boxH() + unit() * 9 : (M.rackH || 70) * 1.15, pts: THREE.Vector3[] = [];
    for (const x of [x0, x1]) for (const z of [y0, y1]) for (const y of [0, hh]) pts.push(new THREE.Vector3(x, y, z));
    const tgt = new THREE.Vector3(cx, 0, cz);
    let d = Math.max(W, D) * 1.2;
    const right = new THREE.Vector3(), up = new THREE.Vector3(), v = new THREE.Vector3(), tf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const X0 = -0.99, X1 = 0.99, Y0 = -0.98, Y1 = 0.92, cx0 = (X0 + X1) / 2, cy0 = (Y0 + Y1) / 2;
    for (let k = 0; k < 11; k++) {
      camera.position.copy(tgt).addScaledVector(dir, d); camera.lookAt(tgt); camera.updateMatrixWorld();
      let a = 1e9, b = -1e9, c = 1e9, e = -1e9;
      for (const p of pts) { v.copy(p).project(camera); a = Math.min(a, v.x); b = Math.max(b, v.x); c = Math.min(c, v.y); e = Math.max(e, v.y); }
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      tgt.addScaledVector(right, ((a + b) / 2 - cx0) * d * tf * camera.aspect).addScaledVector(up, ((c + e) / 2 - cy0) * d * tf);
      if (k < 8) d *= Math.max((b - a) / (X1 - X0), (e - c) / (Y1 - Y0));
    }
    controls.target.copy(tgt); camera.position.copy(tgt).addScaledVector(dir, d);
    const FW = full[2] - full[0], FD = full[3] - full[1];
    controls.maxDistance = focus ? Math.max(FW, FD) * 2.6 : d * 2.2; controls.minDistance = Math.max(FW, FD) * 0.035;
    /* หมุนรอบได้ ±40° จากมุมเริ่ม (มุมบน = ไม่จำกัด) */
    const az = Math.atan2(dir.x, dir.z);
    controls.minAzimuthAngle = top ? -Infinity : az - 0.7; controls.maxAzimuthAngle = top ? Infinity : az + 0.7;
    camera.lookAt(controls.target); controls.update(); needs = true;
  }

  /* ---------- ตัวคน + ป้ายชื่อ + ลากวาง ---------- */
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1";
  el.appendChild(layer);
  const peopleRoot = new THREE.Group();
  scene.add(peopleRoot);
  /* ตัวคนงาน 3D (สูงราว 4.8 ม. ในผัง ให้เห็นชัดจากมุมไกล): หมวกนิรภัย + เสื้อกั๊กสีตามตำแหน่ง แถบสะท้อนแสง
     กางเกง/แขนเสื้อกรมท่า · วงแหวนสีบนพื้นช่วยให้เห็นจากมุมบน · รูปทรงสร้างครั้งเดียว ทุกคนใช้ร่วมกัน (วาดเร็ว) */
  const FIG = (() => {
    const at = (g: THREE.BufferGeometry, x: number, y: number, rz = 0, rx = 0) => {
      if (rx) g.rotateX(rx);
      if (rz) g.rotateZ(rz);
      return g.translate(x, y, 0);
    };
    const merge = (list: THREE.BufferGeometry[]) => {
      const g = mergeGeometries(list)!;
      list.forEach((x) => x.dispose());
      return g;
    };
    return {
      vest: merge([
        at(new THREE.CapsuleGeometry(0.82, 0.75, 6, 18), 0, 2.45),
        at(new THREE.SphereGeometry(0.72, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 4.2),
        at(new THREE.CylinderGeometry(0.8, 0.8, 0.1, 26), 0, 4.22),
      ]),
      cloth: merge([
        at(new THREE.CapsuleGeometry(0.34, 1.0, 4, 12), -0.42, 0.88),
        at(new THREE.CapsuleGeometry(0.34, 1.0, 4, 12), 0.42, 0.88),
        at(new THREE.CapsuleGeometry(0.25, 1.05, 4, 12), -1.02, 2.5, -0.2),
        at(new THREE.CapsuleGeometry(0.25, 1.05, 4, 12), 1.02, 2.5, 0.2),
      ]),
      skin: at(new THREE.SphereGeometry(0.66, 22, 16), 0, 3.98),
      stripe: merge([at(new THREE.TorusGeometry(0.85, 0.075, 8, 32), 0, 2.15, 0, Math.PI / 2), at(new THREE.TorusGeometry(0.86, 0.075, 8, 32), 0, 2.75, 0, Math.PI / 2)]),
      ring: at(new THREE.RingGeometry(1.25, 1.75, 44), 0, 0.25, 0, -Math.PI / 2), // ยกพ้นเส้น/โซนที่ทาบนพื้น
    };
  })();
  const SKIN = [0xf3c9a4, 0xe8b38a, 0xd69a6f, 0xf6d2b3];
  const clothMat = stdMat({ color: 0x24305c, roughness: 0.75, metalness: 0.02 });
  const stripeMat = stdMat({ color: 0xf5f8fc, roughness: 0.25, metalness: 0.35, emissive: 0x2a3440 });
  const ringMat = (color: string) => {
    const k = "ring" + color;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.85, depthWrite: false });
      m.userData.shared = true;
      matCache.set(k, m);
    }
    return m;
  };
  function makeFigure(id: string, color: string) {
    const g = new THREE.Group();
    const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.userData.person = id;
      g.add(m);
      return m;
    };
    g.userData.ring = part(FIG.ring, ringMat(color), false);
    g.userData.vest = part(FIG.vest, personMat(color), true);
    part(FIG.cloth, clothMat, true);
    part(FIG.skin, stdMat({ color: SKIN[seed % SKIN.length], roughness: 0.8, metalness: 0 }), true);
    part(FIG.stripe, stripeMat, false);
    return g;
  }
  function recolorFigure(g: THREE.Group, color: string) {
    (g.userData.vest as THREE.Mesh).material = personMat(color);
    (g.userData.ring as THREE.Mesh).material = ringMat(color);
  }
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  type Box = { x: number; y: number; w: number; h: number } | null;
  type Obj = { p: PersonObj; mesh: THREE.Group; tag: HTMLButtonElement; nm: HTMLSpanElement; sb: HTMLSpanElement; box: Box };
  type Grp = { key: string; tag: HTMLButtonElement; ids: string[]; color: string; box: Box };
  let OBJS = new Map<string, Obj>();
  let GRPS = new Map<string, Grp>();
  let drag: { ids: string[]; start: THREE.Vector3; orig: Map<string, { x: number; y: number }>; tap?: string; sx: number; sy: number; moved: boolean; pid: number } | null = null;
  const unit = () => (cur ? MAPS[cur].pxm : 6.6);
  const FIG_SCALE = 1.3; // ขยายตัวคนให้ใหญ่กว่าจริง มองเห็นชัดทั้งคลัง
  const boxH = () => unit() * 4.95 * FIG_SCALE; // ความสูงตัวคน (ถึงยอดหมวก) · ป้ายชื่ออยู่เหนือจุดนี้
  const personMat = (color: string) => stdMat({ color: new THREE.Color(color).getHex(), roughness: 0.55, metalness: 0.05 });

  const chip = (bg: string, fg: string, border: string, size: number) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;white-space:nowrap;font:700 ${size}px/1.25 ${FONT};color:${fg};background:${bg};border:2px solid ${border};border-radius:10px;padding:2px 7px;box-shadow:0 2px 8px rgba(11,42,74,.22);user-select:none;-webkit-user-select:none`;
    return b;
  };
  /* ป้ายรายคน 2 บรรทัด: ชื่อ · แถบเวลาพัก (สีตามเวลาพัก) · ขนาดตายตัวให้ภาพที่บันทึกตรงกับบนจอ */
  const NAME_PX = 14, SUB_PX = 12;
  const personChip = (border: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;white-space:nowrap;display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px 6px 4px;background:#fff;border:2px solid ${border};border-radius:10px;box-shadow:0 2px 8px rgba(11,42,74,.22);user-select:none;-webkit-user-select:none;font-family:${FONT}`;
    const nm = document.createElement("span");
    nm.style.cssText = `font:700 ${NAME_PX}px/18px ${FONT};color:#16204a`;
    const sb = document.createElement("span");
    sb.style.cssText = `font:700 ${SUB_PX}px/16px ${FONT};padding:0 6px;border-radius:6px`;
    b.append(nm, sb);
    return { b, nm, sb };
  };
  /* พื้นที่ที่ครอบตัวคนที่แสดงอยู่ (เผื่อขอบ · อย่างน้อย ~30 ม. ไม่ให้ซูมใกล้เกิน) */
  function peopleArea(full: number[]): [number, number, number, number] {
    const xs = [...OBJS.values()].map((o) => o.p.x), ys = [...OBJS.values()].map((o) => o.p.y);
    let a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys);
    const pad = Math.max(unit() * 9, Math.max(b - a, d - c) * 0.14), minS = unit() * 30;
    a -= pad; b += pad; c -= pad; d += pad;
    if (b - a < minS) { const m = (a + b) / 2; a = m - minS / 2; b = m + minS / 2; }
    if (d - c < minS * 0.6) { const m = (c + d) / 2; c = m - minS * 0.3; d = m + minS * 0.3; }
    return [Math.max(a, full[0]), Math.max(c, full[1]), Math.min(b, full[2]), Math.min(d, full[3])];
  }
  const styleEdit = (b: HTMLElement) => {
    b.style.cursor = EDIT ? "grab" : "pointer";
    b.style.touchAction = EDIT ? "none" : "auto";
  };

  function setPeople(list: PersonObj[]) {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, o] of OBJS) if (!keep.has(id)) { peopleRoot.remove(o.mesh); o.tag.remove(); OBJS.delete(id); }
    const s = unit();
    for (const p of list) {
      let o = OBJS.get(p.id);
      if (!o) {
        const mesh = makeFigure(p.id, p.color);
        peopleRoot.add(mesh);
        const { b: tag, nm, sb } = personChip(p.color);
        tag.addEventListener("pointerdown", (e) => startDrag(e, [p.id], p.id));
        layer.appendChild(tag);
        o = { p, mesh, tag, nm, sb, box: null };
        OBJS.set(p.id, o);
      } else if (o.p.color !== p.color) {
        recolorFigure(o.mesh, p.color);
        o.tag.style.borderColor = p.color;
      }
      /* กำลังลากคนนี้อยู่ = คงตำแหน่งบนจอไว้ก่อน */
      o.p = drag?.ids.includes(p.id) ? { ...p, x: o.p.x, y: o.p.y } : p;
      o.nm.textContent = p.label;
      o.sb.textContent = p.sub ?? "";
      o.sb.style.display = p.sub ? "" : "none";
      o.sb.style.background = p.subBg ?? "#eef1f6";
      o.sb.style.color = p.subFg ?? "#16204a";
      o.tag.title = `${p.label}${p.sub ? ` · ${p.sub}` : ""} · ${p.groupLabel}`;
      styleEdit(o.tag);
      o.mesh.scale.setScalar(s * FIG_SCALE);
      o.mesh.position.set(o.p.x, 0, o.p.y);
    }
    /* ป้ายหัวกลุ่มตำแหน่ง: ลากป้ายนี้ = ย้ายทั้งกลุ่ม */
    const groups = new Map<string, { ids: string[]; label: string; color: string }>();
    for (const p of list) {
      const g = groups.get(p.group);
      if (g) g.ids.push(p.id);
      else groups.set(p.group, { ids: [p.id], label: p.groupLabel, color: p.color });
    }
    for (const [k, g] of GRPS) if (!groups.has(k)) { g.tag.remove(); GRPS.delete(k); }
    for (const [key, g] of groups) {
      let t = GRPS.get(key);
      if (!t) {
        const tag = chip(g.color, "#ffffff", "#ffffff", 13);
        tag.addEventListener("pointerdown", (e) => { const now = GRPS.get(key); if (now) startDrag(e, now.ids); });
        layer.appendChild(tag);
        t = { key, tag, ids: g.ids, color: g.color, box: null };
        GRPS.set(key, t);
      }
      t.ids = g.ids;
      t.color = g.color;
      t.tag.style.background = g.color;
      t.tag.dataset.full = `${g.label} · ${g.ids.length} คน`;
      t.tag.dataset.short = String(g.ids.length);
      t.tag.textContent = t.tag.dataset.full;
      t.tag.title = `${g.label} · ${g.ids.length} คน${EDIT ? " · ลากป้ายนี้เพื่อย้ายทั้งกลุ่ม" : ""}`;
      styleEdit(t.tag);
    }
    needs = true;
  }

  const prj = new THREE.Vector3();
  const toPx = (x: number, y: number, z: number) => {
    prj.set(x, y, z).project(camera);
    return { sx: ((prj.x + 1) / 2) * el.clientWidth, sy: ((1 - prj.y) / 2) * el.clientHeight, ok: prj.z < 1 && Math.abs(prj.x) < 1.1 && Math.abs(prj.y) < 1.1, z: prj.z };
  };
  /* ป้ายชื่อ+เวลาพักรายคน: แสดงเมื่อคนบนแผนที่ไม่เกิน 16 คน (กรองแล้ว) หรือซูมใกล้พอ (ตัวคนห่างกันบนจอ ≥ 22px)
     ป้ายชนกัน → เลื่อนป้ายหลังขึ้นไปจนพ้น (ไม่ทับกันในภาพที่แคป) · ป้ายกลุ่มแสดงตลอด */
  /* ป้ายไม่ล้นขอบซ้าย/ขวาของแผนที่ (ภาพที่แคปเห็นครบ) */
  const clampX = (x: number, w: number) => Math.max(4, Math.min(x, el.clientWidth - w - 4));
  function placeLabels() {
    if (!OBJS.size) return;
    const first = OBJS.values().next().value!;
    const a = toPx(first.p.x, 0, first.p.y), b = toPx(first.p.x + unit() * 5, 0, first.p.y);
    const names = OBJS.size <= 16 || Math.hypot(b.sx - a.sx, b.sy - a.sy) >= 22;
    type R = [number, number, number, number];
    const taken: R[] = [];
    const hits = (r: R) => taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
    /* วางป้ายคนที่อยู่ใกล้กล้อง (ล่างจอ) ก่อน */
    const list = [...OBJS.values()].map((o) => ({ o, q: toPx(o.p.x, boxH() + unit() * 0.6, o.p.y) })).sort((m, n) => n.q.sy - m.q.sy);
    for (const { o, q } of list) {
      const show = q.ok && (names || !!drag?.ids.includes(o.p.id));
      o.tag.style.display = show ? "flex" : "none";
      o.box = null;
      if (!show) continue;
      const w = o.tag.offsetWidth, h = o.tag.offsetHeight, x = clampX(q.sx - w / 2, w);
      let y = q.sy - h;
      for (let k = 0; k < 8 && hits([x, y, x + w, y + h]); k++) y -= h * 0.55;
      taken.push([x, y, x + w, y + h]);
      o.box = { x, y, w, h };
      o.tag.style.transform = `translate(${x}px, ${y}px)`;
      o.tag.style.zIndex = String(1000 - Math.round(q.z * 900));
    }
    /* ป้ายกลุ่ม: ถ้าชนป้ายที่วางไปแล้ว ย่อเหลือจำนวนคน (ชื่อเต็มอยู่ในคำอธิบายเมื่อชี้ และในแถบตัวกรอง) */
    const order = [...GRPS.values()].sort((a, b) => b.ids.length - a.ids.length);
    for (const g of order) {
      const pts = g.ids.map((id) => OBJS.get(id)?.p).filter((p): p is PersonObj => !!p);
      g.box = null;
      if (!pts.length) { g.tag.style.display = "none"; continue; }
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, minY = Math.min(...pts.map((p) => p.y));
      const q = toPx(cx, boxH() + unit() * (names ? 5 : 1.5), minY - unit() * (names ? 1 : 0));
      g.tag.style.display = q.ok ? "" : "none";
      if (!q.ok) continue;
      /* ป้ายกลุ่มอยู่เหนือป้ายชื่อของกลุ่มเสมอ */
      const top = Math.min(q.sy, ...g.ids.map((id) => OBJS.get(id)?.box?.y ?? Infinity)) - 4;
      const rect = (): R => { const w = g.tag.offsetWidth, h = g.tag.offsetHeight, x = clampX(q.sx - w / 2, w); return [x, top - h, x + w, top]; };
      g.tag.textContent = g.tag.dataset.full ?? "";
      let r = rect();
      if (hits(r)) { g.tag.textContent = g.tag.dataset.short ?? ""; r = rect(); }
      taken.push(r);
      g.box = { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
      g.tag.style.transform = `translate(${r[0]}px, ${r[1]}px)`;
      g.tag.style.zIndex = "1001";
    }
  }

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aim = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v2, camera);
  };
  const groundAt = (cx: number, cy: number) => { aim(cx, cy); return ray.ray.intersectPlane(plane, new THREE.Vector3()); };
  function startDrag(e: PointerEvent, ids: string[], tap?: string) {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const g = groundAt(e.clientX, e.clientY);
    if (!g) return;
    e.preventDefault();
    e.stopPropagation();
    const orig = new Map<string, { x: number; y: number }>();
    for (const id of ids) { const o = OBJS.get(id); if (o) orig.set(id, { x: o.p.x, y: o.p.y }); }
    drag = { ids, start: g, orig, tap, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    controls.enabled = false;
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }
  function onDragMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid || !EDIT || !cur) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    const g = groundAt(e.clientX, e.clientY);
    if (!g) return;
    drag.moved = true;
    const [x0, y0, x1, y1] = MAPS[cur].view || MAPS[cur].bounds, dx = g.x - drag.start.x, dz = g.z - drag.start.z;
    for (const [id, s0] of drag.orig) {
      const o = OBJS.get(id);
      if (!o) continue;
      o.p = { ...o.p, x: Math.min(Math.max(s0.x + dx, x0), x1), y: Math.min(Math.max(s0.y + dz, y0), y1) };
      o.mesh.position.set(o.p.x, 0, o.p.y);
    }
    needs = true;
  }
  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    controls.enabled = !LOCKED;
    needs = true;
    if (d.moved && e.type === "pointerup") {
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const moves: Move[] = [];
      for (const id of d.orig.keys()) { const o = OBJS.get(id); if (o) moves.push({ id, x: r1(o.p.x), y: r1(o.p.y) }); }
      api.onMove?.(moves);
    } else if (d.moved) {
      /* ถูกยกเลิกกลางทาง (เช่น มีสายเรียกเข้า) → กลับที่เดิม */
      for (const [id, s0] of d.orig) { const o = OBJS.get(id); if (o) { o.p = { ...o.p, ...s0 }; o.mesh.position.set(s0.x, 0, s0.y); } }
    } else if (d.tap) api.onTap?.(d.tap);
  }
  /* ลากที่ตัวคนในฉาก · ดักก่อนถึงตัวควบคุมกล้อง (capture) */
  const onCanvasDown = (e: PointerEvent) => {
    if (!EDIT || !OBJS.size || e.target !== canvas) return;
    aim(e.clientX, e.clientY);
    const id = ray.intersectObjects(peopleRoot.children, true)[0]?.object.userData.person as string | undefined;
    if (id) startDrag(e, [id], id);
  };
  el.addEventListener("pointerdown", onCanvasDown, { capture: true });

  /* ---------- บันทึกภาพ (ใช้แคปไปประชุม): หัวกระดาษ + แผนที่ความละเอียดสูง + ป้ายชื่อ/เวลาพัก ---------- */
  const rr = (x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, r: number) => {
    x.beginPath();
    if (typeof x.roundRect === "function") x.roundRect(X, Y, W, H, r);
    else { x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
  };
  async function snapshot(shot: Shot): Promise<Blob | null> {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return null;
    placeLabels();
    const scale = Math.min(4, Math.max(2, 1800 / W));
    const out = document.createElement("canvas"), m = out.getContext("2d")!;
    /* จัดรายการตำแหน่งเป็นแถว (ตัดบรรทัดตามความกว้าง) */
    m.font = `600 15px ${FONT}`;
    const rows: { label: string; color: string; x: number }[][] = [[]];
    let cx = 14;
    for (const it of shot.legend) {
      const w = 20 + m.measureText(it.label).width + 18;
      if (cx + w > W - 14 && rows.at(-1)!.length) { rows.push([]); cx = 14; }
      rows.at(-1)!.push({ ...it, x: cx });
      cx += w;
    }
    const headH = 14 + 26 + (shot.legend.length ? rows.length * 24 : 0) + 8, footH = 26;
    out.width = Math.round(W * scale);
    out.height = Math.round((headH + H + footH) * scale);
    m.scale(scale, scale);
    m.fillStyle = "#ffffff";
    m.fillRect(0, 0, W, headH + H + footH);
    m.textBaseline = "middle";
    m.fillStyle = "#1b2a5c";
    m.font = `700 20px ${FONT}`;
    m.fillText(shot.title, 14, 14 + 12);
    m.font = `600 15px ${FONT}`;
    rows.forEach((row, i) => {
      const y = 14 + 26 + i * 24 + 10;
      for (const it of row) {
        m.fillStyle = it.color;
        rr(m, it.x, y - 7, 14, 14, 3);
        m.fill();
        m.fillStyle = "#16204a";
        m.fillText(it.label, it.x + 20, y);
      }
    });
    /* แผนที่: วาดใหม่ที่ความละเอียดสูงชั่วคราว แล้วคืนค่าเดิม */
    const prev = renderer.getPixelRatio();
    renderer.setPixelRatio(scale);
    renderer.setSize(W, H, false);
    renderer.render(scene, camera);
    m.drawImage(canvas, 0, headH, W, H);
    renderer.setPixelRatio(prev);
    renderer.setSize(W, H, false);
    needs = true;
    /* ป้าย (ตำแหน่งเดียวกับบนจอ) */
    m.save();
    m.beginPath();
    m.rect(0, headH, W, H);
    m.clip();
    m.translate(0, headH);
    const shadow = (on: boolean) => { m.shadowColor = on ? "rgba(11,42,74,.22)" : "transparent"; m.shadowBlur = on ? 8 : 0; m.shadowOffsetY = on ? 2 : 0; };
    const people = [...OBJS.values()].filter((o) => o.box && o.tag.style.display !== "none").sort((a, b) => b.box!.y - a.box!.y);
    for (const o of people) {
      const b = o.box!, mid = b.x + b.w / 2;
      shadow(true);
      rr(m, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 10);
      m.fillStyle = "#ffffff";
      m.fill();
      shadow(false);
      m.lineWidth = 2;
      m.strokeStyle = o.p.color;
      m.stroke();
      m.textAlign = "center";
      m.font = `700 ${NAME_PX}px ${FONT}`;
      m.fillStyle = "#16204a";
      m.fillText(o.p.label, mid, b.y + 2 + 3 + 9);
      if (o.p.sub) {
        m.font = `700 ${SUB_PX}px ${FONT}`;
        const tw = m.measureText(o.p.sub).width + 12, ty = b.y + 2 + 3 + 18 + 2;
        rr(m, mid - tw / 2, ty, tw, 16, 6);
        m.fillStyle = o.p.subBg ?? "#eef1f6";
        m.fill();
        m.fillStyle = o.p.subFg ?? "#16204a";
        m.fillText(o.p.sub, mid, ty + 8);
      }
    }
    for (const g of GRPS.values()) {
      if (!g.box || g.tag.style.display === "none") continue;
      const b = g.box;
      shadow(true);
      rr(m, b.x + 1, b.y + 1, b.w - 2, b.h - 2, 10);
      m.fillStyle = g.color;
      m.fill();
      shadow(false);
      m.lineWidth = 2;
      m.strokeStyle = "#ffffff";
      m.stroke();
      m.textAlign = "center";
      m.font = `700 13px ${FONT}`;
      m.fillStyle = "#ffffff";
      m.fillText(g.tag.textContent ?? "", b.x + b.w / 2, b.y + b.h / 2);
    }
    m.restore();
    m.textAlign = "left";
    m.font = `500 12px ${FONT}`;
    m.fillStyle = "#5a6482";
    const when = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
    m.fillText(`WHA Workforce · บันทึกภาพเมื่อ ${when} น. · ผังโดยประมาณจากแบบ Layout คลัง`, 14, headH + H + footH / 2);
    return new Promise((res) => out.toBlob(res, "image/png"));
  }

  /* เริ่มวาดหลังเตรียมทุกส่วนเสร็จ */
  loop();

  const api: Warehouse3D = {
    show(key) {
      sizeToEl();
      if (key !== cur) { setPeople([]); build(key); }
    },
    view,
    lock(on) { LOCKED = !!on; applyLock(); if (LOCKED) view(); return LOCKED; },
    setPeople,
    setEditing(on) {
      EDIT = !!on;
      applyLock();
      for (const o of OBJS.values()) styleEdit(o.tag);
      for (const g of GRPS.values()) styleEdit(g.tag);
    },
    onMove: null,
    onTap: null,
    focus(on) {
      FOCUS = !!on;
      view();
    },
    snapshot,
    dispose() {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onCanvasDown, { capture: true });
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      layer.remove();
      OBJS = new Map();
      GRPS = new Map();
      scene.remove(peopleRoot);
      Object.values(FIG).forEach((g) => g.dispose());
      ro.disconnect(); io?.disconnect();
      controls.dispose();
      if (root) { scene.remove(root); disposeTree(root); root = null; }
      matCache.forEach((m) => m.dispose()); matCache.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return api;
}
