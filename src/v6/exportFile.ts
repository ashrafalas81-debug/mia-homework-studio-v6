/** One place that builds every downloadable file, used by the download menu and by chat buttons. */
import { download, filename } from '../files';
import { researchPdf, researchWord } from './docExport';
import { DEFAULT_DOC_STYLE } from './docDesign';
import { exportDeckPdf, exportPptx } from './slides';
import { themeOf } from './engine';
import type { V6Project } from './types';

export const FILE_LABELS: Record<string, string> = {
  premium_pdf: '✨ PDF Premium', classic_pdf: '📄 PDF كلاسيكي', word: '📘 Word', pptx: '🎞️ PowerPoint', deck_pdf: '📕 PDF العرض',
};
export const filesFor = (p: V6Project) => (p.kind === 'deck' ? ['pptx', 'deck_pdf'] : ['premium_pdf', 'classic_pdf', 'word']);

export async function exportFile(p: V6Project, kind: string, progress: (s: string) => void): Promise<string> {
  const name = filename(p.title);
  const rtl = (p.ro?.language || p.dk?.language) === 'Arabic';
  if (kind === 'premium_pdf') {
    const { buildPremiumPdf } = await import('./docDesign');
    const r = await buildPremiumPdf(p, p.docStyle || DEFAULT_DOC_STYLE, progress);
    download(r.blob, name + '.pdf');
    return `PDF جاهز: ${r.pages} صفحة${p.ro && r.pages !== p.ro.pages ? ` (طلبت ${p.ro.pages})` : ''}`;
  }
  if (kind === 'classic_pdf') { progress('بجهز PDF…'); const r = await researchPdf(p); download(r.blob, name + '-classic.pdf'); return `PDF كلاسيكي جاهز: ${r.pages} صفحة`; }
  if (kind === 'word') { progress('بجهز Word…'); download(await researchWord(p), name + '.docx'); return 'ملف Word جاهز'; }
  if (kind === 'pptx') { const b = await exportPptx(p.title, p.slides!, themeOf(p), rtl, i => progress(`بجهز الشريحة ${i}…`)); download(b, name + '.pptx'); return 'ملف PowerPoint جاهز'; }
  if (kind === 'deck_pdf') { const b = await exportDeckPdf(p.slides!, themeOf(p), rtl, i => progress(`بجهز الشريحة ${i}…`)); download(b, name + '.pdf'); return 'PDF العرض جاهز'; }
  throw new Error('نوع ملف غير معروف');
}
