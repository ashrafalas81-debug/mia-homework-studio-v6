import {
  used,
  ref,
  cited,
  projectTheme,
  type Project,
} from '../shared/model';

export function plain(p: Project) {
  if (!p.doc) throw new Error('No document.');
  const sources = used(p);
  return [
    p.doc.title,
    ...p.doc.sections.flatMap((s) => [
      s.heading,
      ...s.paragraphs.map((x) =>
        cited(x.text, x.sourceIds, sources, p.settings.citationStyle)
      ),
      ...(s.diagram?.nodes?.length ? [`Figure: ${s.diagram.title} — ${s.diagram.nodes.join(' → ')}`] : []),
      ...s.tables.flatMap((t) => [
        t.title,
        t.headers.join(' | '),
        ...t.rows.map((r) => r.join(' | ')),
      ]),
    ]),
    ...p.doc.limitations,
    ...sources.map((s) => ref(s, p.settings.citationStyle)),
  ].join('\n\n');
}

export async function word(p: Project) {
  if (!p.doc) throw new Error('No document.');
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    PageBreak,
    Footer,
    PageNumber,
    AlignmentType,
    BorderStyle,
    ImageRun,
  } = await import('docx');
  const source = used(p),
    rtl = /arab/i.test(p.doc.language),
    children: any[] = [];
  const paragraph = (text: string, heading?: any) =>
    new Paragraph({
      children: [new TextRun({ text, font: 'Arial', rightToLeft: rtl })],
      heading,
      bidirectional: rtl,
      spacing: { after: 160, line: 320 },
      keepNext: !!heading,
    });
  if (p.cover.enabled) {
    children.push(
      paragraph(p.cover.university, HeadingLevel.HEADING_1),
      paragraph(p.cover.faculty),
      paragraph(p.doc.title, HeadingLevel.TITLE)
    );
    for (const [k, v] of Object.entries(p.cover))
      if (v && k !== 'enabled' && k !== 'university' && k !== 'faculty')
        children.push(paragraph(k + ': ' + v));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  children.push(paragraph(p.doc.title, HeadingLevel.TITLE));
  for (const s of p.doc.sections) {
    children.push(paragraph(s.heading, HeadingLevel.HEADING_1));
    s.paragraphs.forEach((x) =>
      cited(x.text, x.sourceIds, source, p.settings.citationStyle)
        .split('\n')
        .forEach((t) => children.push(paragraph(t)))
    );
    for (const t of s.tables) {
      children.push(paragraph(t.title, HeadingLevel.HEADING_2));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [t.headers, ...t.rows].map(
            (row, i) =>
              new TableRow({
                tableHeader: i === 0,
                children: row.map(
                  (text) =>
                    new TableCell({
                      children: [paragraph(text)],
                      shading: i === 0 ? { fill: 'E5F3F2' } : undefined,
                    })
                ),
              })
          ),
        })
      );
    }
    // Native, editable diagram: coloured boxes joined by arrows (flow/cycle) or parent + children (hierarchy).
    const dg = s.diagram;
    if (dg && dg.nodes?.length >= 2) {
      const accent = projectTheme(p).accent;
      const box = (text: string, fill = accent) => new TableCell({
        shading: { fill },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 })] })],
      });
      const arrowCell = (ch: string) => new TableCell({
        borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ch, bold: true, size: 24, color: '6C757D' })] })],
      });
      const nodes = dg.nodes.slice(0, 7);
      if (dg.kind === 'hierarchy') {
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
          new TableRow({ children: [box(nodes[0], '0B1E33')] }),
        ] }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: nodes.slice(1).map(n => box(n)) })] }));
      } else {
        const cells: any[] = [];
        nodes.forEach((n, i) => { cells.push(box(n)); if (i < nodes.length - 1) cells.push(arrowCell('→')); });
        if (dg.kind === 'cycle') cells.push(arrowCell('↻'));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cells })] }));
      }
      children.push(new Paragraph({ children: [new TextRun({ text: 'Figure: ' + dg.title, italics: true, size: 18, color: '6C757D' })] }));
    }
    // The student's own pictures for this section.
    for (const im of p.docImages?.[s.id] || []) {
      const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(im.data);
      if (!m) continue;
      const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      const wpx = Math.min(520, im.width), hpx = Math.round(wpx * im.height / Math.max(1, im.width));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: m[1] === 'png' ? 'png' : 'jpg', data: bytes, transformation: { width: wpx, height: Math.min(hpx, 640) } } as any)] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: (rtl ? 'شكل: ' : 'Figure: ') + im.caption, italics: true, size: 18, color: '6C757D' })] }));
    }
  }
  if (p.doc.limitations.length) {
    children.push(paragraph('Limitations / Review notes', HeadingLevel.HEADING_1));
    p.doc.limitations.forEach((s) => children.push(paragraph(s)));
  }
  if (source.length) {
    children.push(paragraph('References', HeadingLevel.HEADING_1));
    source.forEach((s, i) =>
      children.push(
        paragraph(
          (p.settings.citationStyle === 'Vancouver' ? i + 1 + '. ' : '') +
            ref(s, p.settings.citationStyle)
        )
      )
    );
  }
  return Packer.toBlob(
    new Document({
      title: p.doc.title,
      creator: p.cover.student || 'Student',
      styles: {
        default: { document: { run: { font: 'Arial', size: 24 } } },
      },
      sections: [
        {
          properties: {
            page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ children: [PageNumber.CURRENT] })],
                }),
              ],
            }),
          },
          children,
        },
      ],
    })
  );
}

function base64(b: ArrayBuffer) {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
}

export async function pdf(p: Project) {
  const { buildPdf } = await import('./pdfDesign');
  const r = await buildPdf(p);
  return { blob: r.blob, pages: r.pages };
}

export function preparation(p: Project, kind: string): Project {
  const d = p.deck;
  if (!d) throw new Error('No presentation.');
  const sec = (heading: string, text: string, sourceIds: string[] = []) => ({
    id: crypto.randomUUID(),
    heading,
    paragraphs: [{ text, sourceIds }],
    tables: [],
    diagram: null,
  });
  return {
    ...p,
    doc: {
      title: d.title + ' — ' + kind,
      language: d.language,
      sections:
        kind === 'notes'
          ? d.slides.map((s, i) =>
              sec(i + 1 + '. ' + s.title, s.speakerNotes, s.sourceIds)
            )
          : kind === 'script'
          ? [sec('Presentation script', d.script)]
          : d.questions.map((q) => sec(q.question, q.answer, q.sourceIds)),
      limitations: d.limitations,
    },
  };
}
