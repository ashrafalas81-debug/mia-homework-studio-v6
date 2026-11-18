/**
 * MIA professional PDF: coloured cover, table of contents, numbered section headings,
 * styled tables, native diagrams (flow / cycle / hierarchy), callout boxes, running
 * header/footer and references. Free: jsPDF + jspdf-autotable in the browser.
 */
import { projectTheme, used, ref, cited, type Project } from '../shared/model';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)) as RGB;
const WHITE: RGB = [255, 255, 255], INK: RGB = [33, 37, 41], GREY: RGB = [108, 117, 125];

function base64(b: ArrayBuffer) {
  let s = '';
  const u = new Uint8Array(b);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function buildPdf(p: Project, loadFont: (name: string) => Promise<ArrayBuffer> = async name => {
  const r = await fetch('/fonts/' + name);
  if (!r.ok) throw new Error('PDF fonts could not load. Retry while online.');
  return r.arrayBuffer();
}) {
  if (!p.doc) throw new Error('No document.');
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (const [name, style] of [['Academic.ttf', 'normal'], ['Academic-Bold.ttf', 'bold']]) {
    doc.addFileToVFS(name, base64(await loadFont(name)));
    doc.addFont(name, 'Academic', style);
  }
  const W = 210, H = 297, M = 20, CW = W - 2 * M, TOP = 26, BOTTOM = 276;
  const t = projectTheme(p);
  const accent = rgb(t.accent), accent2 = rgb(t.accent2);
  const primary: RGB = t.dark ? rgb(t.bg) : mix(accent, [0, 0, 0], 0.35);
  const soft = mix(accent, WHITE, 0.9);
  const rtl = /arab/i.test(p.doc.language);
  const sources = used(p);
  const X = rtl ? W - M : M, align = rtl ? 'right' : 'left';
  let y = TOP;
  let figure = 0, tableNo = 0;
  const toc: { title: string; page: number }[] = [];

  const font = (size: number, bold = false, color: RGB = INK) => {
    doc.setFont('Academic', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const fill = (c: RGB) => doc.setFillColor(...c);
  const newPage = () => { doc.addPage(); y = TOP; };
  const need = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const write = (text: string, size = 10.5, opts: { bold?: boolean; color?: RGB; gap?: number; indent?: number; width?: number } = {}) => {
    font(size, opts.bold, opts.color);
    const width = (opts.width ?? CW) - (opts.indent ?? 0);
    const lh = size * 0.42 + 1.6;
    // Arabic: jsPDF does not mirror brackets, so swap them; Latin-only lines are left untouched.
    const mirror = (l: string) => rtl && /[\u0600-\u06ff]/.test(l) ? l.replace(/[\[\]()]/g, ch => ({ '[': ']', ']': '[', '(': ')', ')': '(' } as Record<string, string>)[ch]) : l;
    // Arabic citation markers read better as "— مرجع 1" (no closing bracket for the bidi engine to move) — strong Arabic letters keep the numbers in place.
    if (rtl && /[\u0600-\u06ff]/.test(text)) text = text.replace(/\s*\[(\d[\d,\s–-]*)\]/g, ' — مرجع $1');
    for (const raw of doc.splitTextToSize(text, width) as string[]) {
      const line = mirror(raw);
      need(lh);
      doc.text(line, rtl ? X - (opts.indent ?? 0) : X + (opts.indent ?? 0), y, { align });
     
      y += lh;
    }
    y += opts.gap ?? 2.5;
  };

  // ---------- Cover ----------
  const c = p.cover;
  fill(primary); doc.rect(0, 0, W, 175, 'F');
  doc.setGState(new (doc as any).GState({ opacity: 0.18 }));
  fill(accent); doc.circle(W - 15, 25, 55, 'F');
  fill(accent2); doc.circle(W - 45, 150, 30, 'F');
  fill(WHITE); doc.circle(20, 160, 18, 'F');
  doc.setGState(new (doc as any).GState({ opacity: 1 }));
  fill(accent); doc.rect(M, 62, 28, 2.2, 'F');
  if (c.university || c.faculty) { font(11, true, mix(WHITE, accent, 0.25)); doc.text([c.university, c.faculty].filter(Boolean).join(' — '), M, 52); }
  font(28, true, WHITE);
  const titleLines = doc.splitTextToSize(p.doc.title, CW - 10) as string[];
  doc.text(titleLines.slice(0, 4), rtl ? W - M : M, 80, { align, lineHeightFactor: 1.15 });
  const sub = p.brief?.taskType === 'lab-report' ? (rtl ? 'تقرير معملي' : 'Laboratory Report') : rtl ? 'بحث أكاديمي' : 'Academic Research Paper';
  font(13, false, mix(WHITE, primary, 0.15)); doc.text(sub, M, 80 + titleLines.slice(0, 4).length * 11.5 + 4);
  const coverImg = Object.values(p.slideImages || {})[0];
  if (coverImg) {
    try {
      const ratio = (coverImg.width || 4) / (coverImg.height || 3); let w = 70, h = w / ratio; if (h > 60) { h = 60; w = h * ratio; }
      fill(WHITE); doc.roundedRect(W - M - w - 3, 182, w + 6, h + 6, 2, 2, 'F');
      doc.addImage(coverImg.data, W - M - w, 185, w, h);
      font(6, false, GREY); doc.text(doc.splitTextToSize(coverImg.attribution, w + 6) as string[], W - M - w - 3, 185 + h + 7);
    } catch { /* unsupported image type: skip */ }
  }
  const info: [string, string][] = ([
    [rtl ? 'الطالب' : 'Student', c.student], [rtl ? 'المادة' : 'Course', c.course], [rtl ? 'إشراف' : 'Supervisor', c.professor],
    [rtl ? 'القسم' : 'Department', c.department], [rtl ? 'العام' : 'Year', c.year], [rtl ? 'التاريخ' : 'Date', c.date || new Date().toLocaleDateString(rtl ? 'ar-EG' : 'en-GB')],
  ] as [string, string][]).filter(([, v]) => v);
  let iy = 192;
  for (const [k, v] of info) {
    font(8, true, accent); doc.text(k.toUpperCase(), M, iy);
    font(12, k === (rtl ? 'الطالب' : 'Student'), INK); doc.text(String(v).slice(0, 60), M, iy + 6);
    iy += 14;
  }
  fill(accent); doc.rect(0, H - 8, W, 8, 'F');

  // ---------- Contents (filled at the end) ----------
  newPage();
  const tocPage = doc.getNumberOfPages();
  newPage();

  // ---------- Body ----------
  p.doc.sections.forEach((s, idx) => {
    need(30);
    if (y > TOP + 2) y += 4;
    toc.push({ title: s.heading, page: doc.getNumberOfPages() });
    fill(accent); doc.circle(rtl ? W - M - 5 : M + 5, y - 1.5, 5, 'F');
    font(10, true, WHITE); doc.text(String(idx + 1), rtl ? W - M - 5 : M + 5, y + 0.2, { align: 'center' });
    font(15, true, primary);
    const hl = doc.splitTextToSize(s.heading, CW - 14) as string[];
    doc.text(hl, rtl ? W - M - 13 : M + 13, y, { align });
    y += hl.length * 6.6;
    doc.setDrawColor(...mix(accent, WHITE, 0.6)); doc.setLineWidth(0.4); doc.line(M, y - 2, W - M, y - 2);
    y += 4;
    for (const para of s.paragraphs) {
      if (!para.text.trim()) continue;
      write(cited(para.text, para.sourceIds, sources, p.settings.citationStyle), 10.5, { gap: 3.2 });
    }
    for (const tb of s.tables) {
      need(25);
      tableNo++;
      write(`${rtl ? 'جدول' : 'Table'} ${tableNo}: ${tb.title}`, 9.5, { bold: true, color: primary, gap: 1.5 });
      // Arabic: columns run right-to-left, and cells are drawn by us (autotable re-reverses Arabic glyphs).
      const head = rtl ? [tb.headers.slice().reverse()] : [tb.headers];
      const body = rtl ? tb.rows.map(r => r.slice().reverse()) : tb.rows;
      autoTable(doc, {
        startY: y, head, body,
        ...(rtl ? {
          willDrawCell: (d: any) => { d.cell.__lines = d.cell.text; d.cell.text = []; },
          didDrawCell: (d: any) => {
            const size = d.cell.styles.fontSize, lh = size * 0.3528 * 1.15;
            doc.setFont('Academic', d.section === 'head' ? 'bold' : 'normal'); doc.setFontSize(size);
            const col = d.cell.styles.textColor; doc.setTextColor(...(Array.isArray(col) ? col : INK) as RGB);
            (d.cell.__lines || []).forEach((line: string, k: number) =>
              doc.text(line, d.cell.x + d.cell.width - d.cell.padding('right'), d.cell.y + d.cell.padding('top') + size * 0.3528 * 0.9 + k * lh, { align: 'right' }));
          },
        } : {}),
        margin: { left: M, right: M, top: TOP, bottom: H - BOTTOM },
        styles: { font: 'Academic', fontSize: 9, cellPadding: 2.6, textColor: INK, lineColor: mix(accent, WHITE, 0.75), lineWidth: 0.2, halign: rtl ? 'right' : 'left' },
        headStyles: { font: 'Academic', fontStyle: 'bold', fillColor: accent, textColor: t.dark ? rgb(t.bg) : WHITE },
        alternateRowStyles: { fillColor: soft },
        rowPageBreak: 'avoid',
      });
      y = (doc as any).lastAutoTable.finalY + 7;
    }
    const dg = s.diagram;
    if (dg && dg.nodes?.length >= 2) drawDiagram(dg);
    for (const im of p.docImages?.[s.id] || []) drawPicture(im);
  });

  function drawPicture(im: { data: string; width: number; height: number; caption: string }) {
    const ratio = (im.width || 4) / (im.height || 3);
    let w = Math.min(CW * 0.8, 150), h = w / ratio;
    if (h > 110) { h = 110; w = h * ratio; }
    need(h + 16);
    const x = M + (CW - w) / 2;
    try {
      fill(soft); doc.roundedRect(x - 2, y - 2, w + 4, h + 4, 2, 2, 'F');
      doc.addImage(im.data, x, y, w, h);
    } catch { return; }
    y += h + 5;
    figure++;
    write(`${rtl ? 'شكل' : 'Figure'} ${figure}: ${im.caption}`, 8.5, { color: GREY, gap: 5 });
  }

  function drawDiagram(dg: NonNullable<Project['doc']>['sections'][number]['diagram'] & {}) {
    const nodes = dg.nodes.slice(0, 7).map(n => n.slice(0, 48));
    figure++;
    const boxText = (label: string, x: number, yy: number, w: number, h: number, color: RGB) => {
      fill(color); doc.roundedRect(x, yy, w, h, 2.5, 2.5, 'F');
      font(8.5, true, WHITE);
      const lines = (doc.splitTextToSize(label, w - 4) as string[]).slice(0, 3);
      doc.text(lines, x + w / 2, yy + h / 2 - (lines.length - 1) * 1.8 + 1, { align: 'center' });
    };
    const arrow = (x1: number, y1: number, x2: number, y2: number) => {
      doc.setDrawColor(...GREY); doc.setLineWidth(0.6); doc.line(x1, y1, x2, y2);
      const a = Math.atan2(y2 - y1, x2 - x1), L = 2.4;
      fill(GREY); doc.triangle(x2, y2, x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45), x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45), 'F');
    };
    const colorAt = (i: number) => (i % 2 ? mix(accent2, [0, 0, 0], 0.1) : accent);
    let height = 0;
    if (dg.kind === 'cycle') height = 78;
    else if (dg.kind === 'hierarchy') height = 46;
    else height = Math.ceil(nodes.length / 4) * 24 + 4;
    need(height + 16);
    fill(soft); doc.roundedRect(M, y - 2, CW, height + 4, 3, 3, 'F');
    const top = y + 2;
    if (dg.kind === 'cycle') {
      const cx = W / 2, cy = top + 36, R = 28, bw = 38, bh = 13;
      const pts = nodes.map((_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length; return [cx + R * 1.35 * Math.cos(a), cy + R * Math.sin(a)]; });
      pts.forEach(([px, py], i) => { const [qx, qy] = pts[(i + 1) % pts.length]; const dx = qx - px, dy = qy - py, d = Math.hypot(dx, dy); arrow(px + dx / d * 16, py + dy / d * 8, qx - dx / d * 17, qy - dy / d * 9); });
      pts.forEach(([px, py], i) => boxText(nodes[i], px - bw / 2, py - bh / 2, bw, bh, colorAt(i)));
    } else if (dg.kind === 'hierarchy') {
      const kids = nodes.slice(1), bw = Math.min(40, (CW - 8 - (kids.length - 1) * 4) / Math.max(kids.length, 1));
      boxText(nodes[0], W / 2 - 30, top, 60, 13, primary);
      const rowY = top + 26, total = kids.length * bw + (kids.length - 1) * 4, x0 = W / 2 - total / 2;
      kids.forEach((k, i) => { const x = x0 + i * (bw + 4); arrow(W / 2, top + 13, x + bw / 2, rowY - 0.5); boxText(k, x, rowY, bw, 15, colorAt(i)); });
    } else {
      const per = 4, bw = (CW - 8 - (per - 1) * 9) / per, bh = 16;
      nodes.forEach((nd, i) => {
        // Snake layout: every second row runs backwards so the down-arrow lands on the next box.
        const row = Math.floor(i / per), col = i % per, snake = row % 2 ? per - 1 - col : col, k = rtl ? per - 1 - snake : snake;
        const x = M + 4 + k * (bw + 9), yy = top + row * 24;
        boxText(nd, x, yy, bw, bh, colorAt(i));
        if (i < nodes.length - 1) {
          const leftward = (row % 2 === 1) !== rtl;
          if (col < per - 1) arrow(leftward ? x - 0.5 : x + bw + 0.5, yy + bh / 2, leftward ? x - 8.5 : x + bw + 8.5, yy + bh / 2);
          else arrow(x + bw / 2, yy + bh + 0.5, x + bw / 2, yy + 23.5);
        }
      });
    }
    y = top + height + 4;
    write(`${rtl ? 'شكل' : 'Figure'} ${figure}: ${dg.title}`, 8.5, { color: GREY, gap: 5 });
  }

  // ---------- Notes / limitations callout ----------
  if (p.doc.limitations.length) {
    const text = p.doc.limitations.join('\n• ');
    font(9.5);
    const lines = doc.splitTextToSize('• ' + text, CW - 12) as string[];
    const h = lines.length * 5.6 + 14;
    need(Math.min(h, 120));
    const warm = mix(accent2, WHITE, 0.85);
    fill(warm); doc.roundedRect(M, y, CW, Math.min(h, BOTTOM - y), 3, 3, 'F');
    fill(accent2); doc.rect(M, y, 2, Math.min(h, BOTTOM - y), 'F');
    y += 7;
    write(rtl ? 'ملاحظات للمراجعة' : 'Review notes', 11, { bold: true, color: mix(accent2, [0, 0, 0], 0.4), indent: 6, gap: 1 });
    write('• ' + text, 9.5, { indent: 6, width: CW - 6, gap: 6 });
  }

  // ---------- References ----------
  if (sources.length) {
    need(30); y += 4;
    toc.push({ title: rtl ? 'المراجع' : 'References', page: doc.getNumberOfPages() });
    font(15, true, primary); doc.text(rtl ? 'المراجع' : 'References', X, y, { align }); y += 4;
    doc.setDrawColor(...mix(accent, WHITE, 0.6)); doc.line(M, y, W - M, y); y += 6;
    sources.forEach((s, i) => {
      const label = p.settings.citationStyle === 'Vancouver' ? `${i + 1}.` : '•';
      font(9, true, accent); need(6); doc.text(label, M, y);
      font(9, false, INK);
      for (const line of doc.splitTextToSize(ref(s, p.settings.citationStyle), CW - 8) as string[]) { need(4.6); doc.text(line, M + 8, y); y += 4.4; }
      y += 2;
    });
  }

  // ---------- Contents page ----------
  doc.setPage(tocPage);
  y = 34;
  font(22, true, primary); doc.text(rtl ? 'المحتويات' : 'Contents', X, y, { align }); y += 5;
  fill(accent); doc.rect(rtl ? W - M - 22 : M, y, 22, 1.4, 'F'); y += 12;
  toc.forEach((e, i) => {
    if (y > BOTTOM) return;
    font(11, false, INK);
    const name = (doc.splitTextToSize(`${i + 1}.  ${e.title}`, CW - 20) as string[])[0];
    doc.text(name, X, y, { align });
    font(11, true, accent); doc.text(String(e.page), rtl ? M : W - M, y, { align: rtl ? 'left' : 'right' });
    doc.setDrawColor(...mix(GREY, WHITE, 0.7)); doc.setLineDashPattern([0.6, 1.2], 0);
    doc.line(rtl ? M + 8 : M + Math.min(doc.getTextWidth(name) + 3, CW - 12), y + 0.5, rtl ? W - M - Math.min(doc.getTextWidth(name) + 3, CW - 12) : W - M - 8, y + 0.5);
    doc.setLineDashPattern([], 0);
    y += 9;
  });

  // ---------- Running header / footer ----------
  const n = doc.getNumberOfPages();
  for (let i = 2; i <= n; i++) {
    doc.setPage(i);
    fill(accent); doc.rect(0, 0, W, 3, 'F');
    font(7.5, false, GREY);
    doc.text((doc.splitTextToSize(p.doc.title, 120) as string[])[0], M, 12);
    if (c.student) doc.text(c.student, W - M, 12, { align: 'right' });
    doc.setDrawColor(...mix(GREY, WHITE, 0.75)); doc.setLineWidth(0.2); doc.line(M, 284, W - M, 284);
    font(8, true, accent); doc.text(`${i} / ${n}`, W / 2, 290, { align: 'center' });
  }
  return { blob: doc.output('blob') as Blob, pages: n, bytes: doc.output('arraybuffer') as ArrayBuffer };
}
