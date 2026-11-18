// ชนิดข้อมูลผังคลังสำหรับแผนที่ 3D (หน่วย = พิกเซลผัง · pxm = พิกเซลต่อเมตร)
export type Rect4 = [number, number, number, number];
type Pt = { x: number; y: number };

export type WhMap = {
  name: string;
  short: string;
  pxm: number;
  /** ตัวอาคาร [x0, y0, x1, y1] */
  bounds: Rect4;
  /** ขอบเขตกล้อง (รวมลานจอดและถนน) */
  view?: Rect4;
  rackH: number;
  walls?: number[][];
  noWalls?: boolean;
  zones?: { r: Rect4; c: string; t?: string; s?: number }[];
  /** [x, y, กว้าง, ยาว, ชนิด rack / pyramid / pallet / flowrack / shuttle] */
  boxes: [number, number, number, number, string][];
  offices?: [number, number, number, number, string][];
  rack?: { h: number; beams: number[]; bay: number; per: number; depth?: number; side?: number; src?: string };
  docks?: { n: number; x: number; y?: number; eq?: string; lb?: string; truck?: boolean }[];
  aprons?: number[][];
  roads?: number[][];
  gates?: (Pt & { t: string })[];
  canopies?: [number, number, number, number, string?][];
  forklifts?: (Pt & { r?: number; c?: number })[];
  /** [x1, y1, x2, y2, สี, หนา] */
  lines?: number[][];
  mezz?: { r: Rect4; t?: string; h?: number }[];
  bldg?: { r: Rect4; t?: string; h?: number; c?: number; face?: string }[];
  rackZones?: { r: Rect4; t: string; u: number; b: number; f: string; g?: number[]; cap?: number; co?: number; sz?: number; tc?: string }[];
  rackGuards?: boolean;
  /** [x, y เริ่ม, y จบ, ระยะห่าง (เมตร)] */
  stops?: number[][];
  props?: (Pt & { k: string; w?: number; h?: number; r?: number })[];
  fans?: (Pt & { d?: number; h?: number; a?: number })[];
  front?: { fy: number; foot: [number, number]; gaps?: number[]; gw?: number; park?: [number, number]; poles?: number[]; tx?: number; trailers?: (Pt & { r?: number; c?: number })[] };
  ofb?: { r: Rect4; t?: string }[];
  canteen?: { r: Rect4; t?: string; shop?: boolean; rc?: number }[];
  carport?: { r: Rect4; t?: string }[];
  trucks?: number;
  rigid?: boolean;
  truckCol?: number;
};

export type ViewMode = "3d" | "front" | "top";
