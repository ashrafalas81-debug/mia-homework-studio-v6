import { defaults, project as blank, type AcademicSection, type Project } from '../../shared/model';
import type { V6Project } from './types';

/** Adapts a v6 research/lab project to the proven PDF and Word design engines. */
export function toLegacy(p: V6Project): Project {
  const base = blank('research');
  const o = p.ro!;
  const sections = (p.sections || []).filter(Boolean) as AcademicSection[];
  return {
    ...base,
    id: p.id,
    title: p.title,
    settings: { ...defaults, language: o.language, citationStyle: o.citationStyle, theme: 'conference' },
    doc: { title: p.title, language: o.language, sections, limitations: [] },
    sources: p.sources,
    selected: p.sources.map(s => s.id),
    brief: (o.path === 'lab' ? { taskType: 'lab-report' } : null) as any,
    cover: { enabled: true, student: p.cover.student, university: p.cover.university, faculty: p.cover.faculty, department: '', course: p.cover.course, professor: p.cover.professor, year: '', date: p.cover.date || new Date().toLocaleDateString('en-GB') },
    docImages: {},
  };
}

export async function researchPdf(p: V6Project) {
  const { buildPdf } = await import('../pdfDesign');
  return buildPdf(toLegacy(p));
}

export async function researchWord(p: V6Project) {
  const { word } = await import('../export');
  return word(toLegacy(p));
}
