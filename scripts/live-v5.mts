/** Live check of v5 with minimal spend: model fallback chain, OpenAlex, curated images, research without references. */
import { app } from '../server/app.ts';
import { route } from '../server/ai.ts';
import { findSlideImage } from '../server/images.ts';
import { search } from '../server/research.ts';
import { project } from '../shared/model.ts';
import { z } from 'zod';

const base: Record<string, string> = {
  ALLOW_LOCAL_MODE: 'true', OPENROUTER_ENABLED: 'true', OWNER_PAID_ENABLED: 'true', PAID_LEDGER_OPTIONAL: 'true',
  PAID_MAX_OPERATION_USD: '0.25', OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '', REQUESTS_PER_HOUR: '500',
};
const log = (s: string, ok: boolean, d: any) => console.log((ok ? 'PASS ' : 'FAIL ') + s + ' — ' + JSON.stringify(d).slice(0, 600));
let cost = 0; const track = (u: any) => { cost += Number(u?.cost || 0); };
const tiny = z.object({ answer: z.string() }).strict();

// 1) Fallback chain: first model deliberately broken → the next one must answer.
for (const [name, env] of [
  ['writer down → fast model', { ...base, OPENROUTER_MODEL: 'deepseek/does-not-exist-v0' }],
  ['writer + fast down → Qwen', { ...base, OPENROUTER_MODEL: 'deepseek/does-not-exist-v0', OPENROUTER_FAST_MODEL: 'google/does-not-exist-v0' }],
] as const) {
  try {
    const r: any = await route(env as any, tiny, 'Reply as JSON {"answer": string}.', 'Name the muscle that abducts the shoulder first 15 degrees. One word.', 300, true, 'owner', undefined, fetch, true);
    track(r.usage); log(name, !!r.data?.answer, { model: r.model, answer: r.data.answer });
  } catch (e: any) { log(name, false, { code: e.code, msg: e.message }); }
}

// 2) Research search (PubMed + Europe PMC + OpenAlex when thin)
try {
  const s = await search('scapular dyskinesis exercise', 'pubmed', 'mixed', undefined, 1, 10);
  log('research search', s.sources.length > 0, { via: s.via, found: s.sources.length, recommended: s.recommendedIds.length });
} catch (e: any) { log('research search', false, String(e.message)); }

// 3) Curated medical images
const used: string[] = [];
for (const q of ['rotator cuff muscles', 'knee anterior cruciate ligament', 'brachial plexus', 'lumbar vertebra']) {
  try {
    const img = await findSlideImage(q, fetch, used);
    if (img) used.push(img.title);
    log('image: ' + q, !!img, img ? { title: img.title, license: img.license } : null);
  } catch (e: any) { log('image: ' + q, false, String(e.message)); }
}

// 4) Research WITHOUT references (short, cheap)
const call = async (body: any) => {
  const r = await app.fetch(new Request('http://local/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://local' }, body: JSON.stringify(body) }), base as any);
  return { ok: r.ok, j: await r.json() as any };
};
const p: any = project('assignment'); p.settings.allowPaid = true;
p.instructions = 'Short essay about the menisci of the knee (anatomy and function) for physical therapy students. No references needed. About 400 words. English.';
const body = (op: string) => ({ operation: op, tool: 'assignment', uiLanguage: 'ar', instructions: p.instructions, support: '', brief: p.brief, settings: p.settings, revision: 0, sourceIds: [], section: null, slide: null, researchDoc: null, action: '', searches: [] });
const u = await call(body('understand')); if (u.ok) { track(u.j.usage); p.brief = u.j.data; }
log('no-refs understood', u.ok, u.ok ? { taskType: u.j.data.taskType, referencesRequired: u.j.data.referencesRequired } : u.j);
if (u.ok) {
  const d = await call(body('document'));
  if (d.ok) track(d.j.usage);
  const txt = d.ok ? JSON.stringify(d.j.data) : '';
  const citeLike = (txt.match(/\(\s*[A-Z][a-z]+(?: et al\.)?,? \d{4}\s*\)|\[\d+\]/g) || []).slice(0, 5);
  log('no-refs document', d.ok && !citeLike.length, d.ok ? { words: txt.split(/\s+/).length, model: d.j.model, firstLimitation: d.j.data.limitations[0], fakeCitations: citeLike } : d.j);
}
console.log('TOTAL_COST_USD ' + cost.toFixed(4));
