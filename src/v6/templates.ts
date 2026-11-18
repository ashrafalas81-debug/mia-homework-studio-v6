/**
 * MIA slide design system. The AI only chooses a layout and writes the content;
 * every slide is drawn here from tested, professional templates. This keeps quality
 * consistent and costs ~10× lower than letting a model write HTML for each slide.
 * All templates share one 1280×720 grid, theme variables and auto-fitting type.
 */
import { ICONS } from './icons';
import type { DeckTheme } from './types';

export const LAYOUTS = ['cover', 'agenda', 'section', 'cards', 'steps', 'timeline', 'comparison', 'table', 'stat', 'stats', 'chart', 'image_points', 'image_full', 'quote', 'cycle', 'hierarchy', 'checklist', 'closing'] as const;
export type Layout = typeof LAYOUTS[number];

export type Item = { icon: string; title: string; text: string; value: string };
export type SlideData = {
  layout: Layout;
  title: string;
  subtitle: string;
  items: Item[];
  left: { title: string; items: string[] };
  right: { title: string; items: string[] };
  headers: string[];
  rows: string[][];
  value: string;
  label: string;
  quote: string;
  author: string;
  imageQuery: string;
  source: string;
};

export type DeckStyle = { titleScale: number; bodyScale: number; headingFont: string; bodyFont: string; palette: string; showNumbers: boolean };
export type CoverInfo = { presenter: string; institution: string; date: string };

export const DEFAULT_STYLE: DeckStyle = { titleScale: 1, bodyScale: 1, headingFont: '', bodyFont: '', palette: '', showNumbers: true };

export const PALETTES: { id: string; name: string; theme: Omit<DeckTheme, 'headingFont' | 'bodyFont'> }[] = [
  { id: 'clinical', name: 'طبي فاتح', theme: { bg: '#F7FAFC', surface: '#FFFFFF', text: '#0F2233', muted: '#5B6B7C', accent: '#0E7C86', accent2: '#3AAFA9' } },
  { id: 'navy', name: 'كحلي', theme: { bg: '#0B1B2B', surface: '#132A40', text: '#F4F8FB', muted: '#9FB3C8', accent: '#2EC4B6', accent2: '#7B61FF' } },
  { id: 'midnight', name: 'بنفسجي', theme: { bg: '#0F0B1E', surface: '#1C1636', text: '#F5F3FF', muted: '#A9A3C7', accent: '#A78BFA', accent2: '#22D3EE' } },
  { id: 'ivory', name: 'أكاديمي', theme: { bg: '#FBF8F1', surface: '#FFFFFF', text: '#2A1B12', muted: '#76675B', accent: '#7A1F3D', accent2: '#C9A227' } },
  { id: 'forest', name: 'أخضر', theme: { bg: '#F4F8F4', surface: '#FFFFFF', text: '#13261A', muted: '#5E6E62', accent: '#1F7A4D', accent2: '#E0A526' } },
  { id: 'bold', name: 'جريء', theme: { bg: '#111111', surface: '#1E1E1E', text: '#FAFAFA', muted: '#B3B3B3', accent: '#FF5A36', accent2: '#FFD23F' } },
  { id: 'rose', name: 'وردي', theme: { bg: '#FFF7F8', surface: '#FFFFFF', text: '#2B1218', muted: '#7A5A62', accent: '#D6336C', accent2: '#5B5BD6' } },
  { id: 'ocean', name: 'أزرق', theme: { bg: '#F3F8FF', surface: '#FFFFFF', text: '#0B1F3A', muted: '#5A6B85', accent: '#1D5FD0', accent2: '#0EA5A4' } },
];

export const FONT_PAIRS: { id: string; name: string; heading: string; body: string }[] = [
  { id: 'modern', name: 'Montserrat + Inter', heading: 'Montserrat', body: 'Inter' },
  { id: 'friendly', name: 'Poppins + Open Sans', heading: 'Poppins', body: 'Open Sans' },
  { id: 'classic', name: 'Playfair + Lato', heading: 'Playfair Display', body: 'Lato' },
  { id: 'clean', name: 'Inter', heading: 'Inter', body: 'Inter' },
  { id: 'cairo', name: 'Cairo (عربي)', heading: 'Cairo', body: 'Cairo' },
  { id: 'tajawal', name: 'Tajawal (عربي)', heading: 'Tajawal', body: 'Tajawal' },
];

/** Applies the student's style choices on top of the AI-chosen theme. */
export function effectiveTheme(base: DeckTheme, style: DeckStyle): DeckTheme {
  const pal = PALETTES.find(p => p.id === style.palette);
  return { ...base, ...(pal ? pal.theme : {}), headingFont: style.headingFont || base.headingFont, bodyFont: style.bodyFont || base.bodyFont };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const len = (s: string) => [...(s || '')].length;

/** Font size that shrinks smoothly as text gets longer, so nothing overflows. */
export function fit(text: string, base: number, comfortable: number, min: number, scale = 1) {
  const n = Math.max(1, len(text));
  const size = n <= comfortable ? base : Math.max(min, base * Math.sqrt(comfortable / n));
  return Math.round(size * scale);
}
const longest = (xs: string[]) => xs.reduce((a, b) => (len(b) > len(a) ? b : a), '');

export function icon(name: string, size = 28, color = 'var(--accent)') {
  const body = ICONS[name] || ICONS['sparkles'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const BASE = `
.t{position:absolute;inset:0;padding:60px 72px 56px;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:var(--bfont)}
.t .hd{display:flex;flex-direction:column;gap:8px;margin-bottom:30px;flex:none}
.t .kicker{width:56px;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent2));margin-bottom:14px}
.t h2{font-family:var(--hfont);font-weight:800;line-height:1.12;margin:0;letter-spacing:-.5px;color:var(--text)}
.t .sub{color:var(--muted);line-height:1.35;margin:0}
.t .body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.t .foot{position:absolute;bottom:22px;inset-inline:72px;display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted);gap:24px}
.t .foot .src{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:900px}
.t .foot .num{font-weight:700;margin-inline-start:auto}
.t .card{background:var(--surface);border-radius:22px;box-shadow:0 1px 0 color-mix(in srgb,var(--text) 6%,transparent),0 18px 40px -22px color-mix(in srgb,var(--text) 35%,transparent);border:1px solid color-mix(in srgb,var(--text) 7%,transparent)}
.t .ib{width:58px;height:58px;border-radius:16px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);flex:none}
.t .clamp1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t .clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.t .clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.t .clamp4{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.t .clamp5{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.t img{display:block;object-fit:cover}
.t img[data-missing],.t .imgph{background:radial-gradient(circle at 30% 30%,color-mix(in srgb,var(--accent2) 45%,var(--surface)),color-mix(in srgb,var(--accent) 35%,var(--bg)))}
`;

type Ctx = { n: number; total: number; ts: number; bs: number; rtl: boolean; cover: CoverInfo; deckTitle: string; showNumbers: boolean };

function head(d: SlideData, c: Ctx, opts: { center?: boolean } = {}) {
  const ts = fit(d.title, 46, 34, 30, c.ts);
  return `<div class="hd" style="${opts.center ? 'align-items:center;text-align:center' : ''}"><div class="kicker"></div><h2 class="clamp2" style="font-size:${ts}px">${esc(d.title)}</h2>${d.subtitle ? `<p class="sub clamp2" style="font-size:${Math.round(21 * c.bs)}px">${esc(d.subtitle)}</p>` : ''}</div>`;
}
function foot(d: SlideData, c: Ctx) {
  return `<div class="foot"><span class="src">${d.source ? esc(d.source) : ''}</span>${c.showNumbers ? `<span class="num" dir="ltr">${c.n} / ${c.total}</span>` : ''}</div>`;
}
const wrap = (cls: string, css: string, inner: string) => `<style>${BASE}${css}</style><section class="slide t ${cls}">${inner}</section>`;
const img = (q: string, w: number, h: number, radius = 24, extra = '') => q
  ? `<img data-q="${esc(q)}" alt="" style="width:${w}px;height:${h}px;border-radius:${radius}px;${extra}">`
  : `<div class="imgph" style="width:${w}px;height:${h}px;border-radius:${radius}px;display:grid;place-items:center;${extra}">${icon('heart-pulse', 96, 'color-mix(in srgb,var(--text) 55%,transparent)')}</div>`;

/* ───────────────────────── Layouts ───────────────────────── */

const R: Record<Layout, (d: SlideData, c: Ctx) => string> = {
  cover(d, c) {
    const ts = fit(d.title, 74, 34, 46, c.ts);
    const meta = [c.cover.presenter, c.cover.institution, c.cover.date].filter(Boolean);
    return wrap('cv', `
.cv{padding:0;flex-direction:row;background:linear-gradient(135deg,var(--bg) 0%,color-mix(in srgb,var(--accent) 16%,var(--bg)) 100%)}
.cv .l{flex:1;padding:84px 64px 72px 84px;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:2}
.cv .tag{display:inline-flex;align-self:flex-start;gap:10px;align-items:center;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--accent);font-size:${Math.round(16 * c.bs)}px;margin-bottom:26px}
.cv .tag:before{content:'';width:38px;height:4px;border-radius:2px;background:var(--accent)}
.cv h1{font-family:var(--hfont);font-weight:800;line-height:1.05;letter-spacing:-1.5px;margin:0 0 22px;color:var(--text)}
.cv .s{color:var(--muted);line-height:1.4;margin:0;max-width:620px}
.cv .meta{margin-top:44px;display:flex;flex-direction:column;gap:6px;font-size:${Math.round(19 * c.bs)}px;color:var(--text)}
.cv .meta span+span{color:var(--muted)}
.cv .r{width:500px;position:relative;flex:none}
.cv .r img,.cv .r .imgph{position:absolute;inset:44px 44px 44px 0;width:auto!important;height:auto!important;border-radius:220px 28px 28px 28px!important}
.cv .ring{position:absolute;inset-inline-end:-120px;top:-140px;opacity:.55}
.cv .brand{position:absolute;bottom:34px;inset-inline-start:84px;display:flex;gap:10px;align-items:center;font-weight:700;font-size:15px;color:var(--muted);z-index:3}
.cv .brand b{background:var(--accent);color:var(--bg);border-radius:8px;padding:3px 8px;font-family:var(--hfont)}
${c.rtl ? '.cv .r img,.cv .r .imgph{border-radius:28px 220px 28px 28px!important;inset:44px 0 44px 44px}' : ''}`,
      `<svg class="ring" width="520" height="520" viewBox="0 0 520 520"><circle cx="260" cy="260" r="230" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-dasharray="4 12"/><circle cx="260" cy="260" r="170" fill="none" stroke="var(--accent)" stroke-width="2" opacity=".6"/></svg>
<div class="l"><div class="tag">${esc(d.label || 'Medical Intelligence Academy')}</div><h1 class="clamp4" style="font-size:${ts}px">${esc(d.title)}</h1>${d.subtitle ? `<p class="s clamp3" style="font-size:${fit(d.subtitle, 26, 70, 20, c.bs)}px">${esc(d.subtitle)}</p>` : ''}${meta.length ? `<div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}</div>
<div class="r">${img(d.imageQuery, 456, 632, 28)}</div><div class="brand"><b>MIA</b>Medical Intelligence Academy</div>`);
  },

  agenda(d, c) {
    const it = d.items.slice(0, 6);
    const two = it.length > 4;
    const fs = fit(longest(it.map(i => i.title)), 26, 34, 19, c.bs);
    return wrap('ag', `.ag .g{display:grid;grid-template-columns:${two ? '1fr 1fr' : '1fr'};gap:16px 40px;max-width:${two ? 1136 : 860}px}
.ag .i{display:flex;align-items:center;gap:22px;padding:18px 24px}
.ag .k{font-family:var(--hfont);font-weight:800;font-size:34px;color:var(--accent);min-width:56px}
.ag .x{font-weight:700;line-height:1.25}.ag .y{color:var(--muted);font-size:${Math.round(17 * c.bs)}px;margin-top:4px}`,
      `${head(d, c)}<div class="body"><div class="g">${it.map((i, k) => `<div class="i card"><div class="k">${String(k + 1).padStart(2, '0')}</div><div><div class="x clamp2" style="font-size:${fs}px">${esc(i.title)}</div>${i.text ? `<div class="y clamp1 clamp2">${esc(i.text)}</div>` : ''}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  section(d, c) {
    return wrap('sc', `.sc{justify-content:center;background:linear-gradient(120deg,var(--accent),color-mix(in srgb,var(--accent2) 80%,var(--accent)))}
.sc .n{font-family:var(--hfont);font-weight:800;font-size:200px;line-height:.8;color:color-mix(in srgb,#fff 28%,transparent);margin-bottom:10px}
.sc h2{color:#fff}.sc .sub{color:color-mix(in srgb,#fff 82%,transparent)}
.sc .foot{color:color-mix(in srgb,#fff 70%,transparent)}`,
      `<div class="n">${esc(d.value || String(c.n).padStart(2, '0'))}</div><h2 class="clamp2" style="font-size:${fit(d.title, 64, 30, 40, c.ts)}px">${esc(d.title)}</h2>${d.subtitle ? `<p class="sub clamp2" style="font-size:${Math.round(24 * c.bs)}px;margin-top:16px;max-width:900px">${esc(d.subtitle)}</p>` : ''}${foot(d, c)}`);
  },

  cards(d, c) {
    const it = d.items.slice(0, 4);
    const n = Math.max(2, it.length);
    const tfs = fit(longest(it.map(i => i.title)), 25, 24, 19, c.bs);
    const bfs = fit(longest(it.map(i => i.text)), 20, n >= 4 ? 90 : 130, 15, c.bs);
    return wrap('cd', `.cd .g{display:grid;grid-template-columns:repeat(${n},1fr);gap:22px;align-items:stretch}
.cd .c{padding:32px 28px;display:flex;flex-direction:column;gap:16px;position:relative;overflow:hidden;min-height:300px;max-height:450px}
.cd .c:after{content:'';position:absolute;inset-inline-start:0;top:0;bottom:0;width:5px;background:linear-gradient(var(--accent),var(--accent2))}
.cd .x{font-family:var(--hfont);font-weight:700;line-height:1.2}.cd .y{color:var(--muted);line-height:1.45}`,
      `${head(d, c)}<div class="body"><div class="g">${it.map(i => `<div class="c card"><div class="ib">${icon(i.icon, 30)}</div><div class="x clamp2" style="font-size:${tfs}px">${esc(i.title)}</div><div class="y clamp${n >= 4 ? 5 : 5}" style="font-size:${bfs}px">${esc(i.text)}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  steps(d, c) {
    const it = d.items.slice(0, 5);
    const n = Math.max(2, it.length);
    const tfs = fit(longest(it.map(i => i.title)), 24, 20, 18, c.bs);
    const bfs = fit(longest(it.map(i => i.text)), 19, n >= 5 ? 60 : 90, 14, c.bs);
    return wrap('st', `.st .g{display:grid;grid-template-columns:repeat(${n},1fr);gap:18px;position:relative}
.st .line{position:absolute;top:38px;inset-inline:60px;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));opacity:.35}
.st .s{display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;position:relative}
.st .dot{width:80px;height:80px;border-radius:50%;display:grid;place-items:center;font-family:var(--hfont);font-weight:800;font-size:30px;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 0 0 8px var(--bg),0 14px 30px -10px var(--accent)}
.st .c{padding:22px 18px;width:100%;min-height:210px}
.st .x{font-family:var(--hfont);font-weight:700;line-height:1.2;margin-bottom:10px}.st .y{color:var(--muted);line-height:1.45}`,
      `${head(d, c)}<div class="body"><div class="g"><div class="line"></div>${it.map((i, k) => `<div class="s"><div class="dot">${k + 1}</div><div class="c card"><div class="x clamp2" style="font-size:${tfs}px">${esc(i.title)}</div><div class="y clamp5" style="font-size:${bfs}px">${esc(i.text)}</div></div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  timeline(d, c) {
    const it = d.items.slice(0, 6);
    const tfs = fit(longest(it.map(i => i.title)), 21, 22, 16, c.bs);
    const bfs = fit(longest(it.map(i => i.text)), 17, 60, 13, c.bs);
    return wrap('tl', `.tl .rail{position:relative;display:grid;grid-template-columns:repeat(${it.length},1fr);gap:14px}
.tl .rail:before{content:'';position:absolute;top:84px;inset-inline:0;height:3px;background:color-mix(in srgb,var(--text) 18%,transparent)}
.tl .e{display:flex;flex-direction:column;gap:10px}
.tl .when{font-family:var(--hfont);font-weight:800;font-size:${Math.round(30 * c.ts)}px;color:var(--accent);height:62px;display:flex;align-items:flex-end}
.tl .pin{width:22px;height:22px;border-radius:50%;background:var(--bg);border:5px solid var(--accent);margin:2px 0 8px}
.tl .e:nth-child(even) .pin{border-color:var(--accent2)}
.tl .x{font-family:var(--hfont);font-weight:700;line-height:1.2}.tl .y{color:var(--muted);line-height:1.45}`,
      `${head(d, c)}<div class="body"><div class="rail">${it.map(i => `<div class="e"><div class="when clamp1">${esc(i.value || '')}</div><div class="pin"></div><div class="x clamp2" style="font-size:${tfs}px">${esc(i.title)}</div><div class="y clamp4" style="font-size:${bfs}px">${esc(i.text)}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  comparison(d, c) {
    const all = [...d.left.items, ...d.right.items];
    const fs = fit(longest(all), 23, 60, 16, c.bs);
    const col = (side: { title: string; items: string[] }, k: number) => `<div class="col card ${k ? 'b' : 'a'}"><div class="ch">${esc(side.title)}</div><ul>${side.items.slice(0, 5).map(x => `<li style="font-size:${fs}px"><span class="m">${icon(k ? 'circle-check' : 'circle-check', 22, k ? 'var(--accent2)' : 'var(--accent)')}</span><span class="clamp3">${esc(x)}</span></li>`).join('')}</ul></div>`;
    return wrap('cp', `.cp .g{display:grid;grid-template-columns:1fr 84px 1fr;align-items:stretch;gap:0}
.cp .col{padding:0;overflow:hidden;display:flex;flex-direction:column}
.cp .ch{padding:20px 28px;font-family:var(--hfont);font-weight:800;font-size:${fit(longest([d.left.title, d.right.title]), 28, 22, 20, c.ts)}px;color:#fff;background:var(--accent)}
.cp .b .ch{background:var(--accent2)}
.cp ul{list-style:none;margin:0;padding:18px 28px 22px;display:flex;flex-direction:column;gap:14px}
.cp li{display:flex;gap:12px;align-items:flex-start;line-height:1.4;font-weight:500}.cp .m{flex:none;margin-top:2px}
.cp .vs{display:grid;place-items:center}.cp .vs b{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:var(--text);color:var(--bg);font-family:var(--hfont);font-weight:800;font-size:22px}`,
      `${head(d, c)}<div class="body"><div class="g">${col(d.left, 0)}<div class="vs"><b>VS</b></div>${col(d.right, 1)}</div></div>${foot(d, c)}`);
  },

  table(d, c) {
    const rows = d.rows.slice(0, 6).map(r => r.slice(0, 5));
    const cols = Math.max(d.headers.length, ...rows.map(r => r.length), 1);
    const fs = fit(longest(rows.flat()), 19, 42, 14, c.bs);
    return wrap('tb', `.tb table{width:100%;border-collapse:separate;border-spacing:0;border-radius:18px;overflow:hidden;background:var(--surface);box-shadow:0 18px 40px -24px color-mix(in srgb,var(--text) 40%,transparent)}
.tb th{background:var(--accent);color:#fff;font-family:var(--hfont);font-weight:700;text-align:start;padding:16px 20px;font-size:${Math.round(19 * c.bs)}px}
.tb td{padding:14px 20px;border-top:1px solid color-mix(in srgb,var(--text) 9%,transparent);line-height:1.35;vertical-align:top}
.tb tr:nth-child(even) td{background:color-mix(in srgb,var(--accent) 5%,var(--surface))}
.tb td:first-child{font-weight:700}`,
      `${head(d, c)}<div class="body"><table><thead><tr>${Array.from({ length: cols }, (_, i) => `<th>${esc(d.headers[i] || '')}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${Array.from({ length: cols }, (_, i) => `<td style="font-size:${fs}px"><div class="clamp3">${esc(r[i] || '')}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>${foot(d, c)}`);
  },

  stat(d, c) {
    const it = d.items.slice(0, 3);
    const bfs = fit(longest(it.map(i => i.text || i.title)), 21, 80, 16, c.bs);
    return wrap('sa', `.sa .g{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.sa .big{font-family:var(--hfont);font-weight:800;line-height:.95;letter-spacing:-3px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;padding-bottom:6px}
.sa .lbl{font-weight:700;line-height:1.3;margin-top:14px}
.sa ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px}
.sa li{display:flex;gap:16px;align-items:flex-start;padding:20px 22px}
.sa .x{font-family:var(--hfont);font-weight:700;margin-bottom:4px;font-size:${Math.round(21 * c.bs)}px}.sa .y{color:var(--muted);line-height:1.45}`,
      `${head(d, c)}<div class="body"><div class="g"><div><div class="big" style="font-size:${fit(d.value, 150, 5, 84, c.ts)}px">${esc(d.value)}</div><div class="lbl clamp3" style="font-size:${fit(d.label, 26, 60, 19, c.bs)}px">${esc(d.label)}</div></div><ul>${it.map(i => `<li class="card"><div class="ib" style="width:48px;height:48px">${icon(i.icon, 24)}</div><div>${i.title ? `<div class="x clamp1">${esc(i.title)}</div>` : ''}<div class="y clamp3" style="font-size:${bfs}px">${esc(i.text)}</div></div></li>`).join('')}</ul></div></div>${foot(d, c)}`);
  },

  stats(d, c) {
    const it = d.items.slice(0, 4);
    const vfs = fit(longest(it.map(i => i.value)), 72, 5, 40, c.ts);
    return wrap('ss', `.ss .g{display:grid;grid-template-columns:repeat(${Math.max(2, it.length)},1fr);gap:22px}
.ss .c{padding:34px 28px;display:flex;flex-direction:column;gap:12px;min-height:300px}
.ss .v{font-family:var(--hfont);font-weight:800;line-height:1;color:var(--accent);letter-spacing:-1px}
.ss .c:nth-child(even) .v{color:var(--accent2)}
.ss .x{font-family:var(--hfont);font-weight:700;line-height:1.25;font-size:${fit(longest(it.map(i => i.title)), 22, 30, 17, c.bs)}px}
.ss .y{color:var(--muted);line-height:1.45;font-size:${fit(longest(it.map(i => i.text)), 18, 70, 14, c.bs)}px}`,
      `${head(d, c)}<div class="body"><div class="g">${it.map(i => `<div class="c card">${icon(i.icon, 30, 'var(--muted)')}<div class="v" style="font-size:${vfs}px">${esc(i.value)}</div><div class="x clamp2">${esc(i.title)}</div><div class="y clamp3">${esc(i.text)}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  chart(d, c) {
    const it = d.items.slice(0, 7).map(i => ({ ...i, n: parseFloat(String(i.value).replace(/[^\d.\-]/g, '')) || 0 }));
    const max = Math.max(1, ...it.map(i => i.n));
    const lfs = fit(longest(it.map(i => i.title)), 19, 24, 14, c.bs);
    return wrap('ch', `.ch .g{display:grid;grid-template-columns:1.6fr 1fr;gap:44px;align-items:center}
.ch .bars{display:flex;flex-direction:column;gap:16px}
.ch .row{display:grid;grid-template-columns:220px 1fr 86px;gap:16px;align-items:center}
.ch .lb{font-weight:600;line-height:1.2}
.ch .tr{height:30px;border-radius:15px;background:color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.ch .fl{height:100%;border-radius:15px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.ch .vl{font-family:var(--hfont);font-weight:800;font-size:${Math.round(22 * c.bs)}px;color:var(--text)}
.ch .ins{padding:30px 28px}.ch .ins .ib{margin-bottom:16px}
.ch .ins p{margin:0;line-height:1.5;color:var(--text)}`,
      `${head(d, c)}<div class="body"><div class="g"><div class="bars">${it.map(i => `<div class="row"><div class="lb clamp2" style="font-size:${lfs}px">${esc(i.title)}</div><div class="tr"><div class="fl" style="width:${Math.max(3, (i.n / max) * 100).toFixed(1)}%"></div></div><div class="vl">${esc(i.value)}</div></div>`).join('')}</div>${d.label ? `<div class="ins card"><div class="ib">${icon('lightbulb', 28)}</div><p class="clamp5" style="font-size:${fit(d.label, 22, 110, 16, c.bs)}px">${esc(d.label)}</p></div>` : '<div></div>'}</div></div>${foot(d, c)}`);
  },

  image_points(d, c) {
    const it = d.items.slice(0, 4);
    const tfs = fit(longest(it.map(i => i.title)), 22, 24, 17, c.bs);
    const bfs = fit(longest(it.map(i => i.text)), 18, 80, 14, c.bs);
    return wrap('ip', `.ip{flex-direction:row;padding:0}
.ip .ph{width:520px;flex:none;position:relative}
.ip .ph img,.ip .ph .imgph{width:520px!important;height:720px!important;border-radius:0!important}
.ip .ph:after{content:'';position:absolute;inset:0;background:linear-gradient(${c.rtl ? 270 : 90}deg,transparent 60%,var(--bg))}
.ip .m{flex:1;padding:60px 64px 60px 40px;display:flex;flex-direction:column}
.ip ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.ip li{display:flex;gap:16px;align-items:flex-start;padding:18px 20px}
.ip .x{font-family:var(--hfont);font-weight:700;margin-bottom:4px}.ip .y{color:var(--muted);line-height:1.4}
.ip .foot{inset-inline-start:560px}`,
      `<div class="ph">${img(d.imageQuery, 520, 720, 0)}</div><div class="m">${head(d, c)}<div class="body"><ul>${it.map(i => `<li class="card"><div class="ib" style="width:46px;height:46px;border-radius:13px">${icon(i.icon, 23)}</div><div><div class="x clamp1" style="font-size:${tfs}px">${esc(i.title)}</div><div class="y clamp2" style="font-size:${bfs}px">${esc(i.text)}</div></div></li>`).join('')}</ul></div></div>${foot(d, c)}`);
  },

  image_full(d, c) {
    return wrap('if', `.if{padding:0;justify-content:flex-end}
.if .bg{position:absolute;inset:0}.if .bg img,.if .bg .imgph{width:1280px!important;height:720px!important;border-radius:0!important}
.if .ov{position:absolute;inset:0;background:linear-gradient(0deg,rgba(5,10,18,.92) 0%,rgba(5,10,18,.55) 45%,rgba(5,10,18,0) 75%)}
.if .tx{position:relative;padding:0 80px 76px;max-width:1040px}
.if h2{color:#fff}.if .cap{color:rgba(255,255,255,.86);line-height:1.45;margin-top:14px}
.if .kicker{margin-bottom:18px}.if .foot{color:rgba(255,255,255,.7)}`,
      `<div class="bg">${img(d.imageQuery, 1280, 720, 0)}</div><div class="ov"></div><div class="tx"><div class="kicker"></div><h2 class="clamp2" style="font-size:${fit(d.title, 54, 34, 36, c.ts)}px">${esc(d.title)}</h2>${d.subtitle ? `<p class="cap clamp3" style="font-size:${fit(d.subtitle, 24, 120, 18, c.bs)}px">${esc(d.subtitle)}</p>` : ''}</div>${foot(d, c)}`);
  },

  quote(d, c) {
    return wrap('qt', `.qt{justify-content:center;align-items:center;text-align:center;padding:72px 140px}
.qt .mk{font-family:Georgia,serif;font-size:220px;line-height:.6;height:110px;color:var(--accent);opacity:.9}
.qt blockquote{margin:0;font-family:var(--hfont);font-weight:700;line-height:1.3;color:var(--text)}
.qt .au{margin-top:30px;font-size:${Math.round(20 * c.bs)}px;color:var(--muted);display:flex;align-items:center;gap:14px;justify-content:center}
.qt .au:before,.qt .au:after{content:'';width:40px;height:2px;background:var(--accent2)}`,
      `<div class="mk">“</div><blockquote class="clamp5" style="font-size:${fit(d.quote || d.title, 40, 90, 26, c.ts)}px">${esc(d.quote || d.title)}</blockquote>${d.author ? `<div class="au">${esc(d.author)}</div>` : ''}${foot(d, c)}`);
  },

  cycle(d, c) {
    const it = d.items.slice(0, 6);
    const n = Math.max(3, it.length);
    const cx = 640 - 72, cy = 232, rx = 330, ry = 182;
    const fs = fit(longest(it.map(i => i.title)), 19, 18, 14, c.bs);
    const nodes = it.map((i, k) => {
      const a = (-Math.PI / 2) + (k * 2 * Math.PI) / n;
      const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
      return `<div class="nd" style="left:${(x - 105).toFixed(0)}px;top:${(y - 46).toFixed(0)}px"><div class="ib" style="width:42px;height:42px;border-radius:12px">${icon(i.icon, 21)}</div><span class="clamp2" style="font-size:${fs}px">${esc(i.title)}</span></div>`;
    }).join('');
    return wrap('cy', `.cy .stage{position:relative;height:470px;margin-top:-6px}
.cy svg.o{position:absolute;left:0;top:0}
.cy .ctr{position:absolute;left:${cx - 92}px;top:${cy - 92}px;width:184px;height:184px;border-radius:50%;display:grid;place-items:center;text-align:center;padding:20px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-family:var(--hfont);font-weight:800;font-size:${fit(d.label || '', 24, 16, 16, c.bs)}px;line-height:1.15;box-shadow:0 20px 40px -18px var(--accent)}
.cy .nd{position:absolute;width:210px;height:92px;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border-radius:18px;box-shadow:0 14px 30px -18px color-mix(in srgb,var(--text) 45%,transparent);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);font-weight:700;line-height:1.2}`,
      `${head(d, c, { center: true })}<div class="stage"><svg class="o" width="1136" height="470" viewBox="0 0 1136 470"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-dasharray="10 10" opacity=".55"/></svg><div class="ctr"><span class="clamp4">${esc(d.label || '')}</span></div>${nodes}</div>${foot(d, c)}`);
  },

  hierarchy(d, c) {
    const it = d.items.slice(0, 5);
    const n = it.length || 1;
    const fs = fit(longest(it.map(i => i.title)), 22, 22, 16, c.bs);
    const bfs = fit(longest(it.map(i => i.text)), 17, 70, 13, c.bs);
    return wrap('hi', `.hi .g{display:flex;flex-direction:column;gap:10px;align-items:center}
.hi .lv{display:grid;grid-template-columns:${'1fr'} ;align-items:center;height:${Math.min(84, Math.floor(420 / n) - 10)}px;border-radius:14px;color:#fff;padding:0 26px;text-align:center}
.hi .x{font-family:var(--hfont);font-weight:800;line-height:1.15}.hi .y{opacity:.88;line-height:1.3}`,
      `${head(d, c)}<div class="body"><div class="g">${it.map((i, k) => `<div class="lv" style="width:${40 + (60 * (k + 1)) / n}%;background:color-mix(in srgb,var(--accent) ${100 - (k * 55) / n}%,var(--accent2))"><div><div class="x clamp1" style="font-size:${fs}px">${esc(i.title)}</div>${i.text ? `<div class="y clamp1" style="font-size:${bfs}px">${esc(i.text)}</div>` : ''}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  checklist(d, c) {
    const it = d.items.slice(0, 6);
    const two = it.length > 3;
    const fs = fit(longest(it.map(i => i.title + ' ' + i.text)), 22, 70, 16, c.bs);
    return wrap('ck', `.ck .g{display:grid;grid-template-columns:${two ? '1fr 1fr' : '1fr'};gap:16px 26px;max-width:${two ? 1136 : 900}px}
.ck .i{display:flex;gap:18px;align-items:flex-start;padding:22px 24px}
.ck .ok{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.ck .x{font-family:var(--hfont);font-weight:700;line-height:1.3}.ck .y{color:var(--muted);line-height:1.45;margin-top:4px}`,
      `${head(d, c)}<div class="body"><div class="g">${it.map(i => `<div class="i card"><div class="ok">${icon('circle-check', 22, '#fff')}</div><div><div class="x clamp2" style="font-size:${fs}px">${esc(i.title)}</div>${i.text ? `<div class="y clamp2" style="font-size:${Math.round(fs * 0.82)}px">${esc(i.text)}</div>` : ''}</div></div>`).join('')}</div></div>${foot(d, c)}`);
  },

  closing(d, c) {
    const meta = [c.cover.presenter, c.cover.institution].filter(Boolean);
    return wrap('cl', `.cl{justify-content:center;align-items:center;text-align:center;background:radial-gradient(circle at 50% 120%,color-mix(in srgb,var(--accent) 40%,var(--bg)),var(--bg) 70%)}
.cl h2{font-size:${fit(d.title, 84, 20, 52, c.ts)}px;letter-spacing:-2px}
.cl .sub{margin-top:18px;max-width:900px}
.cl .meta{margin-top:40px;display:flex;gap:16px;justify-content:center;font-size:${Math.round(19 * c.bs)}px;color:var(--muted)}
.cl .brand{position:absolute;bottom:40px;left:0;right:0;display:flex;gap:10px;justify-content:center;align-items:center;font-weight:700;font-size:15px;color:var(--muted)}
.cl .brand b{background:var(--accent);color:var(--bg);border-radius:8px;padding:3px 8px;font-family:var(--hfont)}`,
      `<div class="kicker"></div><h2 class="clamp2">${esc(d.title)}</h2>${d.subtitle ? `<p class="sub clamp2" style="font-size:${Math.round(24 * c.bs)}px">${esc(d.subtitle)}</p>` : ''}${meta.length ? `<div class="meta">${meta.map(m => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>` : ''}<div class="brand"><b>MIA</b>Medical Intelligence Academy</div>`);
  },
};

export function blankSlide(layout: Layout = 'cards'): SlideData {
  return { layout, title: '', subtitle: '', items: [], left: { title: '', items: [] }, right: { title: '', items: [] }, headers: [], rows: [], value: '', label: '', quote: '', author: '', imageQuery: '', source: '' };
}

/** Repairs incomplete AI output so a template never renders broken. */
export function normalize(d: Partial<SlideData>): SlideData {
  const b = blankSlide();
  const out: SlideData = { ...b, ...d, left: { ...b.left, ...(d.left || {}) }, right: { ...b.right, ...(d.right || {}) } } as SlideData;
  if (!LAYOUTS.includes(out.layout)) out.layout = 'cards';
  out.items = (out.items || []).map(i => ({ icon: ICONS[i?.icon] ? i.icon : 'sparkles', title: String(i?.title || ''), text: String(i?.text || ''), value: String(i?.value || '') }));
  const needsItems: Layout[] = ['agenda', 'cards', 'steps', 'timeline', 'stats', 'chart', 'image_points', 'cycle', 'hierarchy', 'checklist'];
  if (needsItems.includes(out.layout) && out.items.length < 2) out.layout = out.imageQuery ? 'image_full' : 'section';
  if (out.layout === 'comparison' && (!out.left.items.length || !out.right.items.length)) out.layout = out.items.length >= 2 ? 'cards' : 'section';
  if (out.layout === 'table' && !out.rows.length) out.layout = out.items.length >= 2 ? 'cards' : 'section';
  if (out.layout === 'stat' && !out.value) out.layout = out.items.length >= 2 ? 'cards' : 'section';
  if (out.layout === 'quote' && !out.quote) out.quote = out.title;
  return out;
}

export function renderTemplate(d: SlideData, n: number, total: number, style: DeckStyle, rtl: boolean, cover: CoverInfo, deckTitle = '') {
  const data = normalize(d);
  return R[data.layout](data, { n, total, ts: style.titleScale, bs: style.bodyScale, rtl, cover, deckTitle, showNumbers: style.showNumbers });
}
