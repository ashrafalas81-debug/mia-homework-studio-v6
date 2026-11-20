/**
 * Orchestrates the three paths. Long jobs are broken into small parallel calls,
 * so the preview fills in live and nothing waits on one giant request.
 */
import type { AcademicSection, Source } from '../../shared/model';
import { ref } from '../../shared/model';
import { api } from '../store';
import { fillImages } from './slides';
import { DEFAULT_STYLE, effectiveTheme, FONT_PAIRS, normalize, PALETTES, renderTemplate } from './templates';
import { DEFAULT_DOC_STYLE, DEFAULT_FORMAT } from './docDesign';
import { filesFor } from './exportFile';
import type { DeckTheme, Msg, SlideState, V6Project } from './types';

export type Ctx = {
  get: () => V6Project;
  update: (fn: (p: V6Project) => void) => void;
  say: (content: string, tone?: Msg['tone'], files?: string[]) => void;
  progress: (text: string) => void;
  signal: AbortSignal;
};

const post = (path: string, body: any, signal?: AbortSignal) => api('v6/' + path, body, signal);

export async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const errors: unknown[] = [];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { await fn(items[i], i); } catch (e) { errors.push(e); if ((e as any)?.name === 'AbortError') throw e; }
    }
  }));
  return errors;
}

async function retry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if ((e as any)?.name === 'AbortError') throw e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}

const ar = (p: V6Project) => (p.ro?.language || p.dk?.language) === 'Arabic';
export const wordsIn = (s: AcademicSection | null) => s ? s.paragraphs.reduce((n, x) => n + x.text.split(/\s+/).filter(Boolean).length, 0) : 0;

/* ───────────────────────── Research & Lab ───────────────────────── */

/** Gives every section its own slice of the evidence so citations spread across many real references. */
export function distribute(sources: Source[], sections: number, per = 8) {
  if (!sources.length) return Array.from({ length: sections }, () => [] as Source[]);
  return Array.from({ length: sections }, (_, i) => {
    const pick: Source[] = [];
    for (let k = 0; k < Math.min(per, sources.length); k++) pick.push(sources[(i * Math.ceil(per / 2) + k) % sources.length]);
    return [...new Map(pick.map(s => [s.id, s])).values()];
  });
}

const slim = (s: Source) => ({ id: s.id, title: s.title, year: s.year, abstract: s.abstract.slice(0, 1400) });

async function writeSection(ctx: Ctx, i: number, given: Source[], instruction?: string) {
  const p = ctx.get();
  const res = await retry(() => post('research/section', {
    options: p.ro, title: p.title, outline: p.outline!.map(o => o.heading), section: p.outline![i], index: i,
    sourceIds: given.map(s => s.id), sources: given.map(slim),
    ...(instruction ? { instruction, previous: (({ figure: _f, ...rest }: any) => rest)(p.sections![i] || {}) } : {}),
  }, ctx.signal));
  ctx.update(q => { const fig = (q.sections![i] as any)?.figure; q.sections![i] = fig ? { ...res.section, figure: fig } : res.section; });
}

export async function runResearch(ctx: Ctx) {
  const o = ctx.get().ro!;
  ctx.progress('بخطط هيكل البحث…');
  const plan = await retry(() => post('research/plan', o, ctx.signal));
  ctx.update(p => { p.title = plan.title; p.outline = plan.sections; p.queries = plan.queries; p.sections = plan.sections.map(() => null); });
  ctx.say(`خطة البحث جاهزة: **${plan.sections.length} أجزاء** بحوالي **${plan.totalWords} كلمة** عشان يطلع ${o.pages} صفحة.`, 'progress');

  let sources: Source[] = [];
  if (o.sourceMode !== 'none') {
    ctx.progress(o.sourceMode === 'scientific' ? 'بدوّر في PubMed و Europe PMC على مراجع حقيقية…' : 'بدوّر في قواعد البيانات الأكاديمية على مراجع حقيقية…');
    const want = Math.min(40, Math.max(o.minRefs + 6, 12));
    const r = await retry(() => post('sources', { queries: plan.queries.slice(0, 5), mode: o.sourceMode, recentYears: o.recentYears, want }, ctx.signal));
    sources = r.sources;
    ctx.update(p => { p.sources = sources; });
    const short = sources.length < o.minRefs;
    ctx.say(`لقيت **${sources.length} مرجع حقيقي** من ${r.via}، كلهم ليهم ملخص منشور واتأكدت إنهم موجودين فعلًا.${short ? ` ده أقل من الـ ${o.minRefs} اللي طلبتهم، فهكمّل بالموجود ومش هألّف أي مرجع.` : ''}`, short ? 'error' : 'progress');
  }

  const per = distribute(sources, plan.sections.length, Math.max(6, Math.ceil((o.minRefs * 2) / plan.sections.length) + 3));
  let done = 0;
  ctx.progress(`بكتب الأجزاء مع بعض… 0/${plan.sections.length}`);
  const errors = await pool(plan.sections, 4, async (_s, i) => {
    await writeSection(ctx, i, per[i]);
    ctx.progress(`بكتب الأجزاء مع بعض… ${++done}/${plan.sections.length}`);
  });
  finishResearch(ctx, errors.length);
}

function finishResearch(ctx: Ctx, failed: number) {
  const p = ctx.get();
  const written = p.sections!.filter(Boolean) as AcademicSection[];
  const words = written.reduce((n, s) => n + wordsIn(s), 0);
  const cited = new Set(written.flatMap(s => [...s.paragraphs.flatMap(x => x.sourceIds), ...s.tables.flatMap(t => t.sourceIds)]));
  ctx.update(q => { q.status = failed ? 'error' : 'ready'; q.progress = ''; q.lastError = failed ? `${failed} أجزاء وقفت بسبب ضغط أو خطأ مؤقت في خدمة الذكاء الاصطناعي` : ''; });
  if (failed) ctx.say(`اتكتب ${written.length} من ${p.sections!.length} أجزاء. فيه ${failed} جزء وقف بسبب ضغط على خدمة الذكاء الاصطناعي — اكتب "كمّل" وأنا أكمّله.`, 'error');
  else ctx.say(`البحث جاهز ✅\n- **${words.toLocaleString('en')} كلمة** في ${written.length} أجزاء\n- **${cited.size} مرجع** مستخدم فعلًا جوه الكلام${p.ro!.sourceMode !== 'none' ? ` (${p.ro!.citationStyle})` : ''}\n\nتقدر تنزّله PDF أو Word، أو قولّي أعدّل إيه. مثال: "الجزء التالت ناشف زوّد أمثلة" أو "ضيف جزء عن العلاج الطبيعي".`, 'success', ['premium_pdf', 'word']);
}

export async function resumeResearch(ctx: Ctx) {
  const p = ctx.get();
  if (!p.sections?.some(Boolean)) return runResearch(ctx); // stopped before any part was written: start clean
  const missing = p.sections!.map((s, i) => (s ? -1 : i)).filter(i => i >= 0);
  if (!missing.length) return finishResearch(ctx, 0);
  const per = distribute(p.sources, p.outline!.length);
  ctx.update(q => { q.status = 'working'; });
  const errors = await pool(missing, 3, async i => writeSection(ctx, i, per[i]));
  finishResearch(ctx, errors.length);
}

export function referenceList(p: V6Project) {
  const ids = new Set((p.sections || []).filter(Boolean).flatMap(s => s!.paragraphs.flatMap(x => x.sourceIds)));
  return p.sources.filter(s => ids.has(s.id)).map(s => ref(s, p.ro?.citationStyle || 'APA'));
}

/* ───────────────────────── Presentation ───────────────────────── */

const STYLE_PALETTE: Record<string, string> = { clinical: 'clinical', modern: 'navy', academic: 'ivory', bold: 'bold' };

export function baseTheme(p: V6Project): DeckTheme {
  const pal = PALETTES.find(x => x.id === STYLE_PALETTE[p.dk?.style || 'clinical'])!.theme;
  const arabic = p.dk?.language === 'Arabic';
  const fonts = arabic ? { headingFont: 'Cairo', bodyFont: 'Cairo' } : p.dk?.style === 'academic' ? { headingFont: 'Playfair Display', bodyFont: 'Lato' } : { headingFont: 'Montserrat', bodyFont: 'Inter' };
  return { ...pal, ...fonts };
}
export const themeOf = (p: V6Project) => effectiveTheme(p.theme || baseTheme(p), p.style || DEFAULT_STYLE);
const refsText = (p: V6Project) => p.sources.slice(0, 20).map(s => `${s.id} = ${(s.authors[0] || '').split(' ')[0]} ${s.year || ''}`).join('\n');

/** Draws a template slide (free, instant) and inserts real images. */
async function drawSlide(p: V6Project, i: number) {
  const s = p.slides![i];
  if (!s.data || s.custom) return s.html;
  return fillImages(renderTemplate(s.data, i + 1, p.slides!.length, p.style || DEFAULT_STYLE, p.dk?.language === 'Arabic', p.coverInfo || { presenter: '', institution: '', date: '' }, p.title));
}

/** Re-renders every template slide after a style, cover, order or text change. No AI call. */
export async function redraw(ctx: Ctx, only?: number[]) {
  const p = ctx.get();
  if (!p.slides) return;
  const idx = only || p.slides!.map((_, i) => i);
  const htmls = await Promise.all(idx.map(i => drawSlide(p, i)));
  ctx.update(q => idx.forEach((i, k) => { if (q.slides![i] && !q.slides![i].custom && q.slides![i].data) q.slides![i].html = htmls[k]; }));
}

async function fillBatch(ctx: Ctx, idx: number[], instruction?: string) {
  const p = ctx.get();
  const dk = p.dk!;
  ctx.update(q => idx.forEach(i => { q.slides![i].status = 'working'; }));
  try {
    const res = await retry(() => post('deck/fill', {
      language: dk.language, audience: dk.audience, notes: dk.notes, imagery: dk.imagery, deckTitle: p.title,
      slides: idx.map(i => ({ number: i + 1, ...p.slides![i].plan })),
      ...(instruction ? { instruction, current: idx.map(i => ({ ...p.slides![i].data, notes: p.slides![i].notes })) } : {}),
      referencesText: refsText(p),
    }, ctx.signal));
    ctx.update(q => idx.forEach((i, k) => {
      const { notes, ...data } = res.slides[k];
      q.slides![i] = { ...q.slides![i], data: normalize(data), custom: false, notes: notes || q.slides![i].notes, status: 'done', error: undefined };
      q.slides![i].plan.layout = q.slides![i].data!.layout;
    }));
    await redraw(ctx, idx);
  } catch (e) {
    ctx.update(q => idx.forEach(i => { q.slides![i].status = q.slides![i].html ? 'done' : 'error'; q.slides![i].error = (e as Error).message; }));
    throw e;
  }
}

/** Premium only: a bespoke slide drawn by the designer model (Claude Sonnet). */
async function designBatch(ctx: Ctx, idx: number[], instruction?: string) {
  const p = ctx.get();
  const dk = p.dk!;
  ctx.update(q => idx.forEach(i => { q.slides![i].status = 'working'; }));
  try {
    const res = await retry(() => post('deck/design', {
      options: { topic: dk.topic, slides: dk.slides, language: dk.language, style: dk.style, imagery: dk.imagery, notes: dk.notes, audience: dk.audience },
      title: p.title, theme: themeOf(p), total: p.slides!.length, start: idx[0],
      slides: idx.map(i => ({ ...p.slides![i].plan, kind: p.slides![i].plan.layout, visual: 'a bespoke diagram that explains the key message', imageQuery: null })),
      ...(instruction ? { instruction, current: idx.map(i => p.slides![i].html) } : {}),
      referencesText: refsText(p),
    }, ctx.signal));
    const filled = await Promise.all(res.slides.map((s: any) => fillImages(s.html)));
    ctx.update(q => idx.forEach((i, k) => { q.slides![i] = { ...q.slides![i], html: filled[k], notes: res.slides[k].notes, custom: true, status: 'done', error: undefined }; }));
  } catch (e) {
    ctx.update(q => idx.forEach(i => { q.slides![i].status = q.slides![i].html ? 'done' : 'error'; q.slides![i].error = (e as Error).message; }));
    throw e;
  }
}

function chunks(list: number[], size: number) {
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function produce(ctx: Ctx, idx: number[], label: string) {
  const p = ctx.get();
  const custom = idx.filter(i => p.slides![i].plan.custom && p.dk!.premium);
  const normal = idx.filter(i => !custom.includes(i));
  const jobs: (() => Promise<void>)[] = [
    ...chunks(normal, 5).map(b => () => fillBatch(ctx, b)),
    ...custom.map(i => () => designBatch(ctx, [i]).catch(() => fillBatch(ctx, [i]))),
  ];
  let done = 0;
  ctx.progress(`${label} 0/${idx.length}`);
  return pool(jobs, 4, async job => { await job(); done = ctx.get().slides!.filter((s, i) => idx.includes(i) && s.status === 'done').length; ctx.progress(`${label} ${done}/${idx.length}`); });
}

export async function runDeck(ctx: Ctx) {
  const dk = ctx.get().dk!;
  let sources: Source[] = ctx.get().sources;
  if (dk.withSources) {
    ctx.progress('بدوّر على مراجع علمية حقيقية للعرض…');
    try {
      const r = await post('sources', { queries: [dk.topic.slice(0, 180)], mode: 'scientific', recentYears: 10, want: 12 }, ctx.signal);
      sources = r.sources;
      ctx.update(p => { p.sources = sources; });
      ctx.say(`لقيت **${sources.length} مرجع حقيقي** هبني عليهم الأرقام والمعلومات.`, 'progress');
    } catch { ctx.say('مقدرتش أوصل لقواعد البيانات دلوقتي، فهكمّل العرض من المحتوى اللي عندي من غير أرقام محتاجة مرجع.', 'error'); }
  }
  ctx.progress('بخطط قصة العرض واختار تصميم كل شريحة…');
  const plan = await retry(() => post('deck/plan', { topic: dk.topic, content: dk.content, slides: dk.slides, language: dk.language, style: dk.style, imagery: dk.imagery, notes: dk.notes, audience: dk.audience, premium: dk.premium, sources: sources.map(slim) }, ctx.signal));
  ctx.update(p => {
    p.title = plan.title; p.subtitle = plan.subtitle;
    p.theme = baseTheme(p); p.style = p.style || { ...DEFAULT_STYLE };
    p.slides = plan.slides.map((s: any) => ({ plan: s, html: '', notes: '', status: 'waiting' } as SlideState));
  });
  const custom = plan.slides.filter((s: any) => s.custom).length;
  ctx.say(`خطة العرض جاهزة: **${plan.slides.length} شريحة**${custom ? `، منهم ${custom} برسومات مخصصة (Premium)` : ''}. ببدأ أكتب وأصمم…`, 'progress');
  const errors = await produce(ctx, plan.slides.map((_: unknown, i: number) => i), 'بصمم الشرايح…');
  finishDeck(ctx, errors.length);
}

function finishDeck(ctx: Ctx, failed: number) {
  const p = ctx.get();
  const ok = p.slides!.filter(s => s.status === 'done').length;
  ctx.update(q => { q.status = failed ? 'error' : 'ready'; q.progress = ''; q.lastError = failed ? `${failed} شرايح وقفت بسبب ضغط أو خطأ مؤقت في خدمة الذكاء الاصطناعي` : ''; });
  if (failed) ctx.say(`اتصمم ${ok} من ${p.slides!.length} شريحة. الباقي وقف بسبب ضغط على الخدمة — اكتب "كمّل" وأنا أكمّله.`, 'error');
  else ctx.say(`العرض جاهز ✅ **${ok} شريحة**${p.dk!.notes ? ' مع ملاحظات المتحدث' : ''}.\n\n- **🎨 التنسيق**: غيّر الألوان والخط وحجم العناوين والغلاف فورًا ومجانًا.\n- دوس على أي شريحة وبعدين **✏️ تعديل النص** عشان تعدّل الكلام بإيدك.\n- أو اكتب طلبك هنا: "الشريحة 4 زحمة"، "ضيف شريحة عن الأعراض بعد 5".`, 'success', ['pptx', 'deck_pdf']);
}

export async function resumeDeck(ctx: Ctx) {
  const p = ctx.get();
  if (!p.slides?.length) return runDeck(ctx); // stopped before the plan existed
  const missing = p.slides!.map((s, i) => (s.status === 'done' ? -1 : i)).filter(i => i >= 0);
  ctx.update(q => { q.status = 'working'; });
  const errors = await produce(ctx, missing, 'بكمّل الشرايح…');
  finishDeck(ctx, errors.length);
}

/** Direct, free edits from the style panel or text editor (no AI). */
export async function applyStyle(ctx: Ctx, fn: (p: V6Project) => void, label = 'تنسيق') {
  snapshot(ctx, label);
  ctx.update(fn);
  await redraw(ctx);
}

/* ───────────────────────── Chat edits ───────────────────────── */

export function snapshot(ctx: Ctx, label: string) {
  ctx.update(p => {
    p.history = [...(p.history || []).slice(-14), { label, sections: p.sections ? structuredClone(p.sections) : undefined, slides: p.slides ? structuredClone(p.slides) : undefined, style: p.style ? { ...p.style } : undefined, coverInfo: p.coverInfo ? { ...p.coverInfo } : undefined, extra: structuredClone({ docFormat: p.docFormat, docStyle: p.docStyle, cover: p.cover, coverStyle: p.coverStyle, logo: p.logo, title: p.title, ro: p.ro }) }];
  });
}

export function undo(ctx: Ctx) {
  const p = ctx.get();
  const last = p.history?.at(-1);
  if (!last) return ctx.say('مفيش تعديل قبل كده أرجّعه.');
  ctx.update(q => { if (last.sections) q.sections = last.sections; if (last.slides) q.slides = last.slides; if (last.style) q.style = last.style; if (last.coverInfo) q.coverInfo = last.coverInfo; if (last.extra) Object.assign(q, last.extra); q.history = q.history!.slice(0, -1); });
  if (p.kind === 'deck') redraw(ctx);
  ctx.say(`رجّعت النسخة اللي قبل: ${last.label} ↩️`, 'success');
}

/** Free design layer: the AI writes scoped CSS for requests the ready-made options can't express. */
async function applyCss(ctx: Ctx, message: string) {
  const p = ctx.get();
  const deck = p.kind === 'deck';
  const current = deck ? p.style?.customCss || '' : p.docFormat?.css || '';
  const r = await post('style/css', { kind: deck ? 'deck' : 'doc', instruction: message, current }, ctx.signal);
  if (!r.css || r.css === current || !r.changes?.length) return { changes: [] as string[], unsupported: r.unsupported as string };
  await applyStyle(ctx, q => {
    if (deck) q.style = { ...DEFAULT_STYLE, ...(q.style || {}), customCss: r.css };
    else q.docFormat = { ...DEFAULT_FORMAT, ...(q.docFormat || {}), css: r.css };
  }, 'تصميم حر');
  return { changes: r.changes as string[], unsupported: r.unsupported as string };
}

/** Puts the student's own picture on the slide(s) they asked about. */
function placeImage(ctx: Ctx, idx: number[], image: string) {
  ctx.update(q => idx.forEach(i => {
    const s = q.slides![i];
    if (!s?.data || s.custom) return;
    const keep = ['image_points', 'image_full', 'cover'].includes(s.data.layout);
    s.data = { ...s.data, userImage: image, layout: keep ? s.data.layout : s.data.items.length >= 2 ? 'image_points' : 'image_full' };
    s.plan.layout = s.data.layout;
  }));
  void redraw(ctx, idx);
  ctx.say(`حطّيت صورتك في الشريحة ${idx.map(i => i + 1).join('، ')} 🖼️ (تقدر تشيلها من ✏️ تعديل النص)`, 'success');
}

/** Cover / title page edits from chat, applied for real and reported honestly. */
async function editCover(ctx: Ctx, message: string, instruction: string) {
  const p = ctx.get();
  const deck = p.kind === 'deck';
  ctx.progress('بعدّل الغلاف…');
  const ci = p.coverInfo || { presenter: '', institution: '', date: '' };
  const c0 = p.slides?.[0]?.data;
  const current = deck
    ? { title: c0?.title || p.title, subtitle: c0?.subtitle || '', student: ci.presenter, university: ci.institution, date: ci.date, nameSize: p.style?.coverNameScale || 1, titleSize: p.style?.coverTitleScale || 1 }
    : { title: p.title, ...p.cover, nameSize: p.coverStyle?.nameScale || 1, titleSize: p.coverStyle?.titleScale || 1 };
  const r = await post('cover/edit', { kind: p.kind, instruction: instruction || message, current }, ctx.signal);
  const NS: Record<string, number> = { normal: 1, large: 1.3, xlarge: 1.6 };
  const TS: Record<string, number> = { smaller: 0.85, normal: 1, large: 1.15, xlarge: 1.3 };
  const changes: string[] = [];
  const label: Record<string, string> = { title: 'العنوان', subtitle: 'العنوان الفرعي', student: deck ? 'اسم المقدّم' : 'اسم الطالب', university: deck ? 'الجامعة' : 'الجامعة', faculty: 'الكلية', course: 'المادة', professor: 'اسم الدكتور', date: 'التاريخ' };
  for (const k of Object.keys(label)) if (r[k] && r[k] !== (current as any)[k]) changes.push(`${label[k]}: ${r[k]}`);
  if (r.nameSize) changes.push(`حجم الأسماء: ${Math.round(NS[r.nameSize] * 100)}%`);
  if (r.titleSize) changes.push(`حجم العنوان: ${Math.round(TS[r.titleSize] * 100)}%`);
  ctx.progress('');
  if (!changes.length) return ctx.say(`مقدرتش أفهم التعديل المطلوب على الغلاف، فما غيّرتش حاجة.${r.unsupported ? `\n⚠️ مش مدعوم: ${r.unsupported}` : ''}\nاكتب مثلًا: "كبّر الأسماء في الغلاف" أو "غيّر اسم الدكتور لـ ...".`, 'error');
  await applyStyle(ctx, q => {
    if (deck) {
      q.coverInfo = { presenter: r.student || ci.presenter, institution: r.university || ci.institution, date: r.date || ci.date };
      q.style = { ...DEFAULT_STYLE, ...(q.style || {}), ...(r.nameSize ? { coverNameScale: NS[r.nameSize] } : {}), ...(r.titleSize ? { coverTitleScale: TS[r.titleSize] } : {}) };
      const s0 = q.slides?.[0];
      if (s0?.data) s0.data = { ...s0.data, ...(r.title ? { title: r.title } : {}), ...(r.subtitle ? { subtitle: r.subtitle } : {}) };
      if (r.title) q.title = r.title;
    } else {
      q.cover = { ...q.cover, ...Object.fromEntries(['student', 'university', 'faculty', 'course', 'professor', 'date'].filter(k => r[k]).map(k => [k, r[k]])) };
      if (r.title) q.title = r.title;
      q.coverStyle = { nameScale: r.nameSize ? NS[r.nameSize] : q.coverStyle?.nameScale || 1, titleScale: r.titleSize ? TS[r.titleSize] : q.coverStyle?.titleScale || 1 };
    }
  }, 'تعديل الغلاف');
  return ctx.say(`اتعدّل الغلاف فعلًا ✅\n${changes.map(c => '- ' + c).join('\n')}${r.unsupported ? `\n⚠️ مقدرش أعمل: ${r.unsupported}` : ''}\n${deck ? 'الشريحة الأولى اتحدّثت في المعاينة.' : 'الغلاف بيظهر في الملف، حمّله من هنا:'}`, 'success', deck ? undefined : ['premium_pdf', 'word']);
}

export async function handleMessage(ctx: Ctx, message: string, selected: number | null, attachments: { name: string; text: string; image?: string }[] = []) {
  const p = ctx.get();
  const deck = p.kind === 'deck';
  if (/^(كمل|كمّل|continue|resume|كمله|كملها)\s*$/i.test(message.trim())) return deck ? resumeDeck(ctx) : resumeResearch(ctx);
  if (/^(تراجع|ارجع|رجّع|رجع|رجعها|undo)(\s|$|[.!،])/i.test(message.trim())) return undo(ctx);

  const items = deck ? p.slides!.map(s => s.plan.title) : p.outline!.map(o => o.heading);
  ctx.progress('بفهم طلبك…');
  const history = p.messages.filter(m => m.tone !== 'progress').slice(-10).map(m => ({ role: m.role, content: m.content.slice(0, 1400) }));
  const total = deck ? p.slides!.length : p.outline!.length;
  const finished = deck ? p.slides!.filter(s => s.status === 'done').length : p.sections!.filter(Boolean).length;
  const state = { status: p.status, progress: p.progress.slice(0, 200), lastError: (p.lastError || '').slice(0, 400), done: finished, total };
  const image = attachments.find(a => a.image)?.image;
  const plan = await post('edit/understand', {
    message, kind: p.kind, items, history, selected: selected === null ? null : selected + 1, state,
    files: filesFor(p), attachments: attachments.map(a => ({ name: a.name, text: a.text.slice(0, 8000) })), ...(image ? { image } : {}),
  }, ctx.signal);
  if (plan.action === 'answer') { ctx.progress(''); return ctx.say(plan.reply); }
  if (plan.action === 'send_files') { ctx.progress(''); return ctx.say(plan.reply || 'الملفات جاهزة، دوس على الزرار اللي تحت:', 'success', plan.files?.length ? plan.files : filesFor(p)); }
  if (plan.action === 'cover') return editCover(ctx, message, plan.instruction);
  if (plan.action === 'pick_image') {
    ctx.progress('');
    const t = Math.max(0, Math.min(items.length - 1, (plan.targets[0] || (selected ?? 0) + 1) - 1));
    if (image) { placeImage(ctx, [t], image); return; }
    return ctx.say(`${plan.reply || 'اختار الصورة اللي تعجبك:'}\nدوس على الزرار، هتلاقي صور مرخّصة للموضوع، أو ارفع صورة من موبايلك.`, 'success', ['pick_image:' + t]);
  }
  if (plan.action !== 'restyle') ctx.say(plan.reply);
  const targets: number[] = plan.targets.filter((n: number) => n >= 1).map((n: number) => n - 1);

  if (plan.action === 'remove') {
    if (!targets.length) return ctx.say('مش واضح أشيل أنهي واحد. قولّي الرقم.');
    snapshot(ctx, 'حذف ' + targets.map(t => t + 1).join('، '));
    ctx.update(q => {
      const keep = (_: unknown, i: number) => !targets.includes(i);
      if (deck) q.slides = q.slides!.filter(keep);
      else { q.sections = q.sections!.filter(keep); q.outline = q.outline!.filter(keep); }
    });
    if (deck) await redraw(ctx);
    ctx.progress('');
    return ctx.say('اتشال ✅ (لو عاوز ترجّعه اكتب "تراجع").', 'success');
  }

  if (plan.action === 'add') {
    const after = Math.min(items.length, Math.max(0, plan.targets[0] ?? items.length));
    snapshot(ctx, 'إضافة');
    if (deck) {
      ctx.update(q => q.slides!.splice(after, 0, { plan: { title: plan.instruction.slice(0, 60), layout: 'cards', keyMessage: plan.instruction, content: plan.instruction, custom: false }, html: '', notes: '', status: 'waiting' }));
      ctx.progress('بصمم الشريحة الجديدة…');
      await fillBatch(ctx, [after], 'Create this new slide. Choose the best layout for it: ' + plan.instruction);
      if (image) placeImage(ctx, [after], image);
      await redraw(ctx);
    } else {
      const words = Math.round((ctx.get().outline!.reduce((n, o) => n + o.words, 0) / ctx.get().outline!.length));
      ctx.update(q => { q.outline!.splice(after, 0, { heading: plan.instruction.slice(0, 80), focus: plan.instruction, words }); q.sections!.splice(after, 0, null); });
      ctx.progress('بكتب الجزء الجديد…');
      await writeSection(ctx, after, distribute(ctx.get().sources, 1, 8)[0]);
    }
    ctx.progress('');
    return ctx.say(`اتضاف ✅ في مكان رقم ${after + 1}.`, 'success');
  }

  if (plan.action === 'more_sources') {
    if (deck || p.ro!.sourceMode === 'none') { ctx.progress(''); return ctx.say('المسار ده معمول من غير مراجع. ابدأ بحث جديد واختار "مصادر علمية" لو عاوز مراجع.'); }
    ctx.progress('بدوّر على مراجع إضافية…');
    const r = await post('sources', { queries: p.queries!.slice(0, 5), mode: p.ro!.sourceMode, recentYears: p.ro!.recentYears, want: Math.min(40, p.sources.length + 12) }, ctx.signal);
    snapshot(ctx, 'مراجع إضافية');
    ctx.update(q => { q.sources = r.sources; });
    const per = distribute(r.sources, p.outline!.length, 10);
    let done = 0;
    await pool(p.outline!.map((_, i) => i), 4, async i => { await writeSection(ctx, i, per[i], plan.instruction || 'Integrate the additional sources and cite more of them.'); ctx.progress(`بدمج المراجع الجديدة… ${++done}/${p.outline!.length}`); });
    return finishResearch(ctx, 0);
  }

  if (deck && plan.action === 'restyle') {
    ctx.progress('بغيّر التنسيق…');
    const st = await post('deck/style', { instruction: message, current: { ...(p.style || DEFAULT_STYLE) } }, ctx.signal);
    const pair = FONT_PAIRS.find(f => f.id === st.fonts);
    const before = { ...DEFAULT_STYLE, ...(p.style || {}) };
    const after = { ...before, ...(st.palette ? { palette: st.palette } : {}), ...(pair ? { headingFont: pair.heading, bodyFont: pair.body } : {}), titleScale: st.titleScale, bodyScale: st.bodyScale, showNumbers: st.showNumbers };
    const changes: string[] = [];
    if (after.palette !== before.palette) changes.push('الألوان: ' + (PALETTES.find(x => x.id === after.palette)?.name || 'الأصلية'));
    if (after.headingFont !== before.headingFont) changes.push('الخط: ' + after.headingFont);
    if (Math.abs(after.titleScale - before.titleScale) > 0.01) changes.push(`حجم العناوين ${Math.round(before.titleScale * 100)}% ← ${Math.round(after.titleScale * 100)}%`);
    if (Math.abs(after.bodyScale - before.bodyScale) > 0.01) changes.push(`حجم النص ${Math.round(before.bodyScale * 100)}% ← ${Math.round(after.bodyScale * 100)}%`);
    if (after.showNumbers !== before.showNumbers) changes.push(after.showNumbers ? 'أرقام الشرايح ظاهرة' : 'أرقام الشرايح مخفية');
    ctx.progress('');
    if (!changes.length) {
      ctx.progress('بصمم التعديل…');
      const free = await applyCss(ctx, message);
      ctx.progress('');
      if (!free.changes.length) return ctx.say(`مقدرتش أنفّذ الطلب ده، فما غيّرتش حاجة.${free.unsupported ? `\n⚠️ ${free.unsupported}` : ''}`, 'error');
      return ctx.say(`اتغيّر فعلًا ✅\n${free.changes.map(c => '- ' + c).join('\n')}${free.unsupported ? `\n⚠️ مقدرش أعمل: ${free.unsupported}` : ''}\nشوف الشرايح، ولو مش عاجبك اكتب "تراجع".`, 'success');
    }
    await applyStyle(ctx, q => { q.style = after; }, 'تنسيق');
    const customN = ctx.get().slides!.filter(s => s.custom).length;
    return ctx.say(`اتغيّر فعلًا ✅\n${changes.map(c => '- ' + c).join('\n')}${customN ? `\n(الشرايح المصممة خصيصًا (${customN}) بتاخد الألوان والخط الجديد، بس حجم الخط فيها يتغيّر لما تطلب تعديلها هي.)` : ''}`, 'success');
  }

  // revise
  const all = items.map((_, i) => i);
  const list = plan.action === 'restyle' || !targets.length ? (selected !== null && plan.action !== 'restyle' ? [selected] : all) : targets;
  if (!deck && plan.action === 'restyle') {
    ctx.progress('بظبط التنسيق…');
    const cur = { ...DEFAULT_FORMAT, ...(p.docFormat || {}), citationStyle: p.ro!.citationStyle, ...(p.docStyle || DEFAULT_DOC_STYLE) };
    const f = await post('doc/format', { instruction: message, current: cur }, ctx.signal);
    const d0 = { ...DEFAULT_FORMAT, ...(p.docFormat || {}) };
    const d = { ...d0 };
    if (f.numbering) d.numbering = f.numbering;
    if (f.lineSpacing) d.lineSpacing = f.lineSpacing;
    if (f.margins) d.margins = f.margins;
    if (f.pageNumber) d.pageNumber = f.pageNumber;
    if (f.toc) d.toc = f.toc === 'on';
    if (f.abstract) d.abstract = f.abstract === 'on';
    if (f.header) d.header = f.header;
    const st0 = { ...DEFAULT_DOC_STYLE, ...(p.docStyle || {}) };
    const st = { ...st0, ...(f.size ? { size: f.size } : {}), ...(f.theme ? { theme: f.theme } : {}) };
    const L: Record<string, string> = { padded: '01', decimal: '1', roman: 'I', letters: 'أ / A', none: 'من غير ترقيم', auto: 'تلقائي', '1.15': 'مفرد', '1.5': '1.5', '2': 'دبل', narrow: 'ضيقة', normal: 'عادية', wide: 'واسعة', end: 'في الطرف', center: 'في النص', start: 'الطرف التاني', compact: 'صغير', large: 'كبير', modern: 'طبي عصري', academic: 'أكاديمي', clinical: 'هادي', elegant: 'فخم' };
    const changes: string[] = [];
    if (d.numbering !== d0.numbering) changes.push('ترقيم العناوين: ' + L[d.numbering]);
    if (d.lineSpacing !== d0.lineSpacing) changes.push('المسافة بين السطور: ' + L[d.lineSpacing]);
    if (d.margins !== d0.margins) changes.push('الهوامش: ' + L[d.margins]);
    if (d.pageNumber !== d0.pageNumber) changes.push(d.pageNumber === 'none' ? 'رقم الصفحة: مخفي' : 'رقم الصفحة: ' + L[d.pageNumber]);
    if (d.toc !== d0.toc) changes.push(d.toc ? 'صفحة الفهرس: ظاهرة' : 'صفحة الفهرس: اتشالت');
    if (d.abstract !== d0.abstract) changes.push(d.abstract ? 'الـ Abstract: ظاهر' : 'الـ Abstract: اتشال');
    if (d.header !== d0.header) changes.push('الهيدر: ' + d.header);
    if (f.citationStyle && f.citationStyle !== p.ro!.citationStyle) changes.push('نظام المراجع: ' + f.citationStyle);
    if (st.size !== st0.size) changes.push('حجم الخط: ' + L[st.size]);
    if (st.theme !== st0.theme) changes.push('ستايل الـ PDF: ' + L[st.theme]);
    let free = { changes: [] as string[], unsupported: f.unsupported as string };
    if (!changes.length || f.unsupported) { ctx.progress('بصمم التعديل…'); free = await applyCss(ctx, message); }
    ctx.progress('');
    if (!changes.length && !free.changes.length) return ctx.say(`مقدرتش أنفّذ الطلب ده، فما غيّرتش أي حاجة.${free.unsupported ? `\n⚠️ مش مدعوم: ${free.unsupported}` : ''}\nجرّب تقولها بشكل تاني، أو افتح 🎨 شكل الـ PDF واختار بنفسك.`, 'error');
    if (!changes.length) return ctx.say(`اتغيّر فعلًا ✅\n${free.changes.map(c => '- ' + c).join('\n')}${free.unsupported ? `\n⚠️ مقدرش أعمل: ${free.unsupported}` : ''}\nالتغيير بيظهر في **PDF Premium**:`, 'success', ['premium_pdf']);
    f.unsupported = free.changes.length ? free.unsupported : f.unsupported;
    changes.push(...free.changes);
    snapshot(ctx, 'تنسيق البحث');
    ctx.update(q => { q.docFormat = { ...d, css: q.docFormat?.css ?? d.css }; q.docStyle = st; if (f.citationStyle) q.ro = { ...q.ro!, citationStyle: f.citationStyle }; });
    const fixed = d.lineSpacing !== 'auto' && d.lineSpacing !== d0.lineSpacing;
    return ctx.say(`اتغيّر فعلًا ✅\n${changes.map(c => '- ' + c).join('\n')}${fixed ? '\n(مع المسافة الثابتة عدد الصفحات ممكن يختلف عن اللي طلبته.)' : ''}${f.unsupported ? `\n⚠️ مقدرش أعمل: ${f.unsupported}` : ''}\nحمّل الملف من الزرار ده عشان تشوف التغيير:`, 'success', ['premium_pdf']);
  }
  snapshot(ctx, 'تعديل ' + list.map(i => i + 1).join('، '));
  let done = 0;
  ctx.progress(`بعدّل… 0/${list.length}`);
  const errors = deck
    ? await pool([...chunks(list.filter(i => !ctx.get().slides![i].custom), 4).map(b => () => fillBatch(ctx, b, plan.instruction)), ...list.filter(i => ctx.get().slides![i].custom).map(i => () => designBatch(ctx, [i], plan.instruction))], 4, async job => { await job(); ctx.progress(`بعدّل… ${(done = Math.min(list.length, done + 1))}/${list.length}`); })
    : await pool(list, 4, async i => { await writeSection(ctx, i, distribute(ctx.get().sources, ctx.get().outline!.length)[i], plan.instruction); ctx.progress(`بعدّل… ${++done}/${list.length}`); });
  if (deck && image && !errors.length) placeImage(ctx, [list[0]], image);
  ctx.progress('');
  if (errors.length) ctx.say(`اتعدّل ${list.length - errors.length} من ${list.length}. الباقي وقف: ${(errors[0] as Error).message}`, 'error');
  else ctx.say(`اتعدّل ✅ ${deck ? 'شريحة' : 'جزء'} ${list.map(i => i + 1).join('، ')}. (اكتب "تراجع" لو عاوز النسخة القديمة)`, 'success');
}

export { ar as isArabic };
