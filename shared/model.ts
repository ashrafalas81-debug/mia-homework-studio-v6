import { z } from 'zod';

const str = z.string();

export const Brief = z.object({
  title: str,
  taskType: z.enum([
    'short-answer',
    'long-form',
    'medical-report',
    'comparison',
    'case-study',
    'critical-discussion',
    'pico',
    'literature-review',
    'research-proposal',
    'presentation',
    'file-operation',
    'lab-report',
  ]),
  subject: str,
  specialty: str,
  objective: str,
  professorIntent: str,
  requirements: z.array(
    z.object({
      text: str,
      origin: z.enum(['confirmed', 'inferred', 'student']),
    }).strict()
  ),
  requiredSections: z.array(str),
  deliverable: str,
  requestedCount: z.number().int().nullable(),
  countUnit: z.enum(['pages', 'slides']).nullable(),
  language: str.nullable(),
  academicLevel: str.nullable(),
  referencesRequired: z.boolean().nullable(),
  citationStyle: z.enum(['Vancouver', 'APA']).nullable(),
  formatting: z.array(str),
  deadline: str.nullable(),
  rubric: z.array(str),
  ambiguousInstructions: z.array(str),
  missingInformation: z.array(str),
  searchQuery: str,
}).strict();

export const Table = z.object({
  title: str,
  headers: z.array(str),
  rows: z.array(z.array(str)),
  sourceIds: z.array(str),
}).strict();

export const Section = z.object({
  id: str,
  heading: str,
  paragraphs: z.array(
    z.object({
      text: str,
      sourceIds: z.array(str),
    }).strict()
  ),
  tables: z.array(Table),
  diagram: z.object({
    kind: z.enum(['flow', 'cycle', 'hierarchy']),
    title: str,
    nodes: z.array(str),
  }).strict().nullable().default(null),
}).strict();

export const Doc = z.object({
  title: str,
  language: str,
  sections: z.array(Section),
  limitations: z.array(str),
}).strict();

export const SLIDE_LAYOUTS = ['cover', 'section', 'cards', 'split', 'image', 'pathway', 'timeline', 'comparison', 'stats', 'chart', 'statement', 'quote'] as const;

export const Slide = z.object({
  id: str,
  title: str,
  type: str,
  layout: z.enum(SLIDE_LAYOUTS),
  subtitle: str.nullable(),
  points: z.array(str),
  table: Table.nullable(),
  stats: z.array(z.object({ value: str, label: str }).strict()),
  chart: z.object({
    kind: z.enum(['bar', 'pie', 'line']),
    title: str,
    labels: z.array(str),
    values: z.array(z.number()),
    unit: str,
  }).strict().nullable(),
  imageQuery: str.nullable(),
  sourceIds: z.array(str),
  speakerNotes: str,
}).strict();

export const DeckOutline = z.object({
  title: str,
  subtitle: str,
  slides: z.array(z.object({
    title: str,
    layout: z.enum(SLIDE_LAYOUTS),
    keyMessage: str,
  }).strict()),
}).strict();
export type OutlineSlide = z.infer<typeof DeckOutline>['slides'][number];

export const Deck = z.object({
  title: str,
  language: str,
  slides: z.array(Slide),
  terms: z.array(
    z.object({
      term: str,
      explanation: str,
    }).strict()
  ),
  questions: z.array(
    z.object({
      question: str,
      answer: str,
      sourceIds: z.array(str),
    }).strict()
  ),
  script: str,
  limitations: z.array(str),
}).strict();

export type TaskBrief = z.infer<typeof Brief>;
export type AcademicDocument = z.infer<typeof Doc>;
export type Presentation = z.infer<typeof Deck>;
export type AcademicSection = z.infer<typeof Section>;
export type SlideSpec = z.infer<typeof Slide>;
export type Tool = 'assignment' | 'research' | 'filemaker' | 'present';

export type Source = {
  id: string;
  title: string;
  authors: string[];
  year: string | null;
  journal: string;
  pmid: string | null;
  doi: string | null;
  url: string;
  abstract: string;
  accessLevel: 'metadata' | 'abstract';
  publicationTypes: string[];
  retracted: boolean;
  concerns: string[];
  retrievedAt: string;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  recordType?: 'article' | 'book' | 'guideline' | 'other';
  provenance?: string;
};

export type Settings = {
  language: string;
  count: number;
  duration: number;
  theme: string;
  writingLevel: string;
  citationStyle: 'Vancouver' | 'APA' | 'Harvard';
  naturalWriting: boolean;
  voiceSample: string;
  allowPaid: boolean;
};

export const defaults: Settings = {
  language: 'English',
  count: 12,
  duration: 10,
  theme: 'medical',
  writingLevel: 'Standard University English',
  citationStyle: 'Vancouver',
  naturalWriting: true,
  voiceSample: '',
  allowPaid: false,
};

export type Attachment = {
  id: string;
  name: string;
  size: number;
  pages: number | null;
  role: 'instructions' | 'support' | 'template';
  text: string;
  warnings: string[];
  visual?: MirrorDesign;
};

export type Version = {
  at: string;
  label?: string;
  doc: AcademicDocument | null;
  deck: Presentation | null;
};

export type ChatQuickOption = {
  label: string;
  value: string;
  field?: 'language' | 'count' | 'citationStyle' | 'confirmPlan' | 'action';
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  toolCalls?: {
    toolName: string;
    status: 'running' | 'completed' | 'failed';
    summary: string;
    artifactId?: string;
  }[];
  quickOptions?: ChatQuickOption[];
  requiresConfirmation?: boolean;
};

export type PlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export type PlanStep = {
  id: string;
  toolName: string;
  labelAr: string;
  labelEn: string;
  dependsOn: string[];
  status: PlanStepStatus;
  attempts: number;
  maxAttempts: number;
  inputFingerprint: string;
  outputArtifactId: string | null;
  error: string | null;
  startedAt?: string;
  completedAt?: string;
};

export type ExecutionPlan = {
  id: string;
  deliverables: Tool[];
  chainedResearchToDeck: boolean;
  confirmedByStudent: boolean;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
};

export type ArtifactMeta = {
  id: string;
  kind: 'brief' | 'evidence' | 'document' | 'presentation' | 'export' | 'filemaker';
  title: string;
  format?: 'docx' | 'pdf' | 'pptx' | 'txt';
  createdAt: string;
  sourceArtifactIds: string[];
  sourceEvidenceIds: string[];
  summary: string;
  downloadName?: string;
  sizeBytes?: number;
};

export type MirrorDesign = {
 kind: string; palette: string[]; structure: string[]; styleNotes: string;
};
export type MirrorProfile = {
 source:string; headings:string[]; words:number; pages:number; language:string;
 citationStyle:'APA'|'Vancouver'|null; references:number; paragraphWords:number;
 voice:string; styleSample:string; design?: MirrorDesign;
};
export type Project = {
  slideImages?: Record<string, {data:string; attribution:string; width?:number; height?:number; title?:string; own?:boolean}>;
  /** Student's own pictures placed inside document sections (rendered in PDF and Word). */
  docImages?: Record<string, {data:string; width:number; height:number; caption:string}[]>;
  /** Pictures the student sent before any deck/document existed. */
  pendingImages?: {name:string; data:string; width:number; height:number; target?: 'deck'|'doc'|'both'}[];
  mirror?: MirrorProfile;
  revision?: number;

  id: string;
  title: string;
  tool: Tool;
  deliverables?: Tool[];
  instructions: string;
  attachments: Attachment[];
  brief: TaskBrief | null;
  confirmed: boolean;
  settings: Settings;
  doc: AcademicDocument | null;
  deck: Presentation | null;
  viva?: {active: boolean; asked: number; scores: number[]; startedAt: number};
  deckBuild?: {key: string; total: number; results: any[]; outline?: {title: string; subtitle: string; slides: OutlineSlide[]}};
  sources: Source[];
  selected: string[];
  searches: { query: string; database: string; at: string; count: number; filter?: string; omitted?: number }[];
  history: Version[];
  exports: { at: string; name: string }[];
  status: string;
  createdAt: string;
  updatedAt: string;
  cover: {
    enabled: boolean;
    student: string;
    university: string;
    faculty: string;
    department: string;
    course: string;
    professor: string;
    year: string;
    date: string;
  };
  usage: any[];
  messages?: ChatMessage[];
  plan?: ExecutionPlan | null;
  artifacts?: ArtifactMeta[];
};

export function project(tool: Tool = 'assignment'): Project {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: 'New project',
    tool,
    deliverables: [tool],
    instructions: '',
    attachments: [],
    brief: null,
    confirmed: false,
    settings: { ...defaults },
    doc: null,
    deck: null,
    sources: [],
    selected: [],
    searches: [],
    history: [],
    exports: [],
    status: 'draft',
    createdAt: at,
    updatedAt: at,
    cover: {
      enabled: false,
      student: '',
      university: '',
      faculty: '',
      department: '',
      course: '',
      professor: '',
      year: '',
      date: '',
    },
    usage: [],
    messages: [],
    plan: null,
    artifacts: [],
  };
}

export type Theme = { bg: string; fg: string; accent: string; accent2: string; surface: string; muted: string; dark: boolean };
export const themes: Record<string, Theme> = {
  medical: { bg: '0B1E33', fg: 'FFFFFF', accent: '2EC4B6', accent2: 'FF9F1C', surface: '13304D', muted: 'A9BCD0', dark: true },
  minimal: { bg: 'FFFFFF', fg: '14213D', accent: '2563EB', accent2: 'F59E0B', surface: 'F1F5F9', muted: '64748B', dark: false },
  clinical: { bg: '0F172A', fg: 'F8FAFC', accent: 'E0B872', accent2: '38BDF8', surface: '1E293B', muted: '94A3B8', dark: true },
  conference: { bg: 'F7F9FC', fg: '102A43', accent: '0E9F92', accent2: 'E4572E', surface: 'FFFFFF', muted: '627D98', dark: false },
};

/** Theme for a project: the Mirror sample's colours when chosen, otherwise the selected preset. */
export function projectTheme(p: Pick<Project, 'settings' | 'mirror'>): Theme {
  if (p.settings.theme === 'mirror') return themeFromPalette(p.mirror?.design?.palette, themes.medical);
  return themes[p.settings.theme] || themes.medical;
}

const hexOk = (h: string) => /^[0-9A-F]{6}$/i.test(h.replace('#', ''));
const lum = (h: string) => { const n = parseInt(h, 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** Builds a slide theme from colours read off a Mirror sample (e.g. a photo of a past presentation). */
export function themeFromPalette(palette: string[] | undefined, fallback: Theme): Theme {
  const cols = (palette || []).map(c => c.replace('#', '').toUpperCase()).filter(hexOk);
  if (cols.length < 2) return fallback;
  // The vision model lists the background colour first, then the most prominent colours.
  const background = cols[0];
  const dark = lum(background) < 0.5;
  const chroma = (h: string) => { const n = parseInt(h, 16); const c = [n >> 16, (n >> 8) & 255, n & 255]; return Math.max(...c) - Math.min(...c); };
  const accents = cols.slice(1)
    .filter(c => Math.abs(lum(c) - lum(background)) > 0.12 && chroma(c) > 40); // keep the sample's prominence order
  return {
    bg: background,
    fg: dark ? 'FFFFFF' : '14213D',
    accent: accents[0] || fallback.accent,
    accent2: accents[1] || fallback.accent2,
    surface: dark ? mix(background, 'FFFFFF', 0.08) : mix(background, '000000', 0.04),
    muted: dark ? 'B8C4D2' : '5B6B7F',
    dark,
  };
}
function mix(a: string, b: string, t: number) {
  const x = parseInt(a, 16), y = parseInt(b, 16);
  const c = [16, 8, 0].map(sh => Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t));
  return c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function slideProblems(s: z.infer<typeof Slide>) {
  const out: string[] = [];
  if (s.title.length > 78) out.push('Title exceeds 78 characters');
  if (
    s.points.length > 5 ||
    s.points.some((x) => x.length > 170) ||
    s.points.join(' ').length > 620
  )
    out.push('Too much slide text');
  if (
    s.table &&
    (s.table.rows.length > 5 ||
      s.table.headers.length > 4 ||
      s.table.rows.some((r) => r.some((c) => c.length > 95)))
  )
    out.push('Table too dense');
  return out;
}

function clipText(input: string, maxLen: number): { clipped: string; overflow: string } {
  const clean = input.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return { clipped: clean, overflow: '' };
  const cut = clean.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const clipped = (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
  const overflow = clean.slice(clipped.length - 1).trim();
  return { clipped, overflow };
}

export function sanitizeSlide(s: SlideSpec): SlideSpec {
  const extraNotes: string[] = [];
  const titleClip = clipText(s.title || 'Slide', 78);
  if (titleClip.overflow) extraNotes.push(`Full title: ${s.title}`);

  const rawPoints = (s.points || []).filter((p) => p && p.trim());
  const keptPoints = rawPoints.slice(0, 5).map((pt) => {
    const c = clipText(pt, 168);
    if (c.overflow) extraNotes.push(pt);
    return c.clipped;
  });
  if (rawPoints.length > 5) {
    extraNotes.push(...rawPoints.slice(5));
  }
  while (keptPoints.join(' ').length > 615 && keptPoints.length > 1) {
    const idx = keptPoints.reduce((maxI, cur, i, arr) => (cur.length > arr[maxI].length ? i : maxI), 0);
    if (!extraNotes.includes(rawPoints[idx])) extraNotes.push(rawPoints[idx]);
    keptPoints[idx] = clipText(keptPoints[idx], Math.max(60, keptPoints[idx].length - 35)).clipped;
  }

  let table = s.table;
  if (table) {
    const headers = table.headers.slice(0, 4).map((h) => clipText(h, 90).clipped);
    const rows = table.rows.slice(0, 5).map((r) =>
      headers.map((_, ci) => clipText(r[ci] || '', 92).clipped)
    );
    table = {
      ...table,
      headers,
      rows,
    };
  }

  const speakerNotes = [s.speakerNotes?.trim() || '', ...extraNotes].filter(Boolean).join('\n');
  const layout = (SLIDE_LAYOUTS as readonly string[]).includes(s.layout) ? s.layout : 'cards';
  const stats = (s.stats || []).filter(x => x?.value?.trim() && x?.label?.trim()).slice(0, 4)
    .map(x => ({ value: clipText(x.value, 12).clipped, label: clipText(x.label, 70).clipped }));
  const chart = s.chart && s.chart.labels?.length >= 2 && s.chart.values?.length === s.chart.labels.length &&
    s.chart.values.every(v => Number.isFinite(v)) ? { ...s.chart, labels: s.chart.labels.slice(0, 8), values: s.chart.values.slice(0, 8) } : null;
  const fixedLayout = layout === 'stats' && !stats.length ? 'cards' : layout === 'chart' && !chart ? 'cards' :
    layout === 'comparison' && !table ? 'cards' : layout;
  const needsPoints = !['cover', 'section', 'quote', 'statement', 'stats', 'chart', 'comparison'].includes(fixedLayout);
  return {
    ...s,
    layout: fixedLayout as SlideSpec['layout'],
    subtitle: s.subtitle ? clipText(s.subtitle, 140).clipped : null,
    title: titleClip.clipped,
    points: keptPoints.length ? keptPoints : needsPoints ? [s.subtitle || s.title] : [],
    table,
    stats,
    chart,
    imageQuery: s.imageQuery?.trim() ? s.imageQuery.trim().slice(0, 90) : null,
    speakerNotes: speakerNotes || s.title,
  };
}

export function normalizeDeck(deck: Presentation): Presentation {
  return {
    ...deck,
    slides: deck.slides.map(sanitizeSlide),
  };
}

export function used(p: Project) {
  const ids = [
    ...(p.doc?.sections.flatMap((s) => [
      ...s.paragraphs.flatMap((x) => x.sourceIds),
      ...s.tables.flatMap((t) => t.sourceIds),
    ]) || []),
    ...(p.deck?.slides.flatMap((s) => s.sourceIds) || []),
    ...(p.deck?.questions.flatMap((q) => q.sourceIds) || []),
  ];
  return [...new Set(ids)]
    .map((id) => p.sources.find((s) => s.id === id))
    .filter((s): s is Source => !!s);
}

export function ref(s: Source, style: 'APA' | 'Vancouver' | 'Harvard') {
  const a = s.authors.slice(0, 6).join(', ') || '[Authors not supplied]';
  const volIssue = [
    s.volume ? s.volume : '',
    s.issue ? `(${s.issue})` : '',
  ].join('');
  const locator = [volIssue, s.pages ? s.pages : ''].filter(Boolean).join(style === 'APA' ? ', ' : ':');
  if (style === 'Harvard') {
    const loc = [s.volume, s.issue ? `(${s.issue})` : '', s.pages ? ', pp. ' + s.pages : ''].filter(Boolean).join('');
    return `${a} (${s.year || 'n.d.'}) '${s.title.replace(/\.$/, '')}', ${s.journal}${loc ? ', ' + loc : ''}. ${s.doi ? 'doi:' + s.doi : 'Available at: ' + s.url}.`.replace(/\s+/g, ' ').trim();
  }
  if (style === 'APA') {
    const journalPart = [s.journal, locator].filter(Boolean).join(', ');
    return `${a} (${s.year || 'n.d.'}). ${s.title}${s.title.endsWith('.') ? '' : '.'} ${journalPart}${journalPart.endsWith('.') ? '' : '.'} ${
      s.doi ? 'https://doi.org/' + s.doi : s.url
    }`.replace(/\s+/g, ' ').trim();
  }
  const vancLocator = [s.year || '[Year unavailable]', locator].filter(Boolean).join(';');
  return `${a}. ${s.title}${s.title.endsWith('.') ? '' : '.'} ${s.journal}. ${vancLocator}. ${
    s.doi ? 'doi:' + s.doi + '. ' : ''
  }${s.pmid ? 'PMID: ' + s.pmid + '. ' : ''}${s.url}`.replace(/\s+/g, ' ').trim();
}

export function cited(
  text: string,
  ids: string[],
  sources: Source[],
  style: 'APA' | 'Vancouver' | 'Harvard'
) {
  return (
    text +
    (ids.length
      ? ' ' +
        ids
          .map((id) => {
            const i = sources.findIndex((s) => s.id === id),
              s = sources[i];
            return !s
              ? '[UNKNOWN SOURCE]'
              : style === 'APA' || style === 'Harvard'
              ? `(${(s.authors[0] || 'Author unavailable').split(' ')[0]}${s.authors.length > 1 ? ' et al.' : ''}, ${s.year || 'n.d.'})`
              : `[${i + 1}]`;
          })
          .join(' ')
      : '')
  );
}

const UNSUPPORTED_CLINICAL_PATTERNS: { pattern: RegExp; warning: string }[] = [
  {
    pattern: /hawkins[-\s]?kennedy[^.]*\b(capsular\s+stretch|posterior\s+capsule\s+stretch)\b/i,
    warning:
      'Clinical accuracy flag: Hawkins–Kennedy is a subacromial impingement provocation test (internal rotation in 90° forward flexion), not primarily a capsular stretch test. Verify against orthopedic examination textbooks.',
  },
  {
    pattern: /\b(\d{1,3}\s*%\s*(sensitivity|specificity|healing|recovery|cure|success))\b/i,
    warning:
      'Quantitative diagnostic/prognostic percentage stated; ensure the exact figure is supported by an attached source abstract.',
  },
  {
    pattern: /\b(complete\s+tendon\s+healing\s+in\s+\d+\s*(days|weeks)|guaranteed\s+recovery)\b/i,
    warning:
      'Prognostic overstatement flag: tendon healing timelines vary by tear grade, vascularity and rehabilitation; avoid absolute healing guarantees.',
  },
];

export function flagUnsupportedClaims(p: Project): string[] {
  const flags: string[] = [];
  const paragraphs = p.doc?.sections.flatMap((s) => s.paragraphs) || [];
  for (const para of paragraphs) {
    for (const rule of UNSUPPORTED_CLINICAL_PATTERNS) {
      if (rule.pattern.test(para.text) && (!para.sourceIds.length || rule.pattern.source.includes('hawkins'))) {
        if (!flags.includes(rule.warning)) flags.push(rule.warning);
      }
    }
  }
  const slides = p.deck?.slides || [];
  for (const sl of slides) {
    const combined = [sl.title, ...sl.points, sl.speakerNotes].join(' ');
    for (const rule of UNSUPPORTED_CLINICAL_PATTERNS) {
      if (rule.pattern.test(combined) && (!sl.sourceIds.length || rule.pattern.source.includes('hawkins'))) {
        if (!flags.includes(rule.warning)) flags.push(rule.warning);
      }
    }
  }
  return flags;
}

export function quality(p: Project) {
  const warnings: string[] = [];
  if (!p.confirmed) warnings.push('Task brief has not been confirmed.');
  if (!p.doc && !p.deck) warnings.push('No generated content.');
  if (
    p.brief?.taskType === 'comparison' &&
    p.doc &&
    !p.doc.sections.some((s) => s.tables.length)
  )
    warnings.push('Comparison table is missing.');
  if (p.deck) {
    if (
      p.brief?.countUnit === 'slides' &&
      p.brief.requestedCount !== null &&
      p.deck.slides.length !== p.brief.requestedCount
    )
      warnings.push('Slide count differs from the task brief.');
    p.deck.slides.forEach((s, i) =>
      slideProblems(s).forEach((m) => warnings.push(`Slide ${i + 1}: ${m}`))
    );
  }
  const headings = [
    ...(p.doc?.sections.map((s) => s.heading.toLowerCase()) || []),
    ...(p.deck?.slides.map((s) => s.title.toLowerCase()) || []),
  ];
  for (const r of p.brief?.requiredSections || [])
    if (
      !headings.some(
        (h) => h.includes(r.toLowerCase()) || r.toLowerCase().includes(h)
      )
    )
      warnings.push('Review topic coverage: ' + r);
  const paragraphs = p.doc?.sections.flatMap((s) => s.paragraphs) || [];
  const seen = new Set<string>();
  for (const para of paragraphs) {
    const n = para.text.trim().toLowerCase();
    if (seen.has(n) && n) warnings.push('Duplicate paragraph detected.');
    seen.add(n);
  }
  const ids = p.sources.map((s) => s.id);
  if (paragraphs.some((x) => x.sourceIds.some((id) => !ids.includes(id))))
    warnings.push('Unknown source identifier.');
  if (p.deck?.slides.some((x) => x.sourceIds.some((id) => !ids.includes(id))))
    warnings.push('A slide refers to an unknown source identifier.');
  if (used(p).length)
    warnings.push('Source metadata may be verified, but each claim still needs human review against the available abstract or full text.');
  if (!used(p).length)
    warnings.push(
      'No verified references linked. Review clinical claims before submission.'
    );
  if (
    p.tool === 'research' &&
    paragraphs.some((x) => x.text.length > 120 && !x.sourceIds.length)
  )
    warnings.push(
      'Some paragraphs have no linked evidence; review factual statements.'
    );
  if (p.brief?.countUnit === 'pages')
    warnings.push(
      'Check the actual exported PDF page count; Word pagination can vary.'
    );
  for (const f of flagUnsupportedClaims(p)) warnings.push(f);
  return warnings;
}

export function eligibleEvidence(s: Source) {
  return !s.retracted && s.accessLevel === 'abstract' && !!s.abstract.trim();
}

export function researchReady(p: Pick<Project, 'sources' | 'selected'>) {
  return p.sources.some((s) => p.selected.includes(s.id) && eligibleEvidence(s));
}

export function scoreSourceQuality(s: Source, queryTerms: string[] = []): { score: number; reason: string } {
  if (!eligibleEvidence(s)) {
    return {
      score: -100,
      reason: s.retracted
        ? 'Excluded: Retracted publication'
        : 'Excluded: Metadata only (no abstract available to verify findings)',
    };
  }
  let score = 20;
  const reasons: string[] = ['Verified abstract available'];
  const types = (s.publicationTypes || []).join(' ').toLowerCase();
  if (/practice guideline|guideline|consensus/i.test(types)) {
    score += 35;
    reasons.push('Clinical Practice Guideline');
  } else if (/systematic review|meta-analysis/i.test(types)) {
    score += 30;
    reasons.push('Systematic Review / Meta-Analysis');
  } else if (/randomized controlled trial|clinical trial/i.test(types)) {
    score += 25;
    reasons.push('Controlled Clinical Trial / RCT');
  } else if (/comparative study|observational|cohort/i.test(types)) {
    score += 18;
    reasons.push('Comparative / Observational Study');
  } else if (/review|book/i.test(types) || s.recordType === 'book') {
    score += 14;
    reasons.push(s.recordType === 'book' ? 'Reference Book / StatPearls Chapter' : 'Literature Review');
  }

  const haystack = `${s.title} ${s.abstract}`.toLowerCase();
  let matched = 0;
  for (const term of queryTerms) {
    if (term.length >= 3 && haystack.includes(term.toLowerCase().replace(/s$/, ''))) matched++;
  }
  if (queryTerms.length && matched === 0) return {score:-50, reason:'Not auto-selected: no topic-term overlap; inspect relevance manually'};
  if (matched > 0) {
    score += Math.min(25, matched * 6);
    reasons.push(`Matches ${matched} key topic term(s)`);
  }
  if (s.abstract.length > 350) {
    score += 5;
    reasons.push('Structured detailed abstract');
  }
  return { score, reason: reasons.join(' · ') };
}

export function recommendEvidence(
  sources: Source[],
  query = '',
  maxCount = 8
): { selectedIds: string[]; rationale: Record<string, string> } {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !['and', 'the', 'for', 'with', 'from', 'review', 'study', 'clinical', 'anatomy', 'scientific', 'references', 'research', 'summary', 'presentation', 'evidence', 'based', 'overview', 'literature'].includes(w));
  const rationale: Record<string, string> = {};
  const scored = sources.map((s) => {
    const res = scoreSourceQuality(s, terms);
    rationale[s.id] = res.reason;
    return { source: s, score: res.score };
  });
  const selectedIds = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map((x) => x.source.id);
  return { selectedIds, rationale };
}
