import fs from 'node:fs';
import path from 'node:path';

export const CAD_MATERIALS = {
  food_grade_silicone: { id: 'food_grade_silicone', name: '食品级硅胶 (Shore 60A)', nameEn: 'Food-Grade Silicone (60A)', density: 1.15, cnyPerKg: 28, minWallMm: 1.8, minDraftDeg: 1.5, process: '模压成型 (Compression Molding)' },
  pp_plastic: { id: 'pp_plastic', name: '全新料 PP 聚丙烯', nameEn: 'Virgin PP Plastic', density: 0.91, cnyPerKg: 11, minWallMm: 1.6, minDraftDeg: 1.5, process: '注塑成型 (Injection Molding)' },
  abs_plastic: { id: 'abs_plastic', name: '高强度 ABS 工程塑料', nameEn: 'ABS Engineering Plastic', density: 1.05, cnyPerKg: 15, minWallMm: 1.8, minDraftDeg: 1.5, process: '注塑成型 (Injection Molding)' },
  pet_clear: { id: 'pet_clear', name: '高透 PET 食品级', nameEn: 'Clear Food-Grade PET', density: 1.38, cnyPerKg: 12, minWallMm: 2.0, minDraftDeg: 2.0, process: '注塑成型 (Injection Molding)' },
  aluminum_6061: { id: 'aluminum_6061', name: '6061 铝合金 (阳极氧化)', nameEn: '6061 Aluminum (Anodized)', density: 2.70, cnyPerKg: 26, minWallMm: 2.0, minDraftDeg: 0, process: '折弯 / CNC 精加工' },
  acrylic: { id: 'acrylic', name: '高透 PMMA 亚克力', nameEn: 'Clear PMMA Acrylic', density: 1.19, cnyPerKg: 22, minWallMm: 3.0, minDraftDeg: 0, process: '激光切割 + 热弯粘接' },
};

export const CAD_TEMPLATES = [
  {
    id: 'silicone_mat',
    name: '硅胶防漏垫 / 防溢托盘',
    nameEn: 'Silicone Drip Mat / Raised-Rim Tray',
    defaultMaterial: 'food_grade_silicone',
    defaults: { length_mm: 864, width_mm: 559, height_mm: 20, wall_mm: 2.5, corner_radius_mm: 14, draft_deg: 2.0, compartments_x: 1, compartments_y: 1 },
    rollPackable: true,
  },
  {
    id: 'storage_bin',
    name: '收纳盒 / 整理箱',
    nameEn: 'Stackable Storage Bin',
    defaultMaterial: 'pp_plastic',
    defaults: { length_mm: 320, width_mm: 220, height_mm: 150, wall_mm: 2.4, corner_radius_mm: 12, draft_deg: 2.0, compartments_x: 1, compartments_y: 1 },
    rollPackable: false,
  },
  {
    id: 'organizer_tray',
    name: '抽屉多格分隔盒',
    nameEn: 'Multi-Compartment Drawer Organizer',
    defaultMaterial: 'abs_plastic',
    defaults: { length_mm: 300, width_mm: 200, height_mm: 65, wall_mm: 2.2, corner_radius_mm: 8, draft_deg: 2.0, compartments_x: 3, compartments_y: 2 },
    rollPackable: false,
  },
  {
    id: 'stand_holder',
    name: '桌面支架 / 承托架',
    nameEn: 'Desktop Stand / Angled Holder',
    defaultMaterial: 'aluminum_6061',
    defaults: { length_mm: 140, width_mm: 110, height_mm: 125, wall_mm: 3.0, corner_radius_mm: 8, draft_deg: 0, compartments_x: 1, compartments_y: 1 },
    rollPackable: false,
  },
];

const clamp = (v, lo, hi, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
};
const round2 = v => Math.round(v * 100) / 100;

export function inferDraftSpec(item = {}) {
  const text = `${item.title || ''} ${item.keyword || ''} ${item.diff_note || ''}`.toLowerCase();
  let templateId = 'storage_bin';
  if (/mat|pad|liner|tray|silicone|sink|drip|防漏垫|硅胶垫|托盘/.test(text)) templateId = 'silicone_mat';
  else if (/divider|drawer|compartment|grid|分隔|抽屉/.test(text)) templateId = 'organizer_tray';
  else if (/stand|holder|mount|rack|bracket|支架|挂架/.test(text)) templateId = 'stand_holder';

  const tpl = CAD_TEMPLATES.find(t => t.id === templateId) || CAD_TEMPLATES[0];
  const spec = {
    template: tpl.id,
    material: tpl.defaultMaterial,
    ...tpl.defaults,
    asin: String(item.asin || '').toUpperCase(),
    title: String(item.title || tpl.name).slice(0, 180),
    diff_note: String(item.diff_note || '').slice(0, 400),
  };

  // Auto-parse inches like 34" x 22" or 15 x 11 x 6 inch
  const inch3 = text.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch)/i);
  const inch2 = text.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch)?/i);
  const cm2 = text.match(/(\d+(?:\.\d+)?)\s*cm\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i);
  if (inch3) {
    spec.length_mm = round2(clamp(Number(inch3[1]) * 25.4, 40, 1500, spec.length_mm));
    spec.width_mm = round2(clamp(Number(inch3[2]) * 25.4, 40, 1200, spec.width_mm));
    spec.height_mm = round2(clamp(Number(inch3[3]) * 25.4, 8, 600, spec.height_mm));
  } else if (cm2) {
    spec.length_mm = round2(clamp(Number(cm2[1]) * 10, 40, 1500, spec.length_mm));
    spec.width_mm = round2(clamp(Number(cm2[2]) * 10, 40, 1200, spec.width_mm));
  } else if (inch2 && /"|inch|\bin\b/i.test(text)) {
    spec.length_mm = round2(clamp(Number(inch2[1]) * 25.4, 40, 1500, spec.length_mm));
    spec.width_mm = round2(clamp(Number(inch2[2]) * 25.4, 40, 1200, spec.width_mm));
  }

  // Upgrade thickness automatically if pain points mention thin/flimsy/leak
  const pains = (item.teardown?.pain_points?.themes || []).map(t => t.key);
  if (pains.includes('thin') || /加厚/.test(text)) spec.wall_mm = round2(Math.max(spec.wall_mm, 2.8));
  if (pains.includes('leak') || /防溢|加高/.test(text)) spec.height_mm = round2(Math.max(spec.height_mm, 24));
  return spec;
}

export function normalizeDraftSpec(input = {}) {
  const tpl = CAD_TEMPLATES.find(t => t.id === input.template) || CAD_TEMPLATES[0];
  const mat = CAD_MATERIALS[input.material] || CAD_MATERIALS[tpl.defaultMaterial];
  const L = round2(clamp(input.length_mm, 30, 1500, tpl.defaults.length_mm));
  const W = round2(clamp(input.width_mm, 30, 1200, tpl.defaults.width_mm));
  const H = round2(clamp(input.height_mm, 6, 600, tpl.defaults.height_mm));
  const wallMax = Math.max(2, Math.min(L, W, H) / 4);
  const wall = round2(clamp(input.wall_mm, 0.8, Math.min(25, wallMax), tpl.defaults.wall_mm));
  const rMax = Math.max(1, Math.min(L, W) / 5);
  const R = round2(clamp(input.corner_radius_mm, 0, Math.min(60, rMax), tpl.defaults.corner_radius_mm));
  const draft = round2(clamp(input.draft_deg, 0, 15, tpl.defaults.draft_deg));
  const cx = Math.round(clamp(input.compartments_x, 1, 8, tpl.defaults.compartments_x));
  const cy = Math.round(clamp(input.compartments_y, 1, 6, tpl.defaults.compartments_y));
  return {
    template: tpl.id,
    template_name: tpl.name,
    template_name_en: tpl.nameEn,
    material: mat.id,
    material_info: mat,
    roll_packable: tpl.rollPackable,
    length_mm: L,
    width_mm: W,
    height_mm: H,
    wall_mm: wall,
    corner_radius_mm: R,
    draft_deg: draft,
    compartments_x: cx,
    compartments_y: cy,
    asin: String(input.asin || '').trim().toUpperCase(),
    title: String(input.title || tpl.name).slice(0, 180),
    diff_note: String(input.diff_note || '').slice(0, 500),
  };
}

/**
 * Construct a closed watertight solid (quad faces + triangulated mesh) representing
 * the parametric product draft, composed of exact B-Rep axis-aligned / drafted prisms.
 */
function boxSolid(x0, y0, z0, x1, y1, z1, draftTopOut = 0) {
  const dx = draftTopOut;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0 - dx, y0 - dx, z1], [x1 + dx, y0 - dx, z1], [x1 + dx, y1 + dx, z1], [x0 - dx, y1 + dx, z1],
  ];
  // Outward-facing quad loops (CCW looking from outside)
  const quads = [
    [0, 3, 2, 1], // bottom (-Z)
    [4, 5, 6, 7], // top (+Z)
    [0, 1, 5, 4], // front (-Y)
    [1, 2, 6, 5], // right (+X)
    [2, 3, 7, 6], // back (+Y)
    [3, 0, 4, 7], // left (-X)
  ];
  return { vertices: v, quads };
}

function buildPartSolids(spec) {
  const { length_mm: L, width_mm: W, height_mm: H, wall_mm: t, draft_deg, template, compartments_x: cx, compartments_y: cy } = spec;
  const draftOff = round2(Math.tan((draft_deg * Math.PI) / 180) * Math.max(0, H - t));
  const solids = [];

  if (template === 'stand_holder') {
    // Base plate + vertical/angled backplate + front anti-slip lip
    solids.push(boxSolid(0, 0, 0, L, W, t, 0));
    solids.push(boxSolid(0, W - t, t, L, W, H, 0));
    const lipH = Math.min(22, Math.max(t * 2.5, H * 0.16));
    solids.push(boxSolid(0, 0, t, L, t, t + lipH, 0));
    return solids;
  }

  // Open-top tray / silicone mat / storage bin / multi-compartment organizer
  // 1. Floor slab
  solids.push(boxSolid(0, 0, 0, L, W, t, 0));
  // 2. Four perimeter walls (exact non-overlapping prisms for exact volume + valid B-Rep)
  if (H > t) {
    solids.push(boxSolid(0, 0, t, L, t, H, draftOff * 0.25));             // Front wall
    solids.push(boxSolid(0, W - t, t, L, W, H, draftOff * 0.25));         // Back wall
    solids.push(boxSolid(0, t, t, t, W - t, H, 0));                       // Left wall
    solids.push(boxSolid(L - t, t, t, L, W - t, H, 0));                   // Right wall

    // Internal divider walls for organizer_tray
    if (template === 'organizer_tray' && (cx > 1 || cy > 1)) {
      const divH = Math.max(t + 4, H - 2);
      for (let i = 1; i < cx; i++) {
        const px = round2((L / cx) * i - t / 2);
        solids.push(boxSolid(px, t, t, px + t, W - t, divH, 0));
      }
      for (let j = 1; j < cy; j++) {
        const py = round2((W / cy) * j - t / 2);
        solids.push(boxSolid(t, py, t, L - t, py + t, divH, 0));
      }
    }
    // Raised anti-slip ribs for silicone_mat (4 slim ribs along floor)
    if (template === 'silicone_mat' && L >= 150 && W >= 120) {
      const ribH = Math.min(2.0, t * 0.7);
      const ribW = Math.min(4.0, t * 1.4);
      const margin = Math.max(25, t * 8);
      for (let i = 1; i <= 4; i++) {
        const y = round2(margin + ((W - margin * 2) * i) / 5);
        solids.push(boxSolid(margin, y - ribW / 2, t, L - margin, y + ribW / 2, t + ribH, 0));
      }
    }
  }
  return solids;
}

function triangulateSolids(solids) {
  const tris = [];
  for (const s of solids) {
    for (const [a, b, c, d] of s.quads) {
      tris.push([s.vertices[a], s.vertices[b], s.vertices[c]]);
      tris.push([s.vertices[a], s.vertices[c], s.vertices[d]]);
    }
  }
  return tris;
}

function computeMeshVolumeMm3(tris) {
  let vol6 = 0;
  for (const [a, b, c] of tris) {
    const cx = b[1] * c[2] - b[2] * c[1];
    const cy = b[2] * c[0] - b[0] * c[2];
    const cz = b[0] * c[1] - b[1] * c[0];
    vol6 += a[0] * cx + a[1] * cy + a[2] * cz;
  }
  return Math.abs(vol6) / 6;
}

export function buildBinaryStl(solids) {
  const tris = triangulateSolids(solids);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('VA Commerce Browser Parametric Model Draft (mm)', 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off + 4); buf.writeFloatLE(nz, off + 8);
    buf.writeFloatLE(a[0], off + 12); buf.writeFloatLE(a[1], off + 16); buf.writeFloatLE(a[2], off + 20);
    buf.writeFloatLE(b[0], off + 24); buf.writeFloatLE(b[1], off + 28); buf.writeFloatLE(b[2], off + 32);
    buf.writeFloatLE(c[0], off + 36); buf.writeFloatLE(c[1], off + 40); buf.writeFloatLE(c[2], off + 44);
    buf.writeUInt16LE(0, off + 48);
    off += 50;
  }
  return buf;
}

/**
 * Generate a valid ISO-10303-21 STEP AP214 B-Rep file containing all closed solid bodies.
 */
export function buildStepAp214(spec, solids) {
  let id = 1;
  const lines = [];
  const add = entity => { const cur = id++; lines.push(`#${cur}=${entity};`); return cur; };
  const f = n => Number(n).toFixed(4);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  const appCtx = add(`APPLICATION_CONTEXT('automotive design')`);
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const prodCtx = add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const safeName = (spec.asin || spec.template).replace(/[^A-Za-z0-9_-]/g, '_');
  const prod = add(`PRODUCT('${safeName}','${safeName}','VA Model Draft',(#${prodCtx}))`);
  const pdefForm = add(`PRODUCT_DEFINITION_FORMATION('','',#${prod})`);
  const pdefCtx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const pdef = add(`PRODUCT_DEFINITION('design','',#${pdefForm},#${pdefCtx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pdef})`);

  const lenUnit = add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angUnit = add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solUnit = add(`(NAMED_UNIT(*)SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.))`);
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),#${lenUnit},'distance_accuracy_value','confusion accuracy')`);
  const geomCtx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${angUnit},#${solUnit}))REPRESENTATION_CONTEXT('Context3D','3D Context'))`);

  const originPt = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const axisZ = add(`DIRECTION('',(0.,0.,1.))`);
  const axisX = add(`DIRECTION('',(1.,0.,0.))`);
  const worldPlace = add(`AXIS2_PLACEMENT_3D('',#${originPt},#${axisZ},#${axisX})`);

  const brepIds = [];
  for (let si = 0; si < solids.length; si++) {
    const s = solids[si];
    const vPts = s.vertices.map(p => add(`CARTESIAN_POINT('',(${f(p[0])},${f(p[1])},${f(p[2])}))`));
    const verts = vPts.map(pt => add(`VERTEX_POINT('',#${pt})`));
    const faceIds = [];
    for (const q of s.quads) {
      const p0 = s.vertices[q[0]], p1 = s.vertices[q[1]], p2 = s.vertices[q[2]];
      const e1 = norm(sub(p1, p0));
      const nVec = norm(cross(sub(p1, p0), sub(p2, p0)));
      const fOrigin = add(`CARTESIAN_POINT('',(${f(p0[0])},${f(p0[1])},${f(p0[2])}))`);
      const fNorm = add(`DIRECTION('',(${f(nVec[0])},${f(nVec[1])},${f(nVec[2])}))`);
      const fRef = add(`DIRECTION('',(${f(e1[0])},${f(e1[1])},${f(e1[2])}))`);
      const fPlace = add(`AXIS2_PLACEMENT_3D('',#${fOrigin},#${fNorm},#${fRef})`);
      const plane = add(`PLANE('',#${fPlace})`);

      const oEdges = [];
      for (let k = 0; k < 4; k++) {
        const iA = q[k], iB = q[(k + 1) % 4];
        const dir = norm(sub(s.vertices[iB], s.vertices[iA]));
        const dEnt = add(`DIRECTION('',(${f(dir[0])},${f(dir[1])},${f(dir[2])}))`);
        const vecEnt = add(`VECTOR('',#${dEnt},1.)`);
        const lineEnt = add(`LINE('',#${vPts[iA]},#${vecEnt})`);
        const edgeEnt = add(`EDGE_CURVE('',#${verts[iA]},#${verts[iB]},#${lineEnt},.T.)`);
        oEdges.push(add(`ORIENTED_EDGE('',*,*,#${edgeEnt},.T.)`));
      }
      const loop = add(`EDGE_LOOP('',(${oEdges.map(x => '#' + x).join(',')}))`);
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      faceIds.push(add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
    }
    const shell = add(`CLOSED_SHELL('',(${faceIds.map(x => '#' + x).join(',')}))`);
    brepIds.push(add(`MANIFOLD_SOLID_BREP('Body_${si + 1}',#${shell})`));
  }

  const shapeRep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${safeName}',(#${worldPlace},${brepIds.map(x => '#' + x).join(',')}),#${geomCtx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${shapeRep})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('VA Commerce Browser Parametric Model Draft'),'2;1');`,
    `FILE_NAME('${safeName}.step','${stamp}',('VA Commerce Browser'),('VA Studio'),'ISO-10303-21 AP214','VA CAD Draft Engine','');`,
    `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

/**
 * Valid AutoCAD R12 DXF 2D Orthographic Blueprint (Top + Front + Side Views + Dimensions)
 */
export function buildDxfDrawing(spec) {
  const { length_mm: L, width_mm: W, height_mm: H, wall_mm: t, compartments_x: cx, compartments_y: cy } = spec;
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const line = (x1, y1, x2, y2, layer = 'OUTLINE') => {
    out.push('0', 'LINE', '8', layer, '10', String(round2(x1)), '20', String(round2(y1)), '30', '0', '11', String(round2(x2)), '21', String(round2(y2)), '31', '0');
  };
  const rect = (x, y, w, h, layer = 'OUTLINE') => {
    line(x, y, x + w, y, layer); line(x + w, y, x + w, y + h, layer);
    line(x + w, y + h, x, y + h, layer); line(x, y + h, x, y, layer);
  };
  const text = (x, y, str, size = 10, layer = 'DIM') => {
    out.push('0', 'TEXT', '8', layer, '10', String(round2(x)), '20', String(round2(y)), '30', '0', '40', String(size), '1', String(str));
  };

  // Top View at (0, 0)
  rect(0, 0, L, W, 'OUTLINE');
  if (spec.template !== 'stand_holder') {
    rect(t, t, Math.max(2, L - 2 * t), Math.max(2, W - 2 * t), 'INNER');
    if (spec.template === 'organizer_tray') {
      for (let i = 1; i < cx; i++) line((L / cx) * i, t, (L / cx) * i, W - t, 'INNER');
      for (let j = 1; j < cy; j++) line(t, (W / cy) * j, L - t, (W / cy) * j, 'INNER');
    }
  }
  text(0, W + 18, `TOP VIEW: ${L} x ${W} mm | WALL ${t}mm | R${spec.corner_radius_mm} | DRAFT ${spec.draft_deg}deg`, Math.max(8, L * 0.025));

  // Front View below Top View
  const fy = -H - 60;
  rect(0, fy, L, H, 'OUTLINE');
  line(t, fy + t, L - t, fy + t, 'SECTION');
  text(0, fy - 18, `FRONT VIEW: L=${L}mm x H=${H}mm`, Math.max(8, L * 0.025));

  // Side View to the right
  const sx = L + 60;
  rect(sx, fy, W, H, 'OUTLINE');
  line(sx + t, fy + t, sx + W - t, fy + t, 'SECTION');
  text(sx, fy - 18, `SIDE VIEW: W=${W}mm x H=${H}mm`, Math.max(8, L * 0.025));

  out.push('0', 'ENDSEC', '0', 'EOF', '');
  return out.join('\n');
}

export function buildBlueprintSvg(spec, dfm) {
  const { length_mm: L, width_mm: W, height_mm: H, wall_mm: t, corner_radius_mm: R, compartments_x: cx, compartments_y: cy } = spec;
  // Fit top view inside 210x130 box
  const topScale = Math.min(185 / Math.max(L, 1), 108 / Math.max(W, 1));
  const tw = round2(L * topScale);
  const th = round2(W * topScale);
  const tx = round2(28 + (185 - tw) / 2);
  const ty = round2(36 + (108 - th) / 2);
  const tr = Math.min(tw / 4, th / 4, round2(R * topScale));
  const tWallPx = Math.max(2, round2(t * topScale));

  // Front view inside 185x58 box
  const frontScale = Math.min(185 / Math.max(L, 1), 46 / Math.max(H, 1));
  const fw = round2(L * frontScale);
  const fh = Math.max(10, round2(H * frontScale));
  const fx = round2(28 + (185 - fw) / 2);
  const fy = round2(182 + (46 - fh) / 2);

  // Isometric projection on right panel (center 330, 125)
  const isoScale = Math.min(115 / Math.max(L + W, 1), 85 / Math.max((L + W) * 0.35 + H, 1));
  const proj = (x, y, z) => {
    const px = 336 + (x - y) * 0.82 * isoScale;
    const py = 148 + (x + y) * 0.40 * isoScale - z * 0.92 * isoScale;
    return `${round2(px)},${round2(py)}`;
  };
  const c000 = proj(-L / 2, -W / 2, 0), c100 = proj(L / 2, -W / 2, 0), c110 = proj(L / 2, W / 2, 0), c010 = proj(-L / 2, W / 2, 0);
  const c001 = proj(-L / 2, -W / 2, H), c101 = proj(L / 2, -W / 2, H), c111 = proj(L / 2, W / 2, H), c011 = proj(-L / 2, W / 2, H);
  const i001 = proj(-L / 2 + t, -W / 2 + t, H), i101 = proj(L / 2 - t, -W / 2 + t, H), i111 = proj(L / 2 - t, W / 2 - t, H), i011 = proj(-L / 2 + t, W / 2 - t, H);

  let innerSvg = '';
  if (spec.template !== 'stand_holder') {
    innerSvg += `<rect x="${round2(tx + tWallPx)}" y="${round2(ty + tWallPx)}" width="${round2(Math.max(4, tw - 2 * tWallPx))}" height="${round2(Math.max(4, th - 2 * tWallPx))}" rx="${Math.max(1, round2(tr * 0.7))}" fill="rgba(45,212,191,0.08)" stroke="#2dd4bf" stroke-width="1" stroke-dasharray="3,2"/>`;
    if (spec.template === 'organizer_tray') {
      for (let i = 1; i < cx; i++) {
        const lx = round2(tx + (tw / cx) * i);
        innerSvg += `<line x1="${lx}" y1="${round2(ty + tWallPx)}" x2="${lx}" y2="${round2(ty + th - tWallPx)}" stroke="#2dd4bf" stroke-width="1"/>`;
      }
      for (let j = 1; j < cy; j++) {
        const ly = round2(ty + (th / cy) * j);
        innerSvg += `<line x1="${round2(tx + tWallPx)}" y1="${ly}" x2="${round2(tx + tw - tWallPx)}" y2="${ly}" stroke="#2dd4bf" stroke-width="1"/>`;
      }
    }
    if (spec.template === 'silicone_mat') {
      for (let i = 1; i <= 4; i++) {
        const ly = round2(ty + (th * i) / 5);
        innerSvg += `<line x1="${round2(tx + 12)}" y1="${ly}" x2="${round2(tx + tw - 12)}" y2="${ly}" stroke="#5eead4" stroke-opacity="0.45" stroke-width="1"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="258" viewBox="0 0 460 258">
  <defs>
    <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
      <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(45,212,191,0.09)" stroke-width="0.7"/>
    </pattern>
  </defs>
  <rect width="460" height="258" rx="10" fill="#0b131b"/>
  <rect width="460" height="258" rx="10" fill="url(#grid)" stroke="rgba(45,212,191,0.32)" stroke-width="1"/>
  <text x="14" y="18" fill="#5eead4" font-family="Consolas,monospace" font-size="10.5" font-weight="700">MODEL DRAFT · ${spec.template.toUpperCase()} · ${L}×${W}×${H}mm</text>
  <text x="446" y="18" text-anchor="end" fill="#94a3b8" font-family="Consolas,monospace" font-size="9.5">${dfm.weight_g}g · STEP/STL/DXF</text>
  <line x1="234" y1="26" x2="234" y2="246" stroke="rgba(148,163,184,0.22)" stroke-dasharray="3,3"/>

  <!-- Top View -->
  <text x="14" y="33" fill="#94a3b8" font-family="Consolas,monospace" font-size="9">TOP VIEW (俯视图)</text>
  <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="${tr}" fill="rgba(20,184,166,0.16)" stroke="#5eead4" stroke-width="1.6"/>
  ${innerSvg}
  <text x="${round2(tx + tw / 2)}" y="${round2(ty + th + 12)}" text-anchor="middle" fill="#cbd5e1" font-family="Consolas,monospace" font-size="9">L = ${L} mm (R${R})</text>
  <text x="${round2(tx - 6)}" y="${round2(ty + th / 2)}" text-anchor="middle" fill="#cbd5e1" font-family="Consolas,monospace" font-size="9" transform="rotate(-90 ${round2(tx - 6)} ${round2(ty + th / 2)})">W=${W}</text>

  <!-- Front Section View -->
  <text x="14" y="176" fill="#94a3b8" font-family="Consolas,monospace" font-size="9">FRONT SECTION (前剖视 · 壁厚 ${t}mm · 拔模 ${spec.draft_deg}°)</text>
  <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="2" fill="rgba(56,189,248,0.15)" stroke="#38bdf8" stroke-width="1.5"/>
  <line x1="${round2(fx + 4)}" y1="${round2(fy + fh - Math.max(3, fh * 0.22))}" x2="${round2(fx + fw - 4)}" y2="${round2(fy + fh - Math.max(3, fh * 0.22))}" stroke="#5eead4" stroke-dasharray="3,2" stroke-width="1"/>
  <text x="${round2(fx + fw / 2)}" y="${round2(fy + fh + 12)}" text-anchor="middle" fill="#cbd5e1" font-family="Consolas,monospace" font-size="9">H = ${H} mm · Wall = ${t} mm</text>

  <!-- Isometric 3D Draft Preview -->
  <text x="246" y="33" fill="#94a3b8" font-family="Consolas,monospace" font-size="9">ISOMETRIC 3D DRAFT (轴测草稿)</text>
  <polygon points="${c000} ${c100} ${c110} ${c010}" fill="rgba(15,118,110,0.22)" stroke="#14b8a6" stroke-width="1"/>
  <polygon points="${c100} ${c110} ${c111} ${c101}" fill="rgba(20,184,166,0.28)" stroke="#5eead4" stroke-width="1.2"/>
  <polygon points="${c010} ${c110} ${c111} ${c011}" fill="rgba(13,148,136,0.36)" stroke="#5eead4" stroke-width="1.2"/>
  <polygon points="${c001} ${c101} ${c111} ${c011}" fill="rgba(94,234,212,0.18)" stroke="#99f6e4" stroke-width="1.4"/>
  ${spec.template !== 'stand_holder' ? `<polygon points="${i001} ${i101} ${i111} ${i011}" fill="rgba(11,19,27,0.75)" stroke="#2dd4bf" stroke-width="1" stroke-dasharray="2,2"/>` : ''}

  <rect x="246" y="212" width="200" height="34" rx="6" fill="rgba(15,23,42,0.8)" stroke="rgba(45,212,191,0.28)"/>
  <text x="255" y="226" fill="#5eead4" font-family="Consolas,monospace" font-size="9.5" font-weight="700">DFM: ${dfm.status_label} · ${dfm.fba_tier}</text>
  <text x="255" y="239" fill="#94a3b8" font-family="Consolas,monospace" font-size="8.8">Est. Material: ¥${dfm.est_material_cny} · Vol ${dfm.volume_cm3}cm³</text>
</svg>`;
}

export function buildCadQueryScript(spec) {
  const { length_mm: L, width_mm: W, height_mm: H, wall_mm: t, corner_radius_mm: R, draft_deg, template, compartments_x: cx, compartments_y: cy } = spec;
  return `# VA Commerce Browser — Parametric CadQuery Draft Script
# Open in CQ-Editor / FreeCAD / Python CadQuery (OCCT B-Rep Kernel)
# NOTE: Engineering Model Draft — confirm parting line, shrinkage & draft with mold factory before tooling.

import argparse, json, os
import cadquery as cq

parser = argparse.ArgumentParser()
parser.add_argument("--out-dir", default=".")
args = parser.parse_args()
os.makedirs(args.out_dir, exist_ok=True)

LENGTH = ${L}      # mm
WIDTH = ${W}       # mm
HEIGHT = ${H}      # mm
WALL = ${t}        # mm
CORNER_R = ${R}    # mm
DRAFT_DEG = ${draft_deg}  # deg
TEMPLATE = "${template}"

def build_rounded_prism(l, w, h, r, taper_deg=0.0):
    rr = max(0.0, min(r, l / 4.0, w / 4.0))
    sk = cq.Workplane("XY").sketch().rect(l, w)
    if rr > 0.2:
        sk = sk.vertices().fillet(rr)
    return sk.finalize().extrude(h, taper=-taper_deg if taper_deg > 0 else 0.0)

if TEMPLATE == "stand_holder":
    base = cq.Workplane("XY").box(LENGTH, WIDTH, WALL, centered=(True, True, False))
    back = cq.Workplane("XY").transformed(offset=(0, WIDTH/2 - WALL/2, 0)).box(LENGTH, WALL, HEIGHT, centered=(True, True, False))
    lip = cq.Workplane("XY").transformed(offset=(0, -WIDTH/2 + WALL/2, 0)).box(LENGTH, WALL, min(20.0, HEIGHT * 0.4), centered=(True, True, False))
    result = base.union(back).union(lip)
else:
    outer = build_rounded_prism(LENGTH, WIDTH, HEIGHT, CORNER_R, DRAFT_DEG)
    inner_l = max(4.0, LENGTH - 2.0 * WALL)
    inner_w = max(4.0, WIDTH - 2.0 * WALL)
    inner_r = max(0.0, CORNER_R - WALL)
    cavity = (
        cq.Workplane("XY")
        .workplane(offset=WALL)
        .sketch()
        .rect(inner_l, inner_w)
    )
    if inner_r > 0.2:
        cavity = cavity.vertices().fillet(min(inner_r, inner_l / 4.0, inner_w / 4.0))
    cavity_solid = cavity.finalize().extrude(HEIGHT, taper=-DRAFT_DEG if DRAFT_DEG > 0 else 0.0)
    result = outer.cut(cavity_solid)
${template === 'organizer_tray' && (cx > 1 || cy > 1) ? `
    # Internal dividers (${cx} x ${cy})
    for i in range(1, ${cx}):
        x = -LENGTH/2 + (LENGTH / ${cx}) * i
        result = result.union(cq.Workplane("XY").transformed(offset=(x, 0, WALL)).box(WALL, inner_w, max(2.0, HEIGHT - WALL), centered=(True, True, False)))
    for j in range(1, ${cy}):
        y = -WIDTH/2 + (WIDTH / ${cy}) * j
        result = result.union(cq.Workplane("XY").transformed(offset=(0, y, WALL)).box(inner_l, WALL, max(2.0, HEIGHT - WALL), centered=(True, True, False)))` : ''}

step_path = os.path.join(args.out_dir, "model-draft.step")
stl_path = os.path.join(args.out_dir, "prototype-3dprint.stl")
cq.exporters.export(result, step_path)
cq.exporters.export(result, stl_path)
vol_cm3 = round(float(result.val().Volume()) / 1000.0, 2)
print("VA_CAD_RESULT:" + json.dumps({
    "ok": True,
    "volume_cm3": vol_cm3,
    "step_path": step_path,
    "stl_path": stl_path,
}))
`;
}

export function runDfmCheck(spec, solids) {
  const tris = triangulateSolids(solids);
  const volumeMm3 = computeMeshVolumeMm3(tris);
  const volumeCm3 = round2(volumeMm3 / 1000);
  const mat = spec.material_info;
  const weightG = round2(volumeCm3 * mat.density);
  const weightKg = round2(weightG / 1000);
  const estMaterialCny = round2((weightG / 1000) * mat.cnyPerKg);

  const checks = [];
  // 1. Wall thickness
  if (spec.wall_mm < mat.minWallMm) {
    checks.push({ id: 'wall', ok: false, severity: 'warn', msg: `壁厚 ${spec.wall_mm}mm 低于 ${mat.name} 建议下限 ${mat.minWallMm}mm（易缩水/撕裂）` });
  } else {
    checks.push({ id: 'wall', ok: true, severity: 'ok', msg: `壁厚 ${spec.wall_mm}mm 满足 ${mat.process} 强度要求` });
  }
  // 2. Draft angle
  if (mat.minDraftDeg > 0 && spec.draft_deg < mat.minDraftDeg) {
    checks.push({ id: 'draft', ok: false, severity: 'warn', msg: `拔模斜度 ${spec.draft_deg}° 偏小（建议 ≥ ${mat.minDraftDeg}°，防脱模拉伤）` });
  } else {
    checks.push({ id: 'draft', ok: true, severity: 'ok', msg: mat.minDraftDeg > 0 ? `拔模斜度 ${spec.draft_deg}° 符合常规脱模要求` : '折弯/切割件无需注塑拔模角' });
  }
  // 3. Corner radius
  if (spec.corner_radius_mm < 3) {
    checks.push({ id: 'fillet', ok: false, severity: 'warn', msg: `圆角 R${spec.corner_radius_mm}mm 过尖（建议 ≥ R4mm 降低模具应力与清洗死角）` });
  } else {
    checks.push({ id: 'fillet', ok: true, severity: 'ok', msg: `圆角 R${spec.corner_radius_mm}mm 利于脱模与防藏污` });
  }

  // 4. Amazon US FBA Size Tier estimation (inches)
  const dimsIn = [spec.length_mm / 25.4, spec.width_mm / 25.4, spec.height_mm / 25.4].sort((a, b) => b - a);
  const [longest, median, shortest] = dimsIn;
  let fbaTier = 'Large Standard';
  let fbaNote = `展开尺寸 ${round2(longest)}"×${round2(median)}"×${round2(shortest)}"（标准大件）`;
  if (longest <= 15 && median <= 12 && shortest <= 0.75 && weightKg <= 0.45) {
    fbaTier = 'Small Standard';
    fbaNote = '满足 FBA Small Standard（最低配送费档）';
  } else if (longest > 18 || median > 14 || shortest > 8) {
    if (spec.roll_packable) {
      fbaTier = 'Roll-Pack Standard';
      fbaNote = `展开最长边 ${round2(longest)}" 超 18"，但柔性硅胶支持卷装入 ≤12"×4"×4" 彩盒，按 Large Standard 计费！`;
    } else {
      fbaTier = 'Oversize Warning';
      fbaNote = `⚠️ 最长边 ${round2(longest)}" 超 18"（触发 FBA Oversize 配送费大幅上涨，建议改折叠/拆装结构）`;
      checks.push({ id: 'fba', ok: false, severity: 'warn', msg: fbaNote });
    }
  }
  if (!checks.some(c => c.id === 'fba')) {
    checks.push({ id: 'fba', ok: true, severity: 'ok', msg: fbaNote });
  }

  const warnCount = checks.filter(c => !c.ok).length;
  return {
    triangle_count: tris.length,
    solid_count: solids.length,
    volume_cm3: volumeCm3,
    weight_g: weightG,
    weight_kg: weightKg,
    est_material_cny: estMaterialCny,
    fba_tier: fbaTier,
    fba_note: fbaNote,
    warn_count: warnCount,
    status_label: warnCount === 0 ? 'PASS (Draft)' : `${warnCount} WARN`,
    checks,
  };
}

export function buildFactoryRfqText(spec, dfm) {
  const mat = spec.material_info;
  return [
    `【工厂打样/开模询盘草稿 · VA 电商AI浏览器生成】`,
    `产品类型：${spec.template_name}（参考 ASIN：${spec.asin || '定制新款'}）`,
    `外形尺寸：${spec.length_mm} × ${spec.width_mm} × ${spec.height_mm} mm（壁厚 ${spec.wall_mm}mm · 圆角 R${spec.corner_radius_mm}mm · 拔模 ${spec.draft_deg}°）`,
    `建议材质：${mat.name} | 工艺：${mat.process}`,
    `模型测算净重：约 ${dfm.weight_g}g（${dfm.weight_kg} kg，体积 ${dfm.volume_cm3} cm³，原料成本参考约 ¥${dfm.est_material_cny}/件）`,
    `FBA 包装建议：${dfm.fba_note}`,
    spec.diff_note ? `差异化定制要求：${spec.diff_note}` : null,
    `附件已随包提供：3D 实体草稿 (.STEP) + 3D 打印手板 (.STL) + 2D 尺寸图 (.DXF) + CadQuery 参数脚本 (.py)。`,
    `请工厂报价：① 3D 打印/手板费与交期 ② 正式开模费（含 DFM 分型面/缩水率评审）③ 500/1000/3000 件阶梯单价（含彩盒包装）。`,
  ].filter(Boolean).join('\n');
}

export function generateModelDraft(rawInput = {}, outRootDir) {
  const spec = normalizeDraftSpec(rawInput);
  const solids = buildPartSolids(spec);
  const dfm = runDfmCheck(spec, solids);

  const stepContent = buildStepAp214(spec, solids);
  const stlBuf = buildBinaryStl(solids);
  const dxfContent = buildDxfDrawing(spec);
  const svgContent = buildBlueprintSvg(spec, dfm);
  const pyContent = buildCadQueryScript(spec);
  const rfqText = buildFactoryRfqText(spec, dfm);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const folderName = `va-model-draft-${(spec.asin || spec.template).replace(/[^A-Za-z0-9_-]/g, '')}-${stamp}`;
  const dir = path.join(outRootDir, folderName);
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    dir,
    step: path.join(dir, 'model-draft.step'),
    stl: path.join(dir, 'prototype-3dprint.stl'),
    dxf: path.join(dir, 'drawing-2d.dxf'),
    svg: path.join(dir, 'blueprint-views.svg'),
    cadquery_py: path.join(dir, 'parametric-cadquery.py'),
    techpack_md: path.join(dir, 'factory-rfq-techpack.md'),
  };

  fs.writeFileSync(files.step, stepContent, 'utf8');
  fs.writeFileSync(files.stl, stlBuf);
  fs.writeFileSync(files.dxf, dxfContent, 'utf8');
  fs.writeFileSync(files.svg, svgContent, 'utf8');
  fs.writeFileSync(files.cadquery_py, pyContent, 'utf8');

  const techpackMd = [
    `# 定制产品模型草稿 & 工厂打样工艺单 (Model Draft Tech Pack)`,
    ``,
    `> ⚠️ **工程边界声明**：本套图纸（\`.STEP\` / \`.STL\` / \`.DXF\` / \`.py\`）为 **参数化模型草稿（Engineering Draft Candidate）**，用于快速打样、3D 打印手板、克重与成本测算及工厂初盘报价。**正式支付开模定金前，务必由模具厂工程师完成模流、分型面、公差配合与缩水率 DFM 终审，并建议用新设计视图通过 SafeSellAI 复查外观专利。**`,
    ``,
    `## 1. 核心参数规格`,
    `- **参考商品 / ASIN**：${spec.title} (\`${spec.asin || 'CUSTOM'}\`)`,
    `- **结构模板**：${spec.template_name} (\`${spec.template}\`)`,
    `- **外形尺寸**：\`${spec.length_mm} × ${spec.width_mm} × ${spec.height_mm} mm\``,
    `- **壁厚 / 圆角 / 拔模角**：\`${spec.wall_mm} mm\` / \`R${spec.corner_radius_mm} mm\` / \`${spec.draft_deg}°\``,
    `- **推荐材质与工艺**：${spec.material_info.name} · ${spec.material_info.process}`,
    `- **实体体积 / 测算净重**：\`${dfm.volume_cm3} cm³\` · **\`${dfm.weight_g} g\` (\`${dfm.weight_kg} kg\`)**`,
    `- **原料成本参考**：约 \`¥${dfm.est_material_cny} / 件\`（不含加工/包装/模费摊销）`,
    `- **Amazon FBA 尺寸评估**：\`${dfm.fba_tier}\` — ${dfm.fba_note}`,
    ``,
    `## 2. DFM 基础体检清单`,
    ...dfm.checks.map(c => `- ${c.ok ? '✅' : '⚠️'} ${c.msg}`),
    ``,
    `## 3. 差异化改造要点`,
    spec.diff_note || '（未填写额外改造备注）',
    ``,
    `## 4. 随包交付工程文件`,
    `- \`model-draft.step\` — ISO-10303-21 AP214 B-Rep 实体模型（SolidWorks / Creo / UG / FreeCAD / Fusion 360 可直接打开）`,
    `- \`prototype-3dprint.stl\` — 封闭水密二进制 3D 打印手板网格（${dfm.triangle_count} 三角面）`,
    `- \`drawing-2d.dxf\` — AutoCAD 2D 三视图工程图`,
    `- \`blueprint-views.svg\` — 四视图可视化工程蓝图`,
    `- \`parametric-cadquery.py\` — 参数化 CadQuery (OCCT) 源码脚本`,
    ``,
    `## 5. 一键发盘话术（可直接发 1688 工厂/旺旺）`,
    '```text',
    rfqText,
    '```',
    ``,
  ].join('\n');
  fs.writeFileSync(files.techpack_md, techpackMd, 'utf8');

  return {
    ok: true,
    created_at: new Date().toISOString(),
    source: 'va_cad_draft_engine',
    kernel: 'builtin_parametric',
    spec: {
      template: spec.template,
      template_name: spec.template_name,
      material: spec.material,
      material_name: spec.material_info.name,
      length_mm: spec.length_mm,
      width_mm: spec.width_mm,
      height_mm: spec.height_mm,
      wall_mm: spec.wall_mm,
      corner_radius_mm: spec.corner_radius_mm,
      draft_deg: spec.draft_deg,
      compartments_x: spec.compartments_x,
      compartments_y: spec.compartments_y,
    },
    dfm,
    files,
    rfq_text: rfqText,
    preview_svg_data_uri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent),
  };
}

export function applyCadQueryCompileResult(draft, occtResult) {
  if (!draft || !occtResult?.ok) return draft;
  const mat = CAD_MATERIALS[draft.spec?.material] || CAD_MATERIALS.food_grade_silicone;
  const nextDfm = { ...(draft.dfm || {}) };
  if (Number.isFinite(Number(occtResult.volume_cm3)) && Number(occtResult.volume_cm3) > 0) {
    const vol = round2(Number(occtResult.volume_cm3));
    const weightG = round2(vol * mat.density);
    nextDfm.volume_cm3 = vol;
    nextDfm.weight_g = weightG;
    nextDfm.weight_kg = round2(weightG / 1000);
    nextDfm.est_material_cny = round2((weightG / 1000) * mat.cnyPerKg);
  }
  return {
    ...draft,
    source: 'cadquery_occt',
    kernel: 'cadquery_occt',
    cadquery_version: occtResult.cadquery_version || 'ok',
    dfm: nextDfm,
    files: {
      ...(draft.files || {}),
      step: occtResult.step_path || draft.files?.step,
      stl: occtResult.stl_path || draft.files?.stl,
    },
  };
}
