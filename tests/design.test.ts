import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { project, themeFromPalette, themes, sanitizeSlide, type SlideSpec } from '../shared/model';
import { pickCandidates, findSlideImage } from '../server/images';

const S = (o: Partial<SlideSpec>): SlideSpec => ({ id: crypto.randomUUID(), title: 'T', type: 'concept', layout: 'cards', subtitle: null, points: ['A point'], table: null, stats: [], chart: null, imageQuery: null, sourceIds: [], speakerNotes: 'n', ...o } as SlideSpec);

it('copies a Mirror sample palette (background first, saturated accents)', () => {
  const t = themeFromPalette(['#FFFFFF', '#7B1E3A', '#F2A541', '#1D1D1D'], themes.medical);
  expect(t.bg).toBe('FFFFFF'); expect(t.dark).toBe(false); expect(t.accent).toBe('7B1E3A'); expect(t.accent2).toBe('F2A541');
  expect(themeFromPalette(['#zzz'], themes.medical)).toBe(themes.medical);
});

it('falls back to a safe layout when the model gives a chart without numbers', () => {
  expect(sanitizeSlide(S({ layout: 'chart', chart: null })).layout).toBe('cards');
  expect(sanitizeSlide(S({ layout: 'stats', stats: [] })).layout).toBe('cards');
});

const commonsJson = { query: { pages: {
  1: { title: 'File:Rotator cuff anatomy diagram.png', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.png', thumbwidth: 1200, thumbheight: 900, width: 2000, height: 1500, mime: 'image/png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.png', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a>OpenStax</a>' } } }] },
  2: { title: 'File:Rotator cuff NC.png', imageinfo: [{ thumburl: 'https://x/b.png', thumbwidth: 1200, thumbheight: 900, width: 2000, height: 1500, mime: 'image/png', extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }] },
  3: { title: 'File:Rotator cuff cadaver.jpg', imageinfo: [{ thumburl: 'https://x/c.jpg', thumbwidth: 1200, thumbheight: 900, width: 2000, height: 1500, mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
} } };

it('accepts only openly licensed, safe illustrations and credits the author', async () => {
  const c = pickCandidates(commonsJson, 'rotator cuff anatomy');
  expect(c.map(x => x.title)).toEqual(['Rotator cuff anatomy diagram.png']);
  const png = new Uint8Array(5000); png[0] = 137;
  const f = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(commonsJson)))
    .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }));
  const img = await findSlideImage('rotator cuff anatomy', f as any);
  expect(img?.data.startsWith('data:image/png;base64,')).toBe(true);
  expect(img?.attribution).toContain('OpenStax');
  expect(img?.attribution).toContain('CC BY-SA 4.0');
});

it('rejects off-topic and event photos (live-test regressions)', () => {
  const page = (title: string) => ({ title: 'File:' + title, imageinfo: [{ thumburl: 'https://x/a.jpg', thumbwidth: 1000, thumbheight: 800, width: 2000, height: 1600, mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY 2.0' } } }] });
  const json = { query: { pages: {
    1: page("L'UQROP chouette a voir (37120006362).jpg"),
    2: page('Ananda Pal Demonstrating On Shoulder Examination - 2023-07-16 1568.jpg'),
    3: page('Shoulder joint anatomy quiz.png'),
    4: page('Propped external rotator shoulder rehabilitation.jpg'),
  } } };
  expect(pickCandidates(json, 'shoulder rehabilitation exercise').map(c => c.title)).toEqual(['Propped external rotator shoulder rehabilitation.jpg']);
  expect(pickCandidates(json, 'shoulder rehabilitation exercise', ['Propped external rotator shoulder rehabilitation.jpg'])).toEqual([]);
});

it('extracts Results/Discussion from open-access full text', async () => {
  const { extractSections, fullTextExcerpts } = await import('../server/fulltext');
  const xml = '<article><front>x</front><body><sec><title>Introduction</title><p>Intro text</p></sec><sec><title>Results</title><p>Recurrence was 21% vs 34% <xref>1</xref>.</p></sec><sec><title>Discussion</title><p>Physiotherapy helps.</p></sec></body></article>';
  const t = extractSections(xml);
  expect(t).toContain('Results: Recurrence was 21% vs 34%');
  expect(t).toContain('Discussion: Physiotherapy helps.');
  expect(t).not.toContain('Intro text');
  const long = xml.replace('Physiotherapy helps.', 'Physiotherapy helps. '.repeat(30));
  const f = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ resultList: { result: [{ pmid: '123', pmcid: 'PMC9' }] } })))
    .mockResolvedValueOnce(new Response(long));
  const r = await fullTextExcerpts(['123', 'bad'], f as any);
  expect(Object.keys(r)).toEqual(['123']);
  expect(String(f.mock.calls[1][0])).toContain('/PMC9/fullTextXML');
  expect(await fullTextExcerpts(['1'], vi.fn().mockRejectedValue(new Error('offline')) as any)).toEqual({});
});

it('builds a coloured PDF with contents, diagrams and RTL tables', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildPdf } = await import('../src/pdfDesign');
  const p = project('research');
  const sec = (h: string, diagram: any = null) => ({ id: h, heading: h, paragraphs: [{ text: 'نص '.repeat(200), sourceIds: [] }], tables: [{ title: 'ت', headers: ['أ', 'ب'], rows: [['1', '2']], sourceIds: [] }], diagram });
  p.doc = { title: 'بحث', language: 'Arabic', limitations: ['ملاحظة'], sections: [sec('أ', { kind: 'flow', title: 'f', nodes: ['1', '2', '3', '4', '5'] }), sec('ب', { kind: 'cycle', title: 'c', nodes: ['1', '2', '3'] }), sec('ج', { kind: 'hierarchy', title: 'h', nodes: ['p', 'a', 'b'] })] };
  const font = async (n: string) => { const b = readFileSync('public/fonts/' + n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const r = await buildPdf(p, font);
  expect(r.pages).toBeGreaterThanOrEqual(4);
  expect(r.bytes.byteLength).toBeGreaterThan(20000);
});

it('exports diagrams into Word as editable shapes', async () => {
  const { word } = await import('../src/export');
  const p = project('research');
  p.doc = { title: 'T', language: 'English', limitations: [], sections: [{ id: 'a', heading: 'H', paragraphs: [{ text: 'x', sourceIds: [] }], tables: [], diagram: { kind: 'flow', title: 'Injury sequence', nodes: ['Abduction', 'Dislocation'] } }] };
  const blob = await word(p);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Injury sequence');
  expect(xml).toContain('Abduction');
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsElBKtKQhgw4mvRvqudExGKxWCwWi8VisVj8N14LnHJb7JxhywAAAABJRU5ErkJggg==';
it('prints the student own pictures inside their section in PDF and Word', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildPdf } = await import('../src/pdfDesign');
  const { word } = await import('../src/export');
  const p = project('research');
  p.doc = { title: 'T', language: 'English', limitations: [], sections: [{ id: 'a', heading: 'Results', paragraphs: [{ text: 'x '.repeat(50), sourceIds: [] }], tables: [], diagram: null }] };
  p.docImages = { a: [{ data: PNG, width: 40, height: 30, caption: 'my grip chart' }] };
  const font = async (n: string) => { const b = readFileSync('public/fonts/' + n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const pdf = await buildPdf(p, font);
  const text = new TextDecoder('latin1').decode(new Uint8Array(await pdf.blob.arrayBuffer()));
  expect(text).toMatch(/\/Subtype \/Image/);
  const zip = await JSZip.loadAsync(await (await word(p)).arrayBuffer());
  expect(Object.keys(zip.files).some(f => /^word\/media\//.test(f))).toBe(true);
  expect(await zip.file('word/document.xml')!.async('string')).toContain('my grip chart');
});
