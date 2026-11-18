/**
 * Live end-to-end check against the real internet: Wikimedia images, PubMed, OpenRouter.
 * Usage: OPENROUTER_API_KEY=... npx tsx scripts/live-e2e.mts [slides]
 * Without a key it still checks images, PubMed and OpenRouter provider metadata.
 * Writes live-output/*.pptx, *.docx and a JSON report. Never prints the key.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { app } from '../server/app.ts';
import { Provider } from '../server/ai.ts';
import { project, normalizeDeck } from '../shared/model.ts';
import { buildDeck } from '../src/deckDesign.ts';

const key = process.env.OPENROUTER_API_KEY || '';
const slidesWanted = Number(process.argv[2] || 15);
const env: Record<string, string> = {
  ALLOW_LOCAL_MODE: 'true', OPENROUTER_ENABLED: 'true', OWNER_PAID_ENABLED: 'true', PAID_LEDGER_OPTIONAL: 'true',
  PAID_MAX_OPERATION_USD: '0.25', OPENROUTER_API_KEY: key, REQUESTS_PER_HOUR: '500',
  ...(process.env.OPENROUTER_MODEL ? { OPENROUTER_MODEL: process.env.OPENROUTER_MODEL } : {}),
  ...(process.env.OPENROUTER_FAST_MODEL ? { OPENROUTER_FAST_MODEL: process.env.OPENROUTER_FAST_MODEL } : {}),
};
mkdirSync('live-output', { recursive: true });
const report: any = { startedAt: new Date().toISOString(), steps: [] };
const log = (step: string, ok: boolean, detail: any) => { report.steps.push({ step, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + step + ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400))); };
const call = async (path: string, body: any) => {
  const t = Date.now();
  const r = await app.fetch(new Request('http://local/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://local' }, body: JSON.stringify(body) }), env as any);
  const j: any = await r.json();
  return { ok: r.ok, status: r.status, j, ms: Date.now() - t };
};

// 1) OpenRouter metadata (public)
for (const m of [process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash', process.env.OPENROUTER_FAST_MODEL || 'google/gemini-3.6-flash']) {
  try { const c = await new Provider('openrouter', { ...env, OPENROUTER_API_KEY: 'x' } as any, fetch, m).getCapabilities(); log('openrouter metadata ' + m, true, c); }
  catch (e) { log('openrouter metadata ' + m, false, (e as Error).message); }
}
// 2) Images
for (const q of ['rotator cuff muscles anatomy diagram', 'knee joint ligaments illustration', 'lumbar intervertebral disc herniation']) {
  const r = await call('images', { query: q });
  log('image: ' + q, !!r.j.image, r.j.image ? { attribution: r.j.image.attribution, kb: Math.round(r.j.image.data.length * 0.75 / 1024), ms: r.ms } : r.j);
}
// 3) PubMed
const src = await call('sources', { query: 'shoulder instability rehabilitation', database: 'pubmed', filter: 'mixed', page: 1, pageSize: 20 });
log('pubmed search', src.ok && src.j.sources?.length > 0, { found: src.j.sources?.length, recommended: src.j.recommendedIds?.length, via: src.j.via, ms: src.ms });

// 3b) Mirror: read a real slide-like image with the vision model
if (key) {
  try {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [k, v] of Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: 'lecture slide presentation filemime:image/jpeg', gsrnamespace: '6', gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '1000' })) u.searchParams.set(k, v);
    const j: any = await (await fetch(u, { headers: { 'User-Agent': 'MIAHomeworkStudio/2.0' } })).json();
    const pg: any = Object.values(j.query?.pages || {}).find((x: any) => /\.jpe?g$/i.test(x.imageinfo?.[0]?.thumburl || ''));
    if (pg) {
      const buf = Buffer.from(await (await fetch(pg.imageinfo[0].thumburl, { headers: { 'User-Agent': 'MIAHomeworkStudio/2.0' } })).arrayBuffer());
      const r = await call('vision', { image: 'data:image/jpeg;base64,' + buf.toString('base64'), name: 'sample.jpg' });
      log('mirror vision (' + pg.title + ')', r.ok, r.ok ? { model: r.j.model, kind: r.j.data.kind, palette: r.j.data.palette, structure: r.j.data.structure.slice(0, 6), style: r.j.data.styleNotes.slice(0, 200), ms: r.ms } : r.j);
    } else log('mirror vision', false, 'no sample image found');
  } catch (e) { log('mirror vision', false, (e as Error).message); }
}

if (!key) { writeFileSync('live-output/report.json', JSON.stringify(report, null, 2)); console.log('No OPENROUTER_API_KEY: AI steps skipped.'); process.exit(0); }

// 4) Full AI flow
const p = project('present');
p.settings.allowPaid = true; p.settings.count = slidesWanted;
const body = (operation: string, extra: any = {}) => ({ operation, tool: 'research', uiLanguage: 'ar', instructions: p.instructions, support: '', brief: p.brief, settings: p.settings, mirror: p.mirror, revision: 0, sourceIds: p.selected, section: null, slide: null, researchDoc: p.doc, action: '', searches: p.searches, ...extra });
const usage: any[] = [];
const msgs: any[] = [];
for (const said of ['الدكتور طلب مني بحث وبرزنتيشن عن shoulder instability', `اسمي أحمد محمد، جامعة القاهرة، كلية العلاج الطبيعي، مادة Orthopedic PT، الدكتورة سارة علي. والبرزنتيشن ${slidesWanted} سلايد`]) {
  msgs.push({ role: 'user', content: said });
  const r = await call('ai', { ...body('chat'), messages: msgs });
  if (!r.ok) { log('chat', false, r.j); break; }
  usage.push(r.j.usage);
  msgs.push({ role: 'assistant', content: r.j.data.reply });
  log('chat turn (' + r.j.model + ')', true, { reply: r.j.data.reply, question: r.j.data.question, ready: r.j.data.ready, student: r.j.data.student, ms: r.ms });
  if (r.j.data.ready) { p.instructions = r.j.data.instructions; if (r.j.data.student) Object.assign(p.cover, { enabled: true, student: r.j.data.student.name || '', university: r.j.data.student.university || '', faculty: r.j.data.student.faculty || '', course: r.j.data.student.course || '', professor: r.j.data.student.professor || '' }); }
}
if (!p.instructions) p.instructions = `Research + ${slidesWanted}-slide presentation on shoulder instability for physical therapy students. English.`;
const u = await call('ai', body('understand'));
log('understand brief', u.ok, u.ok ? { title: u.j.data.title, sections: u.j.data.requiredSections, ms: u.ms, model: u.j.model } : u.j);
if (!u.ok) process.exit(1);
p.brief = u.j.data; p.confirmed = true;
p.sources = src.j.sources || []; p.selected = (src.j.recommendedIds || []).slice(0, 10); p.searches = [src.j.search];

const doc = await call('ai', body('document', { tool: 'research' }));
log('research draft', doc.ok, doc.ok ? { sections: doc.j.data.sections.length, words: JSON.stringify(doc.j.data.sections).split(/\s+/).length, ms: doc.ms, model: doc.j.model } : doc.j);
if (doc.ok) {
  p.doc = doc.j.data;
  const { word } = await import('../src/export.ts');
  writeFileSync('live-output/research.docx', Buffer.from(await (await word(p)).arrayBuffer()));
}

const o = await call('ai', body('outline'));
log('deck outline', o.ok, o.ok ? { slides: o.j.data.slides.length, layouts: o.j.data.slides.map((s: any) => s.layout).join(','), ms: o.ms } : o.j);
if (!o.ok) process.exit(1);
const plan = o.j.data.slides.slice(0, slidesWanted);
const slides: any[] = [];
for (let i = 0; i < plan.length; i += 8) {
  const part = plan.slice(i, i + 8);
  const r = await call('ai', { ...body('deck', { settings: { ...p.settings, count: Math.max(2, part.length) } }), outline: part, deckTitle: o.j.data.title });
  log(`deck batch ${i / 8 + 1}`, r.ok && r.j.data.slides.length === part.length, r.ok ? { got: r.j.data.slides.length, want: part.length, ms: r.ms, model: r.j.model } : r.j);
  if (!r.ok) process.exit(1);
  slides.push(...r.j.data.slides);
}
p.deck = normalizeDeck({ title: o.j.data.title, language: 'English', slides: slides.map(s => ({ ...s, id: crypto.randomUUID() })), terms: [], questions: [], script: '', limitations: [] });
p.slideImages = {};
const usedTitles: string[] = [];
for (const s of p.deck.slides.filter(s => s.imageQuery && ['cover', 'split', 'image', 'section'].includes(s.layout))) {
  const r = await call('images', { query: s.imageQuery, exclude: usedTitles });
  if (r.j.image) { p.slideImages[s.id] = r.j.image; usedTitles.push(r.j.image.title); }
}
log('slide images', Object.keys(p.slideImages).length > 0, { withImage: Object.keys(p.slideImages).length, queries: p.deck.slides.filter(s => s.imageQuery).map(s => s.imageQuery) });
const blob = await buildDeck(p);
writeFileSync('live-output/presentation.pptx', Buffer.from(await blob.arrayBuffer()));
log('pptx export', true, { slides: p.deck.slides.length, kb: Math.round(blob.size / 1024) });
for (const [i, s] of p.deck.slides.entries()) console.log(`  #${i + 1} [${s.layout}] ${s.title}${s.subtitle ? ' — ' + s.subtitle : ''}\n      ${[...s.points, ...s.stats.map(x => x.value + ' ' + x.label), ...(s.table ? [s.table.headers.join(' | ')] : []), ...(s.chart ? ['CHART ' + s.chart.labels.join(',') + '=' + s.chart.values.join(',')] : [])].join(' • ').slice(0, 330)}${p.slideImages[s.id] ? '\n      IMG: ' + p.slideImages[s.id].attribution : ''} | refs:${s.sourceIds.length}`);
const docText = (p.doc?.sections || []).map(x => '## ' + x.heading + '\n' + x.paragraphs.map(y => y.text).join('\n')).join('\n');
console.log('RESEARCH EXCERPT:\n' + docText.slice(0, 2500));
const cost = report.steps.length; void cost;
report.deck = p.deck; report.cover = p.cover;
writeFileSync('live-output/report.json', JSON.stringify(report, null, 2));
console.log('DONE');
