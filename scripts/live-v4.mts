/** Live check of v4 features with minimal spend: full text, diagrams, lab report, viva. */
import { app } from '../server/app.ts';
import { fullTextExcerpts } from '../server/fulltext.ts';
import { project } from '../shared/model.ts';

const env: Record<string, string> = {
  ALLOW_LOCAL_MODE: 'true', OPENROUTER_ENABLED: 'true', OWNER_PAID_ENABLED: 'true', PAID_LEDGER_OPTIONAL: 'true',
  PAID_MAX_OPERATION_USD: '0.25', OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '', REQUESTS_PER_HOUR: '500',
};
const log = (s: string, ok: boolean, d: any) => console.log((ok ? 'PASS ' : 'FAIL ') + s + ' — ' + JSON.stringify(d).slice(0, 700));
const call = async (path: string, body: any) => {
  const t = Date.now();
  const r = await app.fetch(new Request('http://local/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://local' }, body: JSON.stringify(body) }), env as any);
  return { ok: r.ok, j: await r.json() as any, ms: Date.now() - t };
};
const words = (d: any) => JSON.stringify(d.sections.map((s: any) => s.paragraphs.map((p: any) => p.text))).split(/\s+/).length;
const shape = (d: any) => d.sections.map((s: any) => `${s.heading}${s.tables.length ? ' [table]' : ''}${s.diagram ? ` [${s.diagram.kind}: ${s.diagram.nodes.join(' → ')}]` : ''}`);
let cost = 0; const track = (u: any) => { cost += Number(u?.cost || 0); };

// 1) Open-access full text
const src = await call('sources', { query: 'shoulder instability rehabilitation exercise', database: 'pubmed', filter: 'mixed', page: 1, pageSize: 20 });
const ids: string[] = (src.j.recommendedIds || []).slice(0, 10);
const pmids = (src.j.sources || []).filter((s: any) => ids.includes(s.id)).map((s: any) => s.pmid);
const ft = await fullTextExcerpts(pmids);
log('europe pmc full text', Object.keys(ft).length > 0, { selected: pmids.length, withFullText: Object.keys(ft).length, chars: Object.values(ft).map(x => x.length), sample: Object.values(ft)[0]?.slice(0, 220) });

const body = (p: any, operation: string, extra: any = {}) => ({ operation, tool: p.tool, uiLanguage: 'ar', instructions: p.instructions, support: '', brief: p.brief, settings: p.settings, mirror: null, revision: 0, sourceIds: p.selected, section: null, slide: null, researchDoc: p.doc, action: '', searches: p.searches, ...extra });

// 2) Research with full text + diagrams (kept short to save credit)
const r = project('research'); r.settings.allowPaid = true;
r.instructions = 'Research paper on shoulder instability rehabilitation for physical therapy students. About 1200 words. English.';
let u = await call('ai', body(r, 'understand')); r.brief = u.j.data; r.confirmed = true; track(u.j.usage);
r.sources = src.j.sources; r.selected = ids; r.searches = [src.j.search];
const d = await call('ai', body(r, 'document'));
if (d.ok) { track(d.j.usage); r.doc = d.j.data; }
log('research document', d.ok && !!d.j.data?.sections?.length, d.ok ? { words: words(d.j.data), diagrams: d.j.data.sections.filter((s: any) => s.diagram).length, outline: shape(d.j.data), limitations: d.j.data.limitations.slice(0, 2), ms: d.ms } : d.j);
if (d.ok) console.log('EXCERPT: ' + d.j.data.sections.map((s: any) => s.paragraphs.map((p: any) => p.text).join(' ')).join(' ').slice(800, 1900));

// 3) Lab report from the student's own data
const l = project('assignment'); l.settings.allowPaid = true;
l.instructions = 'Lab report: measuring hand grip strength with a Jamar hand dynamometer in 10 physical therapy students (seated, elbow 90°, 3 trials, best taken). My results: right hand mean 34.2 kg (SD 6.1), left hand mean 31.5 kg (SD 5.8). About 700 words. English.';
u = await call('ai', body(l, 'understand')); track(u.j.usage); l.brief = u.j.data; l.confirmed = true;
log('lab report understood', u.ok && u.j.data.taskType === 'lab-report', { taskType: u.j.data?.taskType, sections: u.j.data?.requiredSections });
const lr = await call('ai', body(l, 'document'));
if (lr.ok) track(lr.j.usage);
const lrText = lr.ok ? JSON.stringify(lr.j.data) : '';
log('lab report document', lr.ok && /34\.2/.test(lrText) && /31\.5/.test(lrText), lr.ok ? { words: words(lr.j.data), outline: shape(lr.j.data), usesStudentData: /34\.2/.test(lrText), inventedExtraNumbers: (lrText.match(/\d+\.\d+ ?kg/g) || []).filter(x => !/34\.2|31\.5|6\.1|5\.8/.test(x)).slice(0, 5), ms: lr.ms } : lr.j);

// 4) Viva rehearsal on the research
const msgs: any[] = [];
const vt = async (said: string | null, finish = false, asked = 0) => {
  if (said) msgs.push({ role: 'user', content: said });
  const v = await call('ai', { ...body(r, 'viva'), messages: msgs, viva: { asked, finish } });
  if (v.ok) { track(v.j.usage); msgs.push({ role: 'assistant', content: v.j.data.reply }); }
  return v;
};
const v1 = await vt('اعملي بروفة مناقشة');
log('viva question 1', v1.ok && v1.j.data.score === null && !v1.j.data.done, v1.ok ? { reply: v1.j.data.reply, model: v1.j.model, ms: v1.ms } : v1.j);
const v2 = await vt('الـ rotator cuff بيعمل compression للـ humeral head جوه الـ glenoid فبيزود الثبات', false, 1);
log('viva answer scored', v2.ok && typeof v2.j.data.score === 'number', v2.ok ? { score: v2.j.data.score, reply: v2.j.data.reply, ms: v2.ms } : v2.j);
const v3 = await vt('خلاص', true, 2);
log('viva final report', v3.ok && v3.j.data.done, v3.ok ? { reply: v3.j.data.reply, ms: v3.ms } : v3.j);
console.log('TOTAL_COST_USD ' + cost.toFixed(4));
