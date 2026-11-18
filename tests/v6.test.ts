import { expect, it, vi } from 'vitest';
import { app } from '../server/app';
import { planBudget, sanitizeSlideHtml } from '../server/v6';
import { distribute } from '../src/v6/engine';
import { mockSources } from '../server/mock';

const env = { ALLOW_LOCAL_MODE: 'true', MIA_MOCK_AI: 'true' } as any;
const call = (path: string, body: any) => app.fetch(new Request('http://x/api/v6/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
const ro = { path: 'research', topic: 'rotator cuff', sourceMode: 'scientific', pages: 10, language: 'English', level: 'UG', citationStyle: 'APA', minRefs: 10, recentYears: 10, extras: ['tables'], instructions: '' };

it('sizes the body so the PDF reaches the requested page count', () => {
  expect(planBudget({ pages: 10, sourceMode: "scientific", minRefs: 10 })).toBe(7 * 345);
  expect(planBudget({ pages: 12, sourceMode: "scientific", minRefs: 20 })).toBe(8 * 345);
  expect(planBudget({ pages: 5, sourceMode: 'none', minRefs: 0 })).toBe(3 * 345);
});

it('forces section word targets to add up to the page budget', async () => {
  const r = await call('research/plan', ro);
  const j: any = await r.json();
  expect(r.status).toBe(200);
  const sum = j.sections.reduce((n: number, s: any) => n + s.words, 0);
  expect(Math.abs(sum - planBudget(ro as any))).toBeLessThan(j.sections.length * 2);
});

it('drops citations that do not name a supplied real source', async () => {
  const mock = await import('../server/mock');
  const spy = vi.spyOn(mock, 'mockAI').mockReturnValueOnce({ id: 'x', heading: 'Intro', paragraphs: [{ text: 'a', sourceIds: ['pmid:40000000', 'pmid:99999999'] }], tables: [], diagram: null });
  const src = mockSources(2);
  const r = await call('research/section', { options: ro, title: 't', outline: ['Intro'], section: { heading: 'Intro', focus: 'f', words: 200 }, index: 0, sourceIds: src.map(s => s.id), sources: src });
  const j: any = await r.json();
  expect(j.section.paragraphs[0].sourceIds).toEqual(['pmid:40000000']);
  expect(j.section.id).toBe('s1');
  spy.mockRestore();
});

it('understands an edit request and keeps targets inside the document', async () => {
  const r = await call('edit/understand', { message: 'الجزء 3 ناشف زوّد أمثلة', kind: 'research', items: ['A', 'B', 'C'], history: [], selected: null });
  const j: any = await r.json();
  expect(j.action).toBe('revise');
  expect(j.targets).toEqual([3]);
});

it('plans layouts and fills structured slide content with the cheap writer', async () => {
  const plan: any = await (await call('deck/plan', { topic: 'ACL', content: '', slides: 8, language: 'English', style: 'modern', imagery: 'mixed', notes: true, audience: 'students', premium: false, sources: [] })).json();
  expect(plan.slides).toHaveLength(8);
  expect(plan.slides[0].layout).toBe('cover');
  expect(plan.slides.every((s: any) => s.custom === false)).toBe(true);
  const r: any = await (await call('deck/fill', { language: 'English', audience: 's', notes: true, imagery: 'mixed', deckTitle: plan.title, slides: plan.slides.slice(0, 3) })).json();
  expect(r.slides).toHaveLength(3);
  expect(r.slides[1].items.length).toBeGreaterThan(1);
});

it('premium marks only some slides for bespoke design and keeps them safe', async () => {
  const plan: any = await (await call('deck/plan', { topic: 'ACL', content: '', slides: 8, language: 'English', style: 'modern', imagery: 'mixed', notes: true, audience: 'students', premium: true, sources: [] })).json();
  expect(plan.slides.some((s: any) => s.custom)).toBe(true);
  const theme = { bg: '#000000', surface: '#111111', text: '#ffffff', muted: '#aaaaaa', accent: '#00aaaa', accent2: '#8800ff', headingFont: 'Montserrat', bodyFont: 'Inter' };
  const r: any = await (await call('deck/design', { options: { topic: 'ACL', slides: 8, language: 'English', style: 'modern', imagery: 'mixed', notes: true, audience: 'students' }, title: plan.title, theme, total: 8, start: 3, slides: [{ ...plan.slides[3], kind: 'concept' }] })).json();
  expect(r.slides[0].html).toContain('s4');
});

it('maps a visual chat request to free style settings', async () => {
  const r: any = await (await call('deck/style', { instruction: 'كبّر العناوين وخليها أغمق', current: { titleScale: 1, bodyScale: 1, showNumbers: true } })).json();
  expect(r.palette).toBe('navy');
  expect(r.titleScale).toBeCloseTo(1.15);
});

it('strips scripts, handlers and remote resources from AI slide HTML', () => {
  const h = sanitizeSlideHtml(`<style>@import url(http://evil);.a{background:url(https://x/y.png)}</style><section class="slide"><script>alert(1)</script><img src="https://evil/x.png" onerror="alert(2)"><a href="javascript:alert(3)">x</a></section>`, 4);
  expect(h).not.toMatch(/script|onerror|https?:|@import|javascript/i);
  expect(h).toContain('s4');
});

it('spreads different sources across sections', () => {
  const parts = distribute(mockSources(12), 6, 6);
  expect(new Set(parts.flat().map(s => s.id)).size).toBe(12);
  expect(parts.every(p => p.length === 6)).toBe(true);
});

it('enforces the daily research limit per student with a clear Arabic message', async () => {
  const e = { ...env, DAILY_RESEARCH_LIMIT: '2' };
  const go = () => app.fetch(new Request('http://x/api/v6/research/plan', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' }, body: JSON.stringify(ro) }), e);
  expect((await go()).status).toBe(200);
  expect((await go()).status).toBe(200);
  const r = await go();
  expect(r.status).toBe(429);
  expect(((await r.json()) as any).message).toContain('الحد اليومي');
});

it('maps formatting requests to settings and admits what it cannot do', async () => {
  const r: any = await (await call('doc/format', { instruction: 'عاوز الترقيم روماني والمسافة دبل ومرجع فانكوفر وضيف حواشي', current: {} })).json();
  expect(r.numbering).toBe('roman');
  expect(r.lineSpacing).toBe('2');
  expect(r.citationStyle).toBe('Vancouver');
  expect(r.unsupported).toContain('الحواشي');
});

it('answers "why are you stuck" from the real job state', async () => {
  const r: any = await (await call('edit/understand', { message: 'انت معلق ليه؟', kind: 'deck', items: ['a', 'b'], history: [], selected: null, state: { status: 'error', progress: '', lastError: 'ضغط على الخدمة', done: 7, total: 12 } })).json();
  expect(r.action).toBe('answer');
  expect(r.reply).toContain('7');
});
