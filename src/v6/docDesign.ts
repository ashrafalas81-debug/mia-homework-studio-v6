/**
 * Premium PDF engine for research papers and lab reports.
 * Lays the document out on real A4 pages in the browser (measured with the actual
 * fonts), splits paragraphs across pages, keeps headings with their text, builds a
 * contents page with real page numbers, then rasterises each page at print quality.
 * Line spacing is tuned automatically so the page count matches what was requested.
 */
import type { AcademicSection, Source } from '../../shared/model';
import { cited, ref } from '../../shared/model';
import { fontCss, findImage, rasterize } from './slides';
import { icon } from './templates';
import type { V6Project } from './types';

export type DocTheme = 'academic' | 'modern' | 'clinical' | 'elegant';
export type DocStyle = { theme: DocTheme; size: 'compact' | 'normal' | 'large' };
export const DEFAULT_DOC_STYLE: DocStyle = { theme: 'modern', size: 'normal' };

/** Formatting choices a student (or a professor's rules) can ask for in plain words. */
export type DocFormat = {
  numbering: 'padded' | 'decimal' | 'roman' | 'letters' | 'none';
  lineSpacing: 'auto' | '1.15' | '1.5' | '2';
  margins: 'narrow' | 'normal' | 'wide';
  pageNumber: 'end' | 'center' | 'start' | 'none';
  toc: boolean;
  abstract: boolean;
  header: string;
};
export const DEFAULT_FORMAT: DocFormat = { numbering: 'padded', lineSpacing: 'auto', margins: 'normal', pageNumber: 'end', toc: true, abstract: true, header: '' };
const LH: Record<string, number> = { '1.15': 1.45, '1.5': 1.85, '2': 2.3 };
const MARGINS = { narrow: { top: 80, bottom: 76, side: 60 }, normal: { top: 96, bottom: 88, side: 80 }, wide: { top: 110, bottom: 100, side: 104 } };

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي', 'ك', 'ل', 'م', 'ن', 'س'];
export function sectionLabel(n: number, f: DocFormat, rtl: boolean) {
  switch (f.numbering) {
    case 'none': return '';
    case 'decimal': return String(n);
    case 'roman': return ROMAN[n - 1] || String(n);
    case 'letters': return rtl ? AR_LETTERS[n - 1] || String(n) : String.fromCharCode(64 + n);
    default: return String(n).padStart(2, '0');
  }
}

/** Splits a paragraph into prose and bullet lists ("- " or "• " lines). */
export function parts(text: string): { list: boolean; lines: string[] }[] {
  const out: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isItem = /^([-•*]|\d+[.)])\s+/.test(line);
    const clean = isItem ? line.replace(/^([-•*]|\d+[.)])\s+/, '') : line;
    const last = out[out.length - 1];
    if (last && last.list === isItem && isItem) last.lines.push(clean);
    else if (last && !isItem && !last.list) last.lines.push(clean);
    else out.push({ list: isItem, lines: [clean] });
  }
  return out;
}

type T = { name: string; heading: string; body: string; ink: string; muted: string; accent: string; accent2: string; tint: string; cover: string; coverInk: string };
export const DOC_THEMES: Record<DocTheme, T> = {
  modern: { name: 'طبي عصري', heading: 'Montserrat', body: 'Inter', ink: '#13212F', muted: '#5B6B7C', accent: '#0E7C86', accent2: '#6D5DFC', tint: '#EEF7F7', cover: '#0B1B2B', coverInk: '#FFFFFF' },
  academic: { name: 'أكاديمي كلاسيكي', heading: 'Playfair Display', body: 'Lato', ink: '#1E1A17', muted: '#6B625A', accent: '#7A1F3D', accent2: '#B8902A', tint: '#FAF4EC', cover: '#24130F', coverInk: '#FFF8EE' },
  clinical: { name: 'هادي ونظيف', heading: 'Poppins', body: 'Open Sans', ink: '#0B1F3A', muted: '#5A6B85', accent: '#1D5FD0', accent2: '#0EA5A4', tint: '#EFF4FF', cover: '#F3F7FF', coverInk: '#0B1F3A' },
  elegant: { name: 'فخم', heading: 'Playfair Display', body: 'Inter', ink: '#151A16', muted: '#626B64', accent: '#1F6B47', accent2: '#B8902A', tint: '#F1F7F3', cover: '#102117', coverInk: '#FFFFFF' },
};

const PW = 794, PH = 1123;
let M = { top: 96, bottom: 88, side: 80 };
let CW = PW - 2 * M.side, CH = PH - M.top - M.bottom;
function setMargins(f: DocFormat) { M = MARGINS[f.margins] || MARGINS.normal; CW = PW - 2 * M.side; CH = PH - M.top - M.bottom; }
const SIZE = { compact: 13.6, normal: 14.6, large: 15.8 };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type Section = AcademicSection & { keyPoint?: string };
type Params = { fs: number; lh: number; ps: number };

function themeOf(p: V6Project, st: DocStyle): T {
  const t = DOC_THEMES[st.theme];
  return p.ro?.language === 'Arabic' ? { ...t, heading: 'Cairo', body: 'Cairo' } : t;
}

function css(t: T, k: Params, rtl: boolean) {
  return `
.mp{width:${PW}px;height:${PH}px;position:relative;overflow:hidden;background:#fff;color:${t.ink};font-family:'${t.body}',${rtl ? "'Cairo'," : ''}system-ui,sans-serif;--a:${t.accent};--a2:${t.accent2};--tint:${t.tint};--muted:${t.muted};--h:'${t.heading}',${rtl ? "'Cairo'," : ''}Georgia,serif}
.mp *{box-sizing:border-box}
.mp .content{position:absolute;top:${M.top}px;left:${M.side}px;width:${CW}px;height:${CH}px;overflow:hidden}
.mp .hdr{position:absolute;top:40px;left:${M.side}px;right:${M.side}px;display:flex;justify-content:space-between;gap:24px;font-size:10.5px;font-weight:700;letter-spacing:.4px;color:var(--muted);padding-bottom:10px;border-bottom:1px solid #0000001a}
.mp .hdr span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:470px}
.mp .ftr{position:absolute;bottom:36px;left:${M.side}px;right:${M.side}px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--muted);font-weight:600}
.mp .ftr .brand{display:flex;gap:7px;align-items:center}
.mp .ftr .brand b{background:var(--a);color:#fff;border-radius:5px;padding:1px 6px;font-family:var(--h);font-size:9.5px}
.mp .ftr .pg{font-weight:800;color:var(--a);font-size:12px}
.mp p{font-size:${k.fs}px;line-height:${k.lh};margin:0 0 ${k.ps}px;text-align:justify;${rtl ? '' : 'hyphens:auto;'}}
.mp p.split{text-align-last:justify}
.mp .sh{display:flex;align-items:baseline;gap:14px;margin:${Math.round(k.ps * 1.6)}px 0 ${Math.round(k.ps * 0.9)}px}
.mp .sh .n{font-family:var(--h);font-weight:800;font-size:30px;line-height:1;color:var(--a);min-width:34px}
.mp .sh h2{font-family:var(--h);font-weight:700;font-size:${Math.round(k.fs * 1.5)}px;line-height:1.25;margin:0;color:${t.ink}}
.mp .sh-wrap:first-child .sh{margin-top:0}
.mp .bar{height:3px;width:56px;border-radius:2px;background:linear-gradient(90deg,var(--a),var(--a2));margin:-4px 0 ${Math.round(k.ps * 1.1)}px ${rtl ? 'auto' : '48px'};${rtl ? 'margin-right:48px;' : ''}}
.mp .abs{background:var(--tint);border-radius:14px;padding:20px 24px;margin:0 0 ${k.ps * 2}px}
.mp .abs .lbl{font-family:var(--h);font-weight:800;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--a);margin-bottom:8px}
.mp .abs p{font-size:${(k.fs * 0.95).toFixed(1)}px;margin-bottom:8px}
.mp .kp{display:flex;gap:14px;align-items:flex-start;background:var(--tint);border-${rtl ? 'right' : 'left'}:4px solid var(--a);border-radius:12px;padding:14px 18px;margin:4px 0 ${Math.round(k.ps * 1.4)}px}
.mp .kp .lbl{font-family:var(--h);font-weight:800;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--a);margin-bottom:3px}
.mp .kp div div{font-size:${(k.fs * 0.97).toFixed(1)}px;line-height:1.5;font-weight:600}
.mp figure{margin:6px 0 ${Math.round(k.ps * 1.4)}px}
.mp figcaption{font-size:12px;color:var(--muted);margin-top:6px;font-weight:600}
.mp figcaption b{color:var(--a)}
.mp table{width:100%;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;font-size:${(k.fs * 0.86).toFixed(1)}px;line-height:1.4;border:1px solid #00000014}
.mp th{background:var(--a);color:#fff;text-align:start;padding:9px 11px;font-weight:700;font-family:var(--h)}
.mp td{padding:8px 11px;border-top:1px solid #00000012;vertical-align:top}
.mp tr:nth-child(even) td{background:var(--tint)}
.mp .rh{font-family:var(--h);font-weight:700;font-size:${Math.round(k.fs * 1.5)}px;margin:0 0 16px;padding-bottom:10px;border-bottom:3px solid var(--a)}
.mp .ref{font-size:${(k.fs * 0.84).toFixed(1)}px;line-height:1.5;margin:0 0 8px;padding-${rtl ? 'right' : 'left'}:28px;text-indent:-28px;text-align:start;word-break:break-word}
.mp .ref b{color:var(--a);display:inline-block;min-width:28px;text-indent:0}
.mp ul.bl{margin:0 0 ${k.ps}px;padding-${rtl ? 'right' : 'left'}:22px;font-size:${k.fs}px;line-height:${k.lh}}
.mp ul.bl li{margin-bottom:4px}
.mp ul.bl li::marker{color:var(--a)}
.mp .ftr.c{justify-content:center;gap:28px}.mp .ftr.s{flex-direction:row-reverse}
`;
}

/* ───────── diagrams ───────── */

function diagram(d: NonNullable<AcademicSection['diagram']>, t: T) {
  const n = d.nodes.length;
  const label = (s: string, max = 22) => esc(s.length > max ? s.slice(0, max - 1) + '…' : s);
  if (d.kind === 'cycle') {
    const W = CW, H = 300, cx = W / 2, cy = 150, rx = 230, ry = 108;
    const nodes = d.nodes.map((x, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const px = cx + rx * Math.cos(a), py = cy + ry * Math.sin(a);
      return `<g><rect x="${px - 82}" y="${py - 22}" width="164" height="44" rx="12" fill="#fff" stroke="${i % 2 ? t.accent2 : t.accent}" stroke-width="2"/><text x="${px}" y="${py + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${t.ink}">${label(x)}</text></g>`;
    }).join('');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${t.accent}" stroke-width="2" stroke-dasharray="6 7" opacity=".55"/><circle cx="${cx}" cy="${cy}" r="46" fill="${t.tint}"/>${icon('refresh-cw', 34, t.accent).replace('<svg ', `<svg x="${cx - 17}" y="${cy - 17}" `)}${nodes}</svg>`;
  }
  if (d.kind === 'hierarchy') {
    const H = 44 * n + 8 * (n - 1);
    return `<svg width="${CW}" height="${H}" viewBox="0 0 ${CW} ${H}">${d.nodes.map((x, i) => {
      const w = CW * (0.42 + (0.58 * (i + 1)) / n), xx = (CW - w) / 2, y = i * 52;
      return `<rect x="${xx}" y="${y}" width="${w}" height="44" rx="10" fill="${i % 2 ? t.accent2 : t.accent}" opacity="${1 - i * 0.1}"/><text x="${CW / 2}" y="${y + 27}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${label(x, 48)}</text>`;
    }).join('')}</svg>`;
  }
  // flow: wraps into rows of up to 4
  const per = n > 4 ? Math.ceil(n / 2) : n;
  const rows = Math.ceil(n / per);
  const gap = 34, bw = (CW - gap * (per - 1)) / per, bh = 58, H = rows * bh + (rows - 1) * 30;
  let out = '';
  d.nodes.forEach((x, i) => {
    const r = Math.floor(i / per), c = i % per;
    const xx = c * (bw + gap), y = r * (bh + 30);
    out += `<rect x="${xx}" y="${y}" width="${bw}" height="${bh}" rx="12" fill="${t.tint}" stroke="${t.accent}" stroke-width="1.8"/><text x="${xx + bw / 2}" y="${y + bh / 2 + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${t.ink}">${label(x, Math.floor(bw / 8))}</text>`;
    if (c < per - 1 && i < n - 1) out += `<path d="M${xx + bw + 6} ${y + bh / 2} H${xx + bw + gap - 8}" stroke="${t.accent}" stroke-width="2.4" marker-end="url(#ar)"/>`;
  });
  return `<svg width="${CW}" height="${H}" viewBox="0 0 ${CW} ${H}"><defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${t.accent}"/></marker></defs>${out}</svg>`;
}

/* ───────── blocks ───────── */

type Block =
  | { kind: 'sec'; html: string; sec: number }
  | { kind: 'p'; text: string }
  | { kind: 'html'; html: string; keep?: boolean }
  | { kind: 'ref'; html: string };

function blocks(p: V6Project, used: Source[], t: T, rtl: boolean, f: DocFormat): { list: Block[]; tocNames: string[] } {
  const style = p.ro?.citationStyle || 'APA';
  const sections = (p.sections || []).filter(Boolean) as Section[];
  const list: Block[] = [];
  const tocNames: string[] = [];
  let num = 0;
  sections.forEach((s, si) => {
    const isAbstract = si === 0 && /^(abstract|summary|الملخص|ملخص)/i.test(s.heading.trim());
    if (isAbstract && !f.abstract) return;
    if (isAbstract) {
      list.push({ kind: 'html', html: `<div class="abs"><div class="lbl">${esc(s.heading)}</div>${s.paragraphs.map(x => `<p>${esc(cited(x.text, x.sourceIds, used, style))}</p>`).join('')}</div>` });
      return;
    }
    num++;
    tocNames.push(s.heading);
    list.push({ kind: 'sec', sec: tocNames.length - 1, html: `<div class="sh-wrap"><div class="sh">${sectionLabel(num, f, rtl) ? `<span class="n">${sectionLabel(num, f, rtl)}</span>` : ''}<h2>${esc(s.heading)}</h2></div><div class="bar"></div></div>` });
    s.paragraphs.forEach(x => {
      const ps = parts(x.text);
      const tail = cited('', x.sourceIds, used, style).trim();
      ps.forEach((part, k) => {
        const last = k === ps.length - 1;
        if (part.list) list.push({ kind: 'html', html: `<ul class="bl">${part.lines.map((l, j) => `<li>${esc(l)}${last && j === part.lines.length - 1 && tail ? ' ' + esc(tail) : ''}</li>`).join('')}</ul>` });
        else list.push({ kind: 'p', text: part.lines.join(' ') + (last && tail ? ' ' + tail : '') });
      });
    });
    s.tables.forEach((tb, k) => list.push({ kind: 'html', html: `<figure><table><thead><tr>${tb.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><figcaption><b>${rtl ? 'جدول' : 'Table'} ${num}.${k + 1}</b> ${esc(tb.title)}</figcaption></figure>` }));
    if (s.diagram) list.push({ kind: 'html', html: `<figure>${diagram(s.diagram, t)}<figcaption><b>${rtl ? 'شكل' : 'Figure'} ${num}</b> ${esc(s.diagram.title)}</figcaption></figure>` });
    if (s.keyPoint?.trim()) list.push({ kind: 'html', html: `<div class="kp">${icon('lightbulb', 22, t.accent)}<div><div class="lbl">${rtl ? 'النقطة الأهم' : 'Key point'}</div><div>${esc(s.keyPoint)}</div></div></div>` });
  });
  if (used.length) {
    tocNames.push(rtl ? 'المراجع' : 'References');
    list.push({ kind: 'sec', sec: tocNames.length - 1, html: `<h2 class="rh">${rtl ? 'المراجع' : 'References'}</h2>` });
    const refs = used.map(s => ref(s, style));
    const ordered = style === 'Vancouver' ? refs.map((r, i) => ({ r, i })) : refs.map(r => ({ r, i: -1 })).sort((a, b) => a.r.localeCompare(b.r));
    ordered.forEach(({ r, i }) => list.push({ kind: 'ref', html: `<p class="ref">${i >= 0 ? `<b>${i + 1}.</b>` : ''}${esc(r)}</p>` }));
  }
  return { list, tocNames };
}

/* ───────── pagination ───────── */

function paginate(list: Block[], host: HTMLElement): { pages: string[]; secPage: number[] } {
  const flow = host.querySelector('.content') as HTMLElement;
  const pages: string[] = [];
  const secPage: number[] = [];
  const fits = () => flow.scrollHeight <= CH + 0.5;
  const newPage = () => { if (flow.innerHTML.trim()) pages.push(flow.innerHTML); flow.innerHTML = ''; };
  const add = (html: string) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild as HTMLElement; flow.appendChild(el); return el; };

  for (let bi = 0; bi < list.length; bi++) {
    const b = list[bi];
    if (b.kind === 'sec') {
      // Keep a heading with at least ~4 lines of its text.
      const el = add(b.html);
      const probe = add(`<p>${'xxxxx '.repeat(Math.round(CW / 9))}</p>`); // ≈ 3 lines
      const ok = flow.scrollHeight <= CH + 0.5 || (flow.children.length <= 2);
      probe.remove();
      if (!ok || !fits()) { el.remove(); newPage(); add(b.html); }
      secPage[b.sec] = pages.length;
      continue;
    }
    if (b.kind === 'p') {
      let words = esc(b.text).split(/\s+/).filter(Boolean);
      while (words.length) {
        const el = add(`<p>${words.join(' ')}</p>`);
        if (fits()) { words = []; break; }
        // Binary search the largest prefix that fits on this page.
        let lo = 0, hi = words.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); el.innerHTML = words.slice(0, mid).join(' '); if (fits()) lo = mid; else hi = mid - 1; }
        if (lo < 6) { el.remove(); newPage(); continue; } // avoid orphan fragments
        el.innerHTML = words.slice(0, lo).join(' ');
        el.classList.add('split');
        words = words.slice(lo);
        if (words.length < 6) { el.innerHTML = words.length ? el.innerHTML : el.innerHTML; }
        newPage();
      }
      continue;
    }
    const el = add(b.html);
    if (!fits()) { el.remove(); newPage(); add(b.html); }
  }
  newPage();
  return { pages, secPage };
}

/* ───────── page chrome ───────── */

function chrome(inner: string, title: string, label: string, n: number, total: number, t: T, f: DocFormat = DEFAULT_FORMAT) {
  const pg = f.pageNumber === 'none' ? '' : `<span class="pg" dir="ltr">${n} / ${total}</span>`;
  return `<div class="hdr"><span>${esc(f.header || title)}</span><span>${esc(label)}</span></div><div class="content" style="top:${M.top}px;left:${M.side}px;width:${CW}px;height:${CH}px">${inner}</div><div class="ftr ${f.pageNumber === 'center' ? 'c' : f.pageNumber === 'start' ? 's' : ''}"><span class="brand"><b>MIA</b>Medical Intelligence Academy</span>${pg}</div>`;
}

function coverPage(p: V6Project, t: T, rtl: boolean, image: string | null) {
  const c = p.cover;
  const lab = p.kind === 'lab';
  const kind = rtl ? (lab ? 'تقرير معملي' : 'بحث أكاديمي') : (lab ? 'Laboratory Report' : 'Academic Research Paper');
  const L = rtl ? { student: 'إعداد', university: 'الجامعة', faculty: 'الكلية', course: 'المادة', professor: 'إشراف', date: 'التاريخ' } : { student: 'Prepared by', university: 'University', faculty: 'Faculty', course: 'Course', professor: 'Supervised by', date: 'Date' };
  const info = (['student', 'university', 'faculty', 'course', 'professor'] as const).filter(k => c[k]?.trim()).map(k => `<div><small>${L[k]}</small><b>${esc(c[k])}</b></div>`);
  info.push(`<div><small>${L.date}</small><b>${esc(c.date || new Date().toLocaleDateString(rtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</b></div>`);
  const dark = t.cover !== '#F3F7FF';
  const titleSize = Math.max(30, Math.min(44, Math.round(44 * Math.sqrt(60 / Math.max(60, p.title.length)))));
  return `<style>
.cv{position:absolute;inset:0;background:${t.cover};color:${t.coverInk}}
.cv .top{position:absolute;top:0;left:0;right:0;height:520px;overflow:hidden}
.cv .top img{width:${PW}px;height:520px;object-fit:cover;display:block}
.cv .top .shade{position:absolute;inset:0;background:linear-gradient(180deg,${t.cover}00 30%,${t.cover} 100%)}
.cv .pattern{position:absolute;inset:0}
.cv .brand{position:absolute;top:44px;${rtl ? 'right' : 'left'}:${M.side}px;display:flex;gap:10px;align-items:center;font-weight:700;font-size:13px;color:${t.coverInk};z-index:2}
.cv .brand b{background:${t.accent};color:#fff;border-radius:7px;padding:3px 9px;font-family:var(--h)}
.cv .main{position:absolute;left:${M.side}px;right:${M.side}px;top:470px}
.cv .kind{display:flex;align-items:center;gap:12px;font-weight:800;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${dark ? t.accent2 : t.accent}}
.cv .kind:before{content:'';width:40px;height:3px;background:currentColor;border-radius:2px}
.cv h1{font-family:var(--h);font-weight:800;font-size:${titleSize}px;line-height:1.15;margin:18px 0 0;letter-spacing:-.5px}
.cv .grid{position:absolute;left:${M.side}px;right:${M.side}px;bottom:76px;display:grid;grid-template-columns:1fr 1fr;gap:18px 40px;padding-top:26px;border-top:1px solid ${dark ? '#ffffff2e' : '#0000001f'}}
.cv .grid small{display:block;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;opacity:.7;margin-bottom:4px;font-weight:700}
.cv .grid b{font-size:15px;font-weight:700}
</style><div class="cv"><div class="top">${image ? `<img src="${image}" alt=""><div class="shade"></div>` : `<svg class="pattern" width="${PW}" height="520" viewBox="0 0 ${PW} 520"><circle cx="${rtl ? 120 : 660}" cy="150" r="250" fill="${t.accent}" opacity=".22"/><circle cx="${rtl ? 220 : 560}" cy="250" r="160" fill="none" stroke="${t.accent2}" stroke-width="2" opacity=".6"/><circle cx="${rtl ? 220 : 560}" cy="250" r="210" fill="none" stroke="${t.coverInk}" stroke-width="1" stroke-dasharray="4 10" opacity=".35"/>${icon(p.kind === 'lab' ? 'microscope' : 'book-open', 120, t.coverInk).replace('<svg ', `<svg x="${rtl ? 160 : 500}" y="190" opacity=".85" `)}</svg><div class="shade"></div>`}</div>
<div class="brand"><b>MIA</b>Medical Intelligence Academy</div>
<div class="main"><div class="kind">${kind}</div><h1>${esc(p.title)}</h1></div>
<div class="grid">${info.join('')}</div></div>`;
}

function tocPage(names: string[], secPage: number[], offset: number, rtl: boolean, fmt: DocFormat = DEFAULT_FORMAT) {
  return `<h2 class="rh">${rtl ? 'المحتويات' : 'Contents'}</h2><div style="display:flex;flex-direction:column;gap:4px">${names.map((n, i) => `<div style="display:flex;align-items:baseline;gap:12px;padding:11px 0;border-bottom:1px dashed #00000022"><span style="font-family:var(--h);font-weight:800;color:var(--a);min-width:30px;font-size:15px">${i < names.length - 1 || !/References|المراجع/.test(n) ? sectionLabel(i + 1, fmt, rtl) || '•' : '—'}</span><span style="flex:1;font-weight:600;font-size:15.5px">${esc(n)}</span><span style="font-weight:800;color:var(--a);font-size:15px">${(secPage[i] ?? 0) + offset}</span></div>`).join('')}</div>`;
}

/* ───────── public API ───────── */

async function ensureFonts(t: T) {
  const id = 'mia-doc-fonts';
  if (!document.getElementById(id)) { const s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
  const el = document.getElementById(id)!;
  const add = await fontCss({ headingFont: t.heading, bodyFont: t.body } as any);
  if (!el.textContent!.includes(add.slice(0, 80))) el.textContent += add;
  await Promise.all([400, 700, 800].flatMap(w => [document.fonts.load(`${w} 16px "${t.heading}"`), document.fonts.load(`${w} 16px "${t.body}"`), document.fonts.load(`${w} 16px "Cairo"`)]).map(p => p.catch(() => null)));
}

export async function layoutDocument(p: V6Project, st: DocStyle, f: DocFormat = p.docFormat || DEFAULT_FORMAT) {
  setMargins(f);
  const t = themeOf(p, st);
  const rtl = p.ro?.language === 'Arabic';
  await ensureFonts(t);
  const ids: string[] = [];
  (p.sections || []).forEach(s => s?.paragraphs.forEach(x => x.sourceIds.forEach(id => { if (!ids.includes(id)) ids.push(id); })));
  const used = ids.map(id => p.sources.find(s => s.id === id)!).filter(Boolean);
  const { list, tocNames } = blocks(p, used, t, rtl, f);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  host.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  document.body.appendChild(host);
  // Body pages the student asked for = total − cover − contents.
  const target = Math.max(1, (p.ro?.pages || 8) - 1 - (f.toc ? 1 : 0));
  const base = SIZE[st.size];
  let best: { pages: string[]; secPage: number[]; k: Params } | null = null;
  try {
    // Try comfortable settings first; tighten a little (never below readable sizes) only if needed.
    const fixed = LH[f.lineSpacing];
    const tries: Params[] = fixed ? [{ fs: base, lh: fixed, ps: Math.round(base * 0.75) }] : [
      ...[1.62, 1.72, 1.82, 1.94, 2.05].map(lh => ({ fs: base, lh, ps: Math.round(base * (lh - 0.5)) })),
      ...[1.54, 1.48].map(lh => ({ fs: base, lh, ps: Math.round(base * (lh - 0.62)) })),
      ...[1.5, 1.44].map(lh => ({ fs: +(base - 0.7).toFixed(1), lh, ps: Math.round(base * (lh - 0.66)) })),
    ];
    for (const k of tries) {
      host.innerHTML = `<style>${css(t, k, rtl)}</style><div class="mp"><div class="content" style="top:${M.top}px;left:${M.side}px;width:${CW}px;height:${CH}px"></div></div>`;
      const r = paginate(list, host);
      const diff = Math.abs(r.pages.length - target);
      if (!best || diff < Math.abs(best.pages.length - target) || (diff === Math.abs(best.pages.length - target) && Math.abs(k.lh - 1.7) < Math.abs(best.k.lh - 1.7))) best = { ...r, k };
      if (r.pages.length === target) break;
    }
  } finally { host.remove(); }
  return { t, rtl, tocNames, f, ...best! };
}

export async function buildPremiumPdf(p: V6Project, st: DocStyle, onProgress: (text: string) => void) {
  onProgress('بصمم الصفحات…');
  const L = await layoutDocument(p, st);
  const front = L.f.toc ? 2 : 1;
  const total = L.pages.length + front;
  const label = L.rtl ? (p.kind === 'lab' ? 'تقرير معملي' : 'بحث أكاديمي') : (p.kind === 'lab' ? 'Laboratory Report' : 'Research Paper');
  let image: string | null = null;
  try { image = (await findImage(p.queries?.[0] || p.title))?.data || null; } catch { image = null; }
  const style = `${await fontCss({ headingFont: L.t.heading, bodyFont: L.t.body } as any, true)}\n${css(L.t, L.k, L.rtl)}`;
  const htmlPages = [
    coverPage(p, L.t, L.rtl, image),
    ...(L.f.toc ? [chrome(tocPage(L.tocNames, L.secPage, front + 1, L.rtl, L.f), p.title, label, 2, total, L.t, L.f)] : []),
    ...L.pages.map((inner, i) => chrome(inner, p.title, label, i + front + 1, total, L.t, L.f)),
  ];
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  for (let i = 0; i < htmlPages.length; i++) {
    onProgress(`بجهز صفحة ${i + 1} من ${htmlPages.length}…`);
    const png = await rasterize(htmlPages[i], style, PW, PH, 1.75, '#ffffff', L.rtl ? 'rtl' : 'ltr', 'mp');
    if (i) pdf.addPage('a4', 'portrait');
    pdf.addImage(png, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  }
  pdf.setProperties({ title: p.title, author: p.cover.student || 'MIA Homework Studio', creator: 'MIA Homework Studio' });
  return { blob: pdf.output('blob'), pages: htmlPages.length };
}

/** Page images for the in-app preview of the designed PDF. */
export async function previewPages(p: V6Project, st: DocStyle, max = 4) {
  const L = await layoutDocument(p, st);
  const front = L.f.toc ? 2 : 1;
  const total = L.pages.length + front;
  const label = L.rtl ? 'بحث أكاديمي' : 'Research Paper';
  const style = `${await fontCss({ headingFont: L.t.heading, bodyFont: L.t.body } as any, true)}\n${css(L.t, L.k, L.rtl)}`;
  const pages = [coverPage(p, L.t, L.rtl, null), ...(L.f.toc ? [chrome(tocPage(L.tocNames, L.secPage, front + 1, L.rtl, L.f), p.title, label, 2, total, L.t, L.f)] : []), ...L.pages.slice(0, Math.max(0, max - front)).map((inner, i) => chrome(inner, p.title, label, i + front + 1, total, L.t, L.f))];
  return { total, images: await Promise.all(pages.map(h => rasterize(h, style, PW, PH, 0.6, '#ffffff', L.rtl ? 'rtl' : 'ltr', 'mp'))) };
}
