/**
 * Slide engine: the AI designs each slide as HTML+SVG on a fixed 1280×720 canvas.
 * Preview: sandboxed iframe (no scripts). Export: the same markup is rasterised
 * through SVG foreignObject with fonts and images embedded, so the downloaded
 * PowerPoint / PDF looks exactly like the preview.
 */
import type { DeckTheme, SlideState } from './types';
import { api } from '../store';
import { icon } from './templates';

export const W = 1280, H = 720;

const FONT_FILES: Record<string, { file: string; arabic?: boolean }[]> = {
  Montserrat: [{ file: 'montserrat-latin' }], Poppins: [{ file: 'poppins-latin' }],
  'Playfair Display': [{ file: 'playfair-display-latin' }], Inter: [{ file: 'inter-latin' }],
  'Open Sans': [{ file: 'open-sans-latin' }], Lato: [{ file: 'lato-latin' }],
  Cairo: [{ file: 'cairo-latin' }, { file: 'cairo-arabic', arabic: true }],
  Tajawal: [{ file: 'tajawal-latin' }, { file: 'tajawal-arabic', arabic: true }],
};
const WEIGHTS = [400, 700, 800];
const ARABIC_RANGE = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF';

const fontCache = new Map<string, string>();
async function dataUrl(path: string) {
  if (fontCache.has(path)) return fontCache.get(path)!;
  const r = await fetch(path);
  if (!r.ok) return '';
  const b = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  const u = 'data:font/woff2;base64,' + btoa(s);
  fontCache.set(path, u);
  return u;
}

/** @font-face rules for the deck fonts. inline=true embeds the files (needed for export). */
export async function fontCss(theme: DeckTheme, inline = false) {
  const fams = [...new Set([theme.headingFont, theme.bodyFont, 'Cairo'])];
  const rules: string[] = [];
  for (const fam of fams) for (const f of FONT_FILES[fam] || []) for (const w of WEIGHTS) {
    const fam2 = fam === 'Playfair Display' && w === 800 ? 800 : w;
    const path = `/fonts/slides/${f.file}-${fam2}-normal.woff2`;
    if (fam === 'Lato' && w === 800) continue;
    const src = inline ? await dataUrl(path) : path;
    if (!src) continue;
    rules.push(`@font-face{font-family:'${fam}';font-weight:${w};font-display:block;src:url(${src}) format('woff2');${f.arabic ? `unicode-range:${ARABIC_RANGE};` : ''}}`);
  }
  return rules.join('\n');
}

export function baseCss(theme: DeckTheme, rtl: boolean) {
  const arabicFallback = rtl ? `'Cairo',` : '';
  return `:root,.mia-root{--bg:${theme.bg};--surface:${theme.surface};--text:${theme.text};--muted:${theme.muted};--accent:${theme.accent};--accent2:${theme.accent2};--hfont:'${theme.headingFont}',${arabicFallback}system-ui,sans-serif;--bfont:'${theme.bodyFont}',${arabicFallback}system-ui,sans-serif}
.mia-root{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:var(--bg);color:var(--text);font-family:var(--bfont);margin:0}
.mia-root *{box-sizing:border-box}
.mia-root .slide{width:${W}px;height:${H}px;position:relative;overflow:hidden;margin:0}
.mia-root h1,.mia-root h2,.mia-root h3,.mia-root p,.mia-root ul{margin-top:0}
.mia-root img{display:block;max-width:100%}
.mia-root img[data-q]:not([src]){background:color-mix(in srgb,var(--accent) 18%,var(--surface))}`;
}

/** Full document for a preview iframe. */
export async function slideDocument(html: string, theme: DeckTheme, rtl: boolean) {
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${await fontCss(theme)}\n${baseCss(theme, rtl)}\nhtml,body{margin:0;background:transparent}</style></head><body><div class="mia-root">${html}</div></body></html>`;
}

/* ───────── Real licensed images for <img data-q> placeholders ───────── */

const imageCache = new Map<string, Promise<{ data: string; attribution: string } | null>>();
export function findImage(q: string, used: string[] = []) {
  const key = q.toLowerCase().trim();
  if (!imageCache.has(key)) imageCache.set(key, api('images', { query: key.slice(0, 120), exclude: used.slice(-50) }).then(r => r.image || null).catch(() => null));
  return imageCache.get(key)!;
}

/** Replaces image placeholders with real images (data URLs) and adds a small credit line. */
export async function fillImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const imgs = [...doc.querySelectorAll('img[data-q]')] as HTMLImageElement[];
  const credits: string[] = [];
  await Promise.all(imgs.map(async img => {
    if (img.getAttribute('src')?.startsWith('data:')) return;
    const found = await findImage(img.getAttribute('data-q') || '');
    if (found) { img.setAttribute('src', found.data); credits.push(found.attribution.split(' — ')[1] || found.attribution); }
    else {
      // No suitable licensed image: use an on-brand illustrated panel instead of an empty hole.
      const ph = doc.createElement('div');
      ph.className = 'imgph';
      ph.setAttribute('style', (img.getAttribute('style') || '') + ';display:grid;place-items:center');
      const h = parseInt((img.getAttribute('style') || '').match(/height:(\d+)px/)?.[1] || '300', 10);
      ph.innerHTML = icon('heart-pulse', Math.max(48, Math.min(140, Math.round(h / 4))), 'color-mix(in srgb,var(--text) 45%,transparent)');
      img.replaceWith(ph);
    }
  }));
  const root = doc.getElementById('r')!;
  if (credits.length && !root.querySelector('.mia-credit')) {
    const c = doc.createElement('div');
    c.className = 'mia-credit';
    c.setAttribute('style', 'position:absolute;left:16px;bottom:8px;font:400 10px system-ui;color:var(--muted);opacity:.75;max-width:640px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:50');
    c.textContent = 'Image: ' + [...new Set(credits)].join(' · ');
    (root.querySelector('section.slide') || root).appendChild(c);
  }
  return root.innerHTML;
}

/* ───────── Rasterise for export ───────── */

function toXhtml(html: string) {
  const doc = new DOMParser().parseFromString(`<div class="mia-root">${html}</div>`, 'text/html');
  return new XMLSerializer().serializeToString(doc.body.firstElementChild!);
}

/** Rasterises self-contained HTML (fonts and images embedded) through SVG foreignObject. */
export async function rasterize(innerHtml: string, css: string, w: number, h: number, scale: number, bg: string, dir: 'rtl' | 'ltr', rootClass: string, type: 'image/jpeg' | 'image/png' = 'image/jpeg') {
  const doc = new DOMParser().parseFromString(`<div class="${rootClass}">${innerHtml}</div>`, 'text/html');
  const body = new XMLSerializer().serializeToString(doc.body.firstElementChild!).replace('<div ', `<div dir="${dir}" `);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/</g, '&lt;')}</style>${body}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('تعذّر تجهيز الصفحة للتصدير.')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  await new Promise(r => setTimeout(r, 60));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.86);
}

export async function renderSlide(html: string, theme: DeckTheme, rtl: boolean, scale = 1.5, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<string> {
  const css = `${await fontCss(theme, true)}\n${baseCss(theme, rtl)}`;
  return rasterize(html, css, W, H, scale, theme.bg, rtl ? 'rtl' : 'ltr', 'mia-root', type);
}

export async function exportPptx(title: string, slides: SlideState[], theme: DeckTheme, rtl: boolean, onProgress: (i: number) => void) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title; pptx.company = 'Medical Intelligence Academy'; pptx.author = 'MIA Homework Studio';
  let i = 0;
  for (const s of slides) {
    if (s.status !== 'done') continue;
    onProgress(++i);
    const slide = pptx.addSlide();
    slide.addImage({ data: await renderSlide(s.html, theme, rtl, 1.5), x: 0, y: 0, w: 13.333, h: 7.5 });
    // Hidden-to-the-eye but searchable title text for accessibility and slide sorter names.
    slide.addText(s.plan.title, { x: 0, y: 7.5, w: 13.333, h: 0.01, fontSize: 1, color: theme.bg.replace('#', '') });
    if (s.notes) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

export async function exportDeckPdf(slides: SlideState[], theme: DeckTheme, rtl: boolean, onProgress: (i: number) => void) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H], hotfixes: ['px_scaling'] });
  let first = true, i = 0;
  for (const s of slides) {
    if (s.status !== 'done') continue;
    onProgress(++i);
    if (!first) pdf.addPage([W, H], 'landscape');
    first = false;
    pdf.addImage(await renderSlide(s.html, theme, rtl, 1.5), 'JPEG', 0, 0, W, H);
  }
  return pdf.output('blob');
}
