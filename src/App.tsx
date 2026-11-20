import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AcademicSection } from '../shared/model';
import { cited } from '../shared/model';
import { download, filename } from './files';
import { deleteProject, listProjects, saveProject } from './v6/db';
import { researchPdf, researchWord } from './v6/docExport';
import { applyStyle, handleMessage, redraw, referenceList, runDeck, runResearch, themeOf, wordsIn, type Ctx } from './v6/engine';
import { DEFAULT_STYLE, FONT_PAIRS, PALETTES, type SlideData } from './v6/templates';
import { readFile, type ReadResult } from './v6/readFile';
import { exportFile, FILE_LABELS } from './v6/exportFile';
import { ImagePicker, type PickedImage } from './v6/ImagePicker';
import { DEFAULT_DOC_STYLE, DEFAULT_FORMAT, DOC_THEMES, parts, sectionLabel, type DocFormat, type DocStyle, type DocTheme } from './v6/docDesign';
import { exportDeckPdf, exportPptx, slideDocument, W, H } from './v6/slides';
import type { DeckOptions, Kind, Msg, ResearchOptions, V6Project } from './v6/types';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* ═════════════════════════ Project store ═════════════════════════ */

function useProjects() {
  const ref = useRef(new Map<string, V6Project>());
  const [, setTick] = useState(0);
  const timers = useRef(new Map<string, number>());
  const rerender = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { listProjects().then(list => { list.forEach(p => { if (p.status === 'working') { p.status = 'error'; p.progress = ''; } ref.current.set(p.id, p); }); rerender(); }); }, [rerender]);
  const persist = useCallback((p: V6Project) => {
    clearTimeout(timers.current.get(p.id));
    timers.current.set(p.id, window.setTimeout(() => saveProject(p).catch(() => {}), 400));
  }, []);
  const update = useCallback((id: string, fn: (p: V6Project) => void) => {
    const p = ref.current.get(id);
    if (!p) return;
    fn(p);
    p.updatedAt = now();
    ref.current.set(id, { ...p });
    persist(ref.current.get(id)!);
    rerender();
  }, [persist, rerender]);
  const add = useCallback((p: V6Project) => { ref.current.set(p.id, p); persist(p); rerender(); }, [persist, rerender]);
  const remove = useCallback((id: string) => { ref.current.delete(id); deleteProject(id); rerender(); }, [rerender]);
  return { map: ref.current, update, add, remove };
}

/* ═════════════════════════ App ═════════════════════════ */

type View = { name: 'home' } | { name: 'form'; kind: Kind } | { name: 'project'; id: string };

export default function App() {
  const store = useProjects();
  const [view, setView] = useState<View>({ name: 'home' });
  const jobs = useRef(new Map<string, AbortController>());

  const ctxFor = useCallback((id: string, signal: AbortSignal): Ctx => ({
    get: () => store.map.get(id)!,
    update: fn => store.update(id, fn),
    say: (content, tone, files) => store.update(id, p => { p.messages = [...p.messages, { id: uid(), role: 'assistant', content, at: now(), tone, ...(files?.length ? { files } : {}) }]; }),
    progress: text => store.update(id, p => { p.progress = text; }),
    signal,
  }), [store]);

  const run = useCallback(async (id: string, job: (ctx: Ctx) => Promise<void>) => {
    jobs.current.get(id)?.abort();
    const ac = new AbortController();
    jobs.current.set(id, ac);
    const ctx = ctxFor(id, ac.signal);
    store.update(id, p => { p.status = 'working'; });
    try { await job(ctx); store.update(id, p => { if (p.status !== 'error') p.lastError = ''; }); }
    catch (e) {
      if ((e as Error).name === 'AbortError') ctx.say('اتوقف بناءً على طلبك. اكتب "كمّل" لو عاوز تكمّل.', 'error');
      else ctx.say((e as Error).message || 'حصلت مشكلة. جرّب تاني.', 'error');
      store.update(id, p => { p.status = 'error'; p.progress = ''; p.lastError = (e as Error).message; });
    } finally {
      if (jobs.current.get(id) === ac) jobs.current.delete(id);
      store.update(id, p => { if (p.status === 'working') p.status = 'ready'; p.progress = ''; });
    }
  }, [ctxFor, store]);

  const start = (p: V6Project) => {
    store.add(p);
    setView({ name: 'project', id: p.id });
    run(p.id, p.kind === 'deck' ? runDeck : runResearch);
  };

  const project = view.name === 'project' ? store.map.get(view.id) : undefined;

  return (
    <div className="app" dir="rtl">
      {view.name === 'home' && <Home projects={[...store.map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))} open={id => setView({ name: 'project', id })} pick={kind => setView({ name: 'form', kind })} remove={store.remove} />}
      {view.name === 'form' && (view.kind === 'deck'
        ? <DeckForm back={() => setView({ name: 'home' })} research={[...store.map.values()].filter(p => p.kind !== 'deck' && p.sections?.some(Boolean))} start={start} />
        : <ResearchForm kind={view.kind} back={() => setView({ name: 'home' })} start={start} />)}
      {project && <Workspace key={project.id} p={project} back={() => setView({ name: 'home' })}
        busy={project.status === 'working'}
        stop={() => jobs.current.get(project.id)?.abort()}
        send={(text, selected, attachments) => {
          store.update(project.id, p => { p.messages = [...p.messages, { id: uid(), role: 'user', content: text, at: now(), ...(attachments.length ? { attachments: attachments.map(a => a.name) } : {}) }]; });
          run(project.id, ctx => handleMessage(ctx, text, selected, attachments));
        }}
        act={job => run(project.id, job)}
        toDeck={() => setView({ name: 'form', kind: 'deck' })} />}
    </div>
  );
}

/* ═════════════════════════ Home ═════════════════════════ */

const PATHS: { kind: Kind; icon: string; title: string; desc: string; tags: string[] }[] = [
  { kind: 'research', icon: '📚', title: 'بحث علمي', desc: 'بحث كامل بمراجع حقيقية متأكد منها من PubMed، بعدد الصفحات اللي تحدده.', tags: ['مراجع موثّقة', 'APA · Vancouver · Harvard', 'PDF + Word'] },
  { kind: 'deck', icon: '🎞️', title: 'عرض PowerPoint', desc: 'عرض متصمم شريحة شريحة برسومات وأيقونات وصور طبية حقيقية.', tags: ['تصميم احترافي', 'ملاحظات المتحدث', 'PPTX + PDF'] },
  { kind: 'lab', icon: '🧪', title: 'Lab Report', desc: 'تقرير معمل بالهيكل الأكاديمي الصحيح، مبني على نتايجك أنت.', tags: ['Aim → Conclusion', 'جداول النتايج', 'PDF + Word'] },
];

function Home({ projects, open, pick, remove }: { projects: V6Project[]; open: (id: string) => void; pick: (k: Kind) => void; remove: (id: string) => void }) {
  return (
    <main className="home">
      <header className="hero">
        <div className="brand"><span className="logo">MIA</span><span>Homework Studio</span></div>
        <h1>واجبك يطلع <em>احترافي</em> من أول مرة</h1>
        <p>اختار اللي محتاجه، حدّد الاختيارات، وسيبه يشتغل. تقدر تعدّل أي حاجة بعدها بالكلام عادي.</p>
      </header>
      <section className="paths">
        {PATHS.map(x => (
          <button key={x.kind} className={'path path-' + x.kind} onClick={() => pick(x.kind)}>
            <span className="path-icon">{x.icon}</span>
            <span className="path-body">
              <strong>{x.title}</strong>
              <span>{x.desc}</span>
              <span className="tags">{x.tags.map(t => <i key={t}>{t}</i>)}</span>
            </span>
            <span className="arrow">←</span>
          </button>
        ))}
      </section>
      {projects.length > 0 && (
        <section className="recent">
          <h2>شغلك اللي فات</h2>
          {projects.slice(0, 20).map(p => (
            <div key={p.id} className="recent-item">
              <button onClick={() => open(p.id)}>
                <span>{p.kind === 'deck' ? '🎞️' : p.kind === 'lab' ? '🧪' : '📚'}</span>
                <span className="r-title">{p.title}</span>
                <span className={'pill ' + p.status}>{p.status === 'ready' ? 'جاهز' : p.status === 'working' ? 'شغال' : 'محتاج يكمل'}</span>
              </button>
              <button className="icon-btn" aria-label="حذف" onClick={() => { if (confirm('تمسح المشروع ده نهائيًا؟')) remove(p.id); }}>🗑</button>
            </div>
          ))}
        </section>
      )}
      <footer className="foot">Medical Intelligence Academy</footer>
    </main>
  );
}

/* ═════════════════════════ Form controls ═════════════════════════ */

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return <div className="chips">{options.map(([v, label, hint]) => <button type="button" key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}{hint && <small>{hint}</small>}</button>)}</div>;
}
function Multi({ value, options, onChange }: { value: string[]; options: [string, string][]; onChange: (v: string[]) => void }) {
  return <div className="chips">{options.map(([v, label]) => <button type="button" key={v} className={value.includes(v) ? 'on' : ''} onClick={() => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])}>{value.includes(v) ? '✓ ' : ''}{label}</button>)}</div>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}{hint && <small>{hint}</small>}</label>{children}</div>;
}
function Stepper({ value, min, max, onChange, unit }: { value: number; min: number; max: number; onChange: (n: number) => void; unit: string }) {
  return <div className="stepper"><button type="button" onClick={() => onChange(Math.max(min, value - 1))}>−</button><b>{value} <small>{unit}</small></b><button type="button" onClick={() => onChange(Math.min(max, value + 1))}>+</button></div>;
}

function useUpload() {
  const [state, setState] = useState<{ name: string; text: string; busy: string }[]>([]);
  const add = async (files: FileList | null) => {
    for (const f of [...(files || [])]) {
      setState(s => [...s, { name: f.name, text: '', busy: 'بقرا الملف…' }]);
      try {
        const a = await readFile(f, msg => setState(s => s.map(x => x.name === f.name ? { ...x, busy: msg } : x)));
        setState(s => s.map(x => x.name === f.name ? { ...x, text: a.text, busy: '' } : x));
      } catch (e) {
        setState(s => s.filter(x => x.name !== f.name));
        alert('مقدرتش أقرا ' + f.name + ': ' + (e as Error).message);
      }
    }
  };
  return { files: state, add, remove: (n: string) => setState(s => s.filter(x => x.name !== n)), text: state.map(x => `--- ${x.name} ---\n${x.text}`).join('\n\n'), busy: state.some(x => x.busy) };
}

function Upload({ u, label }: { u: ReturnType<typeof useUpload>; label: string }) {
  return (
    <div className="upload">
      <label className="upload-btn">📎 {label}<input type="file" multiple accept=".pdf,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png,.webp" onChange={e => { u.add(e.target.files); e.target.value = ''; }} /></label>
      {u.files.map(f => <span key={f.name} className="file-chip">{f.busy ? '⏳ ' : '📄 '}{f.name}{f.busy && <small> {f.busy}</small>}<button type="button" onClick={() => u.remove(f.name)}>×</button></span>)}
    </div>
  );
}

function FormShell({ title, icon, back, children, submit, disabled, cta }: { title: string; icon: string; back: () => void; children: React.ReactNode; submit: () => void; disabled: boolean; cta: string }) {
  return (
    <main className="form-page">
      <header className="bar"><button className="back" onClick={back}>→ رجوع</button><h1>{icon} {title}</h1></header>
      <form onSubmit={e => { e.preventDefault(); if (!disabled) submit(); }}>
        {children}
        <div className="submit-bar"><button className="primary big" disabled={disabled}>{cta}</button></div>
      </form>
    </main>
  );
}

const blankCover = { student: '', university: '', faculty: '', course: '', professor: '', date: '' };

function newProject(kind: Kind, title: string): V6Project {
  return { id: uid(), kind, title, createdAt: now(), updatedAt: now(), status: 'working', progress: 'ببدأ…', messages: [], sources: [], cover: { ...blankCover } };
}

/* ═════════════════════════ Research / Lab form ═════════════════════════ */

function ResearchForm({ kind, back, start }: { kind: 'research' | 'lab'; back: () => void; start: (p: V6Project) => void }) {
  const lab = kind === 'lab';
  const [o, setO] = useState<ResearchOptions>({
    path: kind, topic: '', sourceMode: 'scientific', pages: lab ? 6 : 8, language: 'English', level: 'Undergraduate (years 3–5)',
    citationStyle: 'APA', minRefs: lab ? 5 : 10, recentYears: 10, extras: lab ? ['tables'] : ['abstract', 'tables', 'diagrams'], instructions: '', labData: '',
  });
  const [cover, setCover] = useState({ ...blankCover });
  const u = useUpload();
  const set = <K extends keyof ResearchOptions>(k: K, v: ResearchOptions[K]) => setO(x => ({ ...x, [k]: v }));
  const submit = () => {
    const p = newProject(kind, o.topic);
    p.ro = { ...o, instructions: [o.instructions, u.text].filter(Boolean).join('\n\n').slice(0, 30000) };
    p.cover = cover;
    p.messages = [{ id: uid(), role: 'user', at: now(), content: `${lab ? 'Lab report' : 'بحث'}: **${o.topic}**\n${o.pages} صفحة · ${o.language === 'Arabic' ? 'عربي' : 'English'} · ${o.sourceMode === 'none' ? 'بدون مراجع' : `${o.citationStyle} · ${o.minRefs}+ مرجع`}` }];
    start(p);
  };
  return (
    <FormShell title={lab ? 'Lab Report' : 'بحث علمي'} icon={lab ? '🧪' : '📚'} back={back} submit={submit} disabled={o.topic.trim().length < 3 || u.busy} cta={lab ? 'ابدأ التقرير ✨' : 'ابدأ البحث ✨'}>
      <Field label={lab ? 'اسم التجربة / الموضوع' : 'موضوع البحث'} hint="اكتبه بالعربي أو الإنجليزي">
        <textarea rows={2} value={o.topic} onChange={e => set('topic', e.target.value)} placeholder={lab ? 'مثال: Effect of exercise on heart rate' : 'مثال: Rotator cuff tendinopathy: assessment and rehabilitation'} autoFocus />
      </Field>
      {lab && <Field label="نتايج التجربة بتاعتك" hint="الأرقام والملاحظات اللي سجلتها — مش هنألف أي قياس">
        <textarea rows={4} value={o.labData} onChange={e => set('labData', e.target.value)} placeholder="مثال: Resting HR 72 bpm, after 5 min jogging 128 bpm, after 2 min rest 96 bpm…" />
      </Field>}
      <Field label="تعليمات الدكتور (اختياري)" hint="ارفع الملف أو صورة، أو اكتبها">
        <Upload u={u} label="ارفع ملف أو صورة" />
        <textarea rows={2} value={o.instructions} onChange={e => set('instructions', e.target.value)} placeholder="أي شروط معينة من الدكتور…" />
      </Field>
      <Field label="نوع المصادر">
        <Chips value={o.sourceMode} onChange={v => set('sourceMode', v)} options={[['scientific', 'علمية محكّمة', 'PubMed · Europe PMC'], ['general', 'بحث عام', 'كل المجالات · OpenAlex'], ['none', 'بدون مراجع', 'من المعلومات الأساسية']]} />
      </Field>
      <div className="row2">
        <Field label="عدد الصفحات" hint="شامل الغلاف والفهرس والمراجع"><Stepper value={o.pages} min={3} max={30} onChange={v => set('pages', v)} unit="صفحة" /></Field>
        <Field label="اللغة"><Chips value={o.language} onChange={v => set('language', v)} options={[['English', 'English'], ['Arabic', 'العربية']]} /></Field>
      </div>
      <Field label="المستوى">
        <Chips value={o.level} onChange={v => set('level', v)} options={[['Undergraduate (years 1–2)', 'سنة أولى/تانية'], ['Undergraduate (years 3–5)', 'سنين متقدمة'], ['Internship / postgraduate', 'امتياز / دراسات عليا']]} />
      </Field>
      {o.sourceMode !== 'none' && <>
        <Field label="نظام المراجع"><Chips value={o.citationStyle} onChange={v => set('citationStyle', v)} options={[['APA', 'APA 7'], ['Vancouver', 'Vancouver'], ['Harvard', 'Harvard']]} /></Field>
        <div className="row2">
          <Field label="أقل عدد مراجع"><Chips value={o.minRefs} onChange={v => set('minRefs', v)} options={[[5, '5'], [10, '10'], [15, '15'], [20, '20']]} /></Field>
          <Field label="حداثة المراجع"><Chips value={o.recentYears} onChange={v => set('recentYears', v)} options={[[5, 'آخر 5 سنين'], [10, 'آخر 10'], [0, 'أي وقت']]} /></Field>
        </div>
      </>}
      <Field label="إضافات">
        <Multi value={o.extras} onChange={v => set('extras', v)} options={[...(lab ? [] : [['abstract', 'Abstract'] as [string, string]]), ['tables', 'جداول'], ['diagrams', 'رسومات توضيحية']]} />
      </Field>
      <details className="cover-box">
        <summary>بيانات صفحة الغلاف (اختياري)</summary>
        <div className="grid2">
          {([['student', 'اسم الطالب'], ['university', 'الجامعة'], ['faculty', 'الكلية'], ['course', 'المادة'], ['professor', 'اسم الدكتور']] as const).map(([k, l]) =>
            <input key={k} placeholder={l} value={cover[k]} onChange={e => setCover(c => ({ ...c, [k]: e.target.value }))} />)}
        </div>
      </details>
    </FormShell>
  );
}

/* ═════════════════════════ Deck form ═════════════════════════ */

const STYLES: { v: DeckOptions['style']; name: string; colors: string[] }[] = [
  { v: 'clinical', name: 'طبي هادي', colors: ['#FFFFFF', '#0E5E6F', '#3AAFA9'] },
  { v: 'modern', name: 'عصري', colors: ['#0B1220', '#22D3EE', '#8B5CF6'] },
  { v: 'academic', name: 'أكاديمي', colors: ['#FBF8F1', '#7A1F3D', '#C9A227'] },
  { v: 'bold', name: 'جريء', colors: ['#111111', '#FF5A36', '#FFD23F'] },
];

function DeckForm({ back, start, research }: { back: () => void; start: (p: V6Project) => void; research: V6Project[] }) {
  const [src, setSrc] = useState<'topic' | 'file' | 'text' | 'research'>(research.length ? 'research' : 'topic');
  const [rid, setRid] = useState(research[0]?.id || '');
  const [text, setText] = useState('');
  const [o, setO] = useState<DeckOptions>({ topic: '', content: '', slides: 12, language: 'English', style: 'clinical', imagery: 'mixed', notes: true, audience: 'Physical therapy and medical students', withSources: true, premium: false });
  const [who, setWho] = useState({ presenter: '', institution: '' });
  const u = useUpload();
  const set = <K extends keyof DeckOptions>(k: K, v: DeckOptions[K]) => setO(x => ({ ...x, [k]: v }));
  const fromResearch = research.find(r => r.id === rid);
  const ready = src === 'research' ? !!fromResearch : src === 'file' ? u.files.length > 0 && !u.busy : src === 'text' ? text.trim().length > 40 : o.topic.trim().length > 2;
  const submit = () => {
    let content = '', topic = o.topic, sources = [] as V6Project['sources'];
    if (src === 'research' && fromResearch) {
      topic = fromResearch.title;
      content = (fromResearch.sections || []).filter(Boolean).map(s => `## ${s!.heading}\n` + s!.paragraphs.map(x => x.text + (x.sourceIds.length ? ' [' + x.sourceIds.join(', ') + ']' : '')).join('\n')).join('\n\n');
      sources = fromResearch.sources;
    } else if (src === 'file') content = u.text;
    else if (src === 'text') content = text;
    if (!topic.trim()) topic = (content.split('\n').find(l => l.trim().length > 3) || 'Presentation').replace(/^[-#\s]+/, '').slice(0, 120);
    const p = newProject('deck', topic);
    p.dk = { ...o, topic, content: content.slice(0, 60000), withSources: src === 'topic' && o.withSources };
    p.sources = sources;
    p.coverInfo = { presenter: who.presenter, institution: who.institution, date: new Date().toLocaleDateString(o.language === 'Arabic' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric' }) };
    p.style = { ...DEFAULT_STYLE };
    p.messages = [{ id: uid(), role: 'user', at: now(), content: `عرض: **${topic}**\n${o.slides} شريحة · ${STYLES.find(s => s.v === o.style)!.name} · ${o.language === 'Arabic' ? 'عربي' : 'English'}` }];
    start(p);
  };
  return (
    <FormShell title="عرض PowerPoint" icon="🎞️" back={back} submit={submit} disabled={!ready} cta="صمّم العرض ✨">
      <Field label="العرض هيتعمل من إيه؟">
        <Chips value={src} onChange={setSrc} options={[...(research.length ? [['research', 'من بحث عملته'] as ['research', string]] : []), ['topic', 'موضوع جديد'], ['file', 'ارفع ملف'], ['text', 'الصق نص']]} />
      </Field>
      {src === 'research' && <Field label="اختار البحث"><select value={rid} onChange={e => setRid(e.target.value)}>{research.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>}
      {src === 'topic' && <>
        <Field label="موضوع العرض"><textarea rows={2} value={o.topic} onChange={e => set('topic', e.target.value)} placeholder="مثال: Anterior cruciate ligament injury" autoFocus /></Field>
        <label className="toggle"><input type="checkbox" checked={o.withSources} onChange={e => set('withSources', e.target.checked)} /> ابنيه على مراجع علمية حقيقية (PubMed)</label>
      </>}
      {src === 'file' && <Field label="ارفع المحاضرة أو البحث" hint="PDF · Word · PowerPoint · صورة"><Upload u={u} label="اختار ملف" /></Field>}
      {src === 'text' && <Field label="الصق المحتوى"><textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="الصق هنا النص اللي عاوز تعمله عرض…" /></Field>}
      {src !== 'topic' && <Field label="عنوان العرض (اختياري)"><input value={o.topic} onChange={e => set('topic', e.target.value)} placeholder="لو سبته فاضي هختاره أنا" /></Field>}
      <div className="row2">
        <Field label="عدد الشرايح"><Stepper value={o.slides} min={5} max={25} onChange={v => set('slides', v)} unit="شريحة" /></Field>
        <Field label="اللغة"><Chips value={o.language} onChange={v => set('language', v)} options={[['English', 'English'], ['Arabic', 'العربية']]} /></Field>
      </div>
      <Field label="ستايل التصميم">
        <div className="styles">{STYLES.map(s => (
          <button type="button" key={s.v} className={'style-card' + (o.style === s.v ? ' on' : '')} onClick={() => set('style', s.v)}>
            <span className="swatch" style={{ background: s.colors[0] }}><i style={{ background: s.colors[1] }} /><i style={{ background: s.colors[2] }} /><b style={{ color: s.colors[1] }}>Aa</b></span>
            {s.name}
          </button>))}</div>
      </Field>
      <Field label="نوع الصور والرسومات">
        <Chips value={o.imagery} onChange={v => set('imagery', v)} options={[['mixed', 'مزيج ذكي'], ['photos', 'صور طبية حقيقية'], ['diagrams', 'Diagrams ورسومات'], ['illustrations', 'أيقونات ورسوم']]} />
      </Field>
      <Field label="الجمهور"><Chips value={o.audience} onChange={v => set('audience', v)} options={[['Physical therapy and medical students', 'طلبة'], ['Professors and examination committee', 'دكاترة / لجنة'], ['Patients and general public', 'مرضى / عامة']]} /></Field>
      <Field label="مستوى التصميم">
        <Chips value={o.premium ? 'p' : 's'} onChange={v => set('premium', v === 'p')} options={[['s', 'احترافي', 'قوالب MIA · سريع واقتصادي'], ['p', 'Premium ✦', 'رسومات مخصصة بـ Claude للشرايح المهمة']]} />
      </Field>
      <label className="toggle"><input type="checkbox" checked={o.notes} onChange={e => set('notes', e.target.checked)} /> اكتب ملاحظات المتحدث (اللي هتقوله في كل شريحة)</label>
      <details className="cover-box">
        <summary>بيانات الغلاف (اختياري)</summary>
        <div className="grid2">
          <input placeholder="اسم المقدّم" value={who.presenter} onChange={e => setWho(w => ({ ...w, presenter: e.target.value }))} />
          <input placeholder="الجامعة / الكلية" value={who.institution} onChange={e => setWho(w => ({ ...w, institution: e.target.value }))} />
        </div>
      </details>
    </FormShell>
  );
}

/* ═════════════════════════ Workspace ═════════════════════════ */

function Workspace({ p, back, send, busy, stop, toDeck, act }: { p: V6Project; back: () => void; send: (t: string, selected: number | null, attachments: ReadResult[]) => void; busy: boolean; stop: () => void; toDeck: () => void; act: (job: (ctx: Ctx) => Promise<void>) => void }) {
  const [tab, setTab] = useState<'file' | 'chat'>('file');
  const [sheet, setSheet] = useState<'' | 'style' | 'text' | 'image'>('');
  useEffect(() => {
    const on = (e: Event) => { setSelected((e as CustomEvent).detail); setSheet('image'); };
    window.addEventListener('mia-pick-image', on);
    return () => window.removeEventListener('mia-pick-image', on);
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const lastCount = useRef(p.messages.length);
  useEffect(() => {
    if (p.messages.length > lastCount.current && tab === 'file') setUnread(u => u + p.messages.length - lastCount.current);
    lastCount.current = p.messages.length;
  }, [p.messages.length, tab]);
  const deck = p.kind === 'deck';
  const submit = (t: string, att: ReadResult[]) => { send(t, selected, att); setTab('chat'); setUnread(0); };
  return (
    <div className="ws">
      <header className="ws-bar">
        <button className="back" onClick={back} aria-label="رجوع">→</button>
        <div className="ws-title"><strong>{p.title}</strong><small>{deck ? `${p.slides?.length || p.dk?.slides} شريحة` : `${p.ro?.pages} صفحة · ${p.ro?.language === 'Arabic' ? 'عربي' : 'English'}`}</small></div>
        <Downloads p={p} busy={busy} />
      </header>
      <nav className="tabs">
        <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>{deck ? '🎞️ الشرايح' : '📄 البحث'}</button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => { setTab('chat'); setUnread(0); }}>💬 المحادثة{unread > 0 && <span className="badge">{unread}</span>}</button>
      </nav>
      {deck && p.slides && p.status !== 'working' && tab === 'file' && (
        <div className="toolbar">
          <button onClick={() => setSheet('style')}>🎨 التنسيق</button>
          <button disabled={selected === null} onClick={() => setSheet('text')}>✏️ تعديل النص{selected !== null ? ` (${selected + 1})` : ''}</button>
          <button disabled={selected === null} onClick={() => setSheet('image')}>🖼️ صورة{selected !== null ? ` (${selected + 1})` : ''}</button>
        </div>
      )}
      {!deck && p.sections?.some(Boolean) && p.status !== 'working' && tab === 'file' && (
        <div className="toolbar">
          <button onClick={() => setSheet('style')}>🎨 شكل الـ PDF</button>
          <button disabled={selected === null} onClick={() => setSheet('text')}>✏️ تعديل النص{selected !== null ? ` (${selected + 1})` : ''}</button>
          <button disabled={selected === null} onClick={() => setSheet('image')}>🖼️ صورة{selected !== null ? ` (${selected + 1})` : ''}</button>
        </div>
      )}
      {!deck && sheet === 'style' && <DocStyleSheet p={p} close={() => setSheet('')} act={act} />}
      {!deck && sheet === 'text' && selected !== null && p.sections?.[selected] && <DocTextSheet p={p} i={selected} close={() => setSheet('')} act={act} />}
      {deck && sheet === 'style' && <StyleSheet p={p} close={() => setSheet('')} act={act} />}
      {sheet === 'image' && selected !== null && (deck ? p.slides?.[selected] : p.sections?.[selected]) && (
        <ImagePicker
          title={deck ? `صورة للشريحة ${selected + 1}` : `صورة للجزء ${selected + 1}`}
          query={deck ? (p.slides![selected].data?.imageQuery || p.slides![selected].plan.title) : (p.sections![selected]!.heading)}
          close={() => setSheet('')}
          onPick={img => act(ctx => applyStyle(ctx, q => setImage(q, selected, img), img ? 'إضافة صورة' : 'شيل الصورة'))} />
      )}
      {deck && sheet === 'text' && selected !== null && p.slides?.[selected] && <TextSheet p={p} i={selected} close={() => setSheet('')} act={act} />}
      {busy && p.progress && <div className="progress"><span className="spinner" />{p.progress}<button onClick={stop}>إيقاف</button></div>}
      <div className={'ws-body tab-' + tab}>
        <section className="pane file-pane">
          {deck ? <DeckPreview p={p} selected={selected} select={setSelected} /> : <DocPreview p={p} selected={selected} select={setSelected} />}
          {!deck && p.status === 'ready' && <button className="ghost wide" onClick={toDeck}>🎞️ اعمل من البحث ده عرض PowerPoint</button>}
        </section>
        <section className="pane chat-pane"><Chat p={p} /></section>
      </div>
      <Composer busy={busy} deck={deck} selected={selected} clear={() => setSelected(null)} submit={submit} />
    </div>
  );
}

/* ─────────── Downloads ─────────── */

function Downloads({ p, busy }: { p: V6Project; busy: boolean }) {
  const [work, setWork] = useState('');
  const [open, setOpen] = useState(false);
  const deck = p.kind === 'deck';
  const ready = deck ? p.slides?.some(s => s.status === 'done') : p.sections?.some(Boolean);
  const name = filename(p.title);
  const act = async (kind: string) => {
    setOpen(false);
    const map: Record<string, string> = { premium: 'premium_pdf', pdf: deck ? 'deck_pdf' : 'classic_pdf', word: 'word', pptx: 'pptx' };
    try { toast(await exportFile(p, map[kind] || kind, setWork)); } catch (e) { alert((e as Error).message); }
    setWork('');
  };
  if (!ready) return <span className="dl-wait">{busy ? '⏳' : ''}</span>;
  return (
    <div className="dl">
      <button className="primary" disabled={!!work} onClick={() => setOpen(o => !o)}>{work || '⬇ تحميل'}</button>
      {open && <div className="dl-menu" onClick={e => e.stopPropagation()}>
        {deck ? <><button onClick={() => act('pptx')}>🎞️ PowerPoint (.pptx)</button><button onClick={() => act('pdf')}>📕 PDF</button></>
          : <><button onClick={() => act('premium')}>✨ PDF Premium<small>تصميم كامل</small></button><button onClick={() => act('pdf')}>📄 PDF كلاسيكي<small>نص قابل للنسخ</small></button><button onClick={() => act('word')}>📘 Word (.docx)<small>للتعديل في Word</small></button></>}
      </div>}
    </div>
  );
}

function toast(text: string) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = '✅ ' + text;
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3200);
}

/* ─────────── Document preview ─────────── */

function Diagram({ d }: { d: NonNullable<AcademicSection['diagram']> }) {
  const n = d.nodes.length;
  return (
    <figure className="diagram">
      <figcaption>{d.title}</figcaption>
      <div className={'dg dg-' + d.kind}>{d.nodes.map((x, i) => <span key={i}><b>{x}</b>{d.kind !== 'hierarchy' && i < n - 1 && <i>←</i>}</span>)}</div>
    </figure>
  );
}

function DocPreview({ p, selected, select }: { p: V6Project; selected: number | null; select: (n: number | null) => void }) {
  const style = p.ro?.citationStyle || 'APA';
  // Computed every render: sections are updated in place, so a memo would go stale.
  const used = (() => {
    const ids = new Set((p.sections || []).filter(Boolean).flatMap(s => s!.paragraphs.flatMap(x => x.sourceIds)));
    const order: string[] = [];
    (p.sections || []).forEach(s => s?.paragraphs.forEach(x => x.sourceIds.forEach(id => { if (!order.includes(id)) order.push(id); })));
    return order.filter(id => ids.has(id)).map(id => p.sources.find(s => s.id === id)!).filter(Boolean);
  })();
  const totalWords = (p.sections || []).reduce((n, s) => n + wordsIn(s), 0);
  if (!p.outline) return <div className="paper"><Skeleton lines={10} /></div>;
  const rtl = p.ro?.language === 'Arabic';
  return (
    <article className="paper" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="paper-cover"><small>{p.kind === 'lab' ? 'Laboratory Report' : 'Academic Research Paper'}</small><h1>{p.title}</h1>{p.cover.student && <p>{p.cover.student}</p>}</div>
      <div className="stats-line" dir="rtl">{totalWords.toLocaleString('en')} كلمة · {used.length} مرجع مستخدم · {p.outline.length} أجزاء</div>
      {p.outline.map((o, i) => {
        const s = p.sections?.[i];
        return (
          <section key={i} className={'doc-sec' + (selected === i ? ' sel' : '') + (s ? '' : ' pending')} onClick={() => select(selected === i ? null : i)}>
            <h2>{(() => { const n = (p.sections || []).slice(0, i + 1).filter((x, j) => !(j === 0 && x && /^(abstract|summary|الملخص|ملخص)/i.test(x.heading))).length; const lab = sectionLabel(n, p.docFormat || DEFAULT_FORMAT, rtl); return lab && !(i === 0 && /^(abstract|summary|الملخص|ملخص)/i.test(s?.heading || o.heading)) ? <span className="num">{lab}</span> : null; })()}{s?.heading || o.heading}</h2>
            {!s ? <Skeleton lines={5} /> : <>
              {s.paragraphs.map((x, k) => {
                const ps = parts(x.text);
                const tail = cited('', x.sourceIds, used, style).trim();
                return <div key={k}>{ps.map((part, j) => {
                  const t = j === ps.length - 1 && tail ? ' ' + tail : '';
                  return part.list ? <ul key={j} className="bl">{part.lines.map((l, m) => <li key={m}>{l}{m === part.lines.length - 1 ? t : ''}</li>)}</ul> : <p key={j}>{part.lines.join(' ')}{t}</p>;
                })}</div>;
              })}
              {s.tables.map((t, k) => (
                <div className="tbl" key={k}><b>{t.title}</b><table><thead><tr>{t.headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead><tbody>{t.rows.map((r, j) => <tr key={j}>{r.map((c, m) => <td key={m}>{c}</td>)}</tr>)}</tbody></table></div>
              ))}
              {s.diagram && <Diagram d={s.diagram} />}
              {(s as any).figure?.data && <figure className="doc-fig"><img src={(s as any).figure.data} alt="" /><figcaption>{(s as any).figure.caption}{(s as any).figure.credit && <small>{(s as any).figure.credit}</small>}</figcaption></figure>}
              {(s as any).keyPoint && <div className="kp-box"><b>💡 {rtl ? 'النقطة الأهم' : 'Key point'}</b>{(s as any).keyPoint}</div>}
            </>}
            {selected === i && <div className="sel-hint" dir="rtl">✏️ اكتب تحت اللي عاوز تغيّره في الجزء ده</div>}
          </section>
        );
      })}
      {used.length > 0 && <section className="refs"><h2>{rtl ? 'المراجع' : 'References'}</h2><ol className={style === 'Vancouver' ? '' : 'plain'}>{(style === 'Vancouver' ? referenceList({ ...p, sources: used }) : referenceList(p).sort()).map((r, i) => <li key={i}>{r}</li>)}</ol></section>}
    </article>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return <div className="skeleton">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${70 + ((i * 37) % 30)}%` }} />)}</div>;
}

/* ─────────── Deck preview ─────────── */

function SlideFrame({ html, theme, rtl }: { html: string; theme: NonNullable<V6Project['theme']>; rtl: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [doc, setDoc] = useState('');
  useEffect(() => { let live = true; slideDocument(html, theme, rtl).then(d => live && setDoc(d)); return () => { live = false; }; }, [html, theme, rtl]);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="frame" ref={box} style={{ height: H * scale }}>
      {doc && <iframe title="slide" sandbox="allow-same-origin" srcDoc={doc} style={{ width: W, height: H, transform: `scale(${scale})` }} tabIndex={-1} />}
    </div>
  );
}

function DeckPreview({ p, selected, select }: { p: V6Project; selected: number | null; select: (n: number | null) => void }) {
  const [big, setBig] = useState<number | null>(null);
  if (!p.slides) return <div className="deck-grid">{Array.from({ length: p.dk?.slides || 8 }, (_, i) => <div key={i} className="slide-card"><div className="frame ph" /></div>)}</div>;
  const rtl = p.dk?.language === 'Arabic';
  return (
    <>
      <div className="deck-grid">
        {p.slides.map((s, i) => (
          <div key={i} className={'slide-card' + (selected === i ? ' sel' : '')}>
            <button className="slide-hit" onClick={() => select(selected === i ? null : i)} onDoubleClick={() => s.status === 'done' && setBig(i)}>
              {s.status === 'done' && s.html ? <SlideFrame html={s.html} theme={themeOf(p)} rtl={rtl} /> : <div className={'frame ph ' + s.status}>{s.status === 'error' ? '⚠️ لسه' : <span className="shimmer" />}</div>}
            </button>
            <div className="slide-meta">
              <span className="n">{i + 1}</span><span className="t">{s.plan.title}</span>
              {s.status === 'done' && <button className="icon-btn" aria-label="تكبير" onClick={() => setBig(i)}>⤢</button>}
            </div>
          </div>
        ))}
      </div>
      {big !== null && p.slides[big] && (
        <div className="viewer" onClick={() => setBig(null)}>
          <div className="viewer-inner" onClick={e => e.stopPropagation()}>
            <SlideFrame html={p.slides[big].html} theme={themeOf(p)} rtl={rtl} />
            <div className="viewer-bar">
              <button disabled={big === 0} onClick={() => setBig(big - 1)}>→ السابقة</button>
              <span>{big + 1} / {p.slides.length}</span>
              <button disabled={big === p.slides.length - 1} onClick={() => setBig(big + 1)}>التالية ←</button>
            </div>
            {p.slides[big].notes && <div className="notes" dir={rtl ? 'rtl' : 'ltr'}><b>🎤 ملاحظات المتحدث</b><p>{p.slides[big].notes}</p></div>}
            <div className="viewer-actions"><button className="primary" onClick={() => { select(big); setBig(null); }}>✏️ عدّل الشريحة دي</button><button onClick={() => setBig(null)}>إغلاق</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function LogoInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="logo-in">
      {value ? <img src={value} alt="" /> : <span className="hint">مفيش لوجو. ملفات الطالب مفيهاش أي اسم أو لوجو للأداة.</span>}
      <label className="ghost">{busy ? '⏳' : value ? 'غيّر اللوجو' : '+ ارفع لوجو'}<input type="file" accept="image/*" onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
        setBusy(true);
        try { const { toJpeg } = await import('./v6/readFile'); onChange(await toJpeg(f, 600, 0.9)); } catch (err) { alert((err as Error).message); }
        setBusy(false);
      }} /></label>
      {value && <button className="ghost" onClick={() => onChange(undefined)}>🗑 شيل</button>}
    </div>
  );
}

/** Puts a chosen picture on a slide or a research section (or removes it). */
function setImage(q: V6Project, i: number, img: PickedImage | null) {
  if (q.kind === 'deck') {
    const s = q.slides![i];
    if (!s.data) return;
    if (!img) { s.data = { ...s.data, userImage: undefined, imageCredit: undefined, imageQuery: '' }; return; }
    const keep = ['image_points', 'image_full', 'cover'].includes(s.data.layout);
    s.data = { ...s.data, userImage: img.data, imageCredit: img.credit, layout: keep ? s.data.layout : s.data.items.length >= 2 ? 'image_points' : 'image_full' };
    s.custom = false;
    s.plan.layout = s.data.layout;
  } else {
    const sec = q.sections![i] as any;
    if (!sec) return;
    if (!img) { delete sec.figure; return; }
    sec.figure = { data: img.data, credit: img.credit, width: img.width, height: img.height, caption: sec.figure?.caption || sec.heading };
  }
}

/* ─────────── Free, instant editing (no AI) ─────────── */

function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="sheet-hd"><b>{title}</b><button className="icon-btn" onClick={close} aria-label="إغلاق">✕</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function StyleSheet({ p, close, act }: { p: V6Project; close: () => void; act: (job: (ctx: Ctx) => Promise<void>) => void }) {
  const st = p.style || DEFAULT_STYLE;
  const cover = p.slides?.[0]?.data;
  const [ts, setTs] = useState(st.titleScale);
  const [bs, setBs] = useState(st.bodyScale);
  const [cv, setCv] = useState({ title: cover?.title || p.title, subtitle: cover?.subtitle || '', presenter: p.coverInfo?.presenter || '', institution: p.coverInfo?.institution || '', date: p.coverInfo?.date || '' });
  const apply = (fn: (q: V6Project) => void, label: string) => act(ctx => applyStyle(ctx, fn, label));
  const setStyle = (patch: Partial<typeof st>, label = 'تنسيق') => apply(q => { q.style = { ...(q.style || DEFAULT_STYLE), ...patch }; }, label);
  const custom = (p.slides || []).filter(s => s.custom).length;
  const base = themeOf({ ...p, style: { ...st, palette: '' } });
  return (
    <Sheet title="🎨 تنسيق العرض" close={close}>
      <p className="hint">التغييرات دي فورية ومجانية، ومفيش ذكاء اصطناعي. وتقدر ترجع أي تغيير بكلمة "تراجع".</p>
      <h4>الألوان</h4>
      <div className="pal">
        <button className={!st.palette ? 'on' : ''} onClick={() => setStyle({ palette: '' })}><span style={{ background: base.bg }}><i style={{ background: base.accent }} /><i style={{ background: base.accent2 }} /></span>الأصلي</button>
        {PALETTES.map(x => <button key={x.id} className={st.palette === x.id ? 'on' : ''} onClick={() => setStyle({ palette: x.id })}><span style={{ background: x.theme.bg }}><i style={{ background: x.theme.accent }} /><i style={{ background: x.theme.accent2 }} /></span>{x.name}</button>)}
      </div>
      <h4>الخط</h4>
      <div className="chips">{FONT_PAIRS.map(f => <button key={f.id} className={st.headingFont === f.heading && st.bodyFont === f.body ? 'on' : ''} style={{ fontFamily: f.heading }} onClick={() => setStyle({ headingFont: f.heading, bodyFont: f.body })}>{f.name}</button>)}</div>
      <h4>حجم العناوين <small>{Math.round(ts * 100)}%</small></h4>
      <input type="range" min={0.8} max={1.5} step={0.05} value={ts} onChange={e => setTs(+e.target.value)} onPointerUp={() => setStyle({ titleScale: ts }, 'حجم العناوين')} onKeyUp={() => setStyle({ titleScale: ts }, 'حجم العناوين')} />
      <h4>حجم النص <small>{Math.round(bs * 100)}%</small></h4>
      <input type="range" min={0.8} max={1.5} step={0.05} value={bs} onChange={e => setBs(+e.target.value)} onPointerUp={() => setStyle({ bodyScale: bs }, 'حجم النص')} onKeyUp={() => setStyle({ bodyScale: bs }, 'حجم النص')} />
      <label className="toggle small"><input type="checkbox" checked={st.showNumbers} onChange={e => setStyle({ showNumbers: e.target.checked })} /> أرقام الشرايح</label>
      <h4>الغلاف</h4>
      <div className="grid2">
        <input value={cv.title} placeholder="عنوان العرض" onChange={e => setCv(x => ({ ...x, title: e.target.value }))} />
        <input value={cv.subtitle} placeholder="العنوان الفرعي" onChange={e => setCv(x => ({ ...x, subtitle: e.target.value }))} />
        <input value={cv.presenter} placeholder="اسم المقدّم" onChange={e => setCv(x => ({ ...x, presenter: e.target.value }))} />
        <input value={cv.institution} placeholder="الجامعة / الكلية" onChange={e => setCv(x => ({ ...x, institution: e.target.value }))} />
        <input value={cv.date} placeholder="التاريخ" onChange={e => setCv(x => ({ ...x, date: e.target.value }))} />
      </div>
      <h4>🏛️ لوجو الجامعة (اختياري)</h4>
      <LogoInput value={p.coverInfo?.logo} onChange={v => apply(q => { q.coverInfo = { ...(q.coverInfo || { presenter: '', institution: '', date: '' }), logo: v }; }, 'اللوجو')} />
      <h4>حجم الأسماء في الغلاف</h4>
      <Chips value={st.coverNameScale || 1} onChange={v => setStyle({ coverNameScale: v }, 'حجم الأسماء')} options={[[1, 'عادي'], [1.3, 'كبير'], [1.6, 'كبير جدًا']]} />
      <button className="primary wide-btn" onClick={() => apply(q => {
        q.title = cv.title || q.title;
        q.coverInfo = { presenter: cv.presenter, institution: cv.institution, date: cv.date };
        const c0 = q.slides?.[0];
        if (c0?.data) c0.data = { ...c0.data, title: cv.title || c0.data.title, subtitle: cv.subtitle };
      }, 'الغلاف')}>حفظ الغلاف</button>
      {custom > 0 && <p className="hint">ملحوظة: فيه {custom} شريحة Premium مصممة خصيصًا. دي بتاخد الألوان والخط الجديد، لكن حجم الخط والنص فيها بيتعدّل من الشات.</p>}
    </Sheet>
  );
}

function TextSheet({ p, i, close, act }: { p: V6Project; i: number; close: () => void; act: (job: (ctx: Ctx) => Promise<void>) => void }) {
  const s = p.slides![i];
  const [d, setD] = useState<SlideData | undefined>(s.data ? structuredClone(s.data) : undefined);
  const [notes, setNotes] = useState(s.notes);
  if (!d || s.custom) return (
    <Sheet title={`✏️ الشريحة ${i + 1}`} close={close}>
      <p className="hint">الشريحة دي مصممة خصيصًا (Premium)، فالتعديل فيها بيتم من الشات. اكتب مثلًا: "كبّر العنوان في الشريحة {i + 1}" أو "غيّر الرسمة".</p>
      <button className="primary wide-btn" onClick={close}>تمام</button>
    </Sheet>
  );
  const up = (patch: Partial<SlideData>) => setD(x => ({ ...x!, ...patch }));
  const upItem = (k: number, patch: Partial<SlideData['items'][number]>) => setD(x => ({ ...x!, items: x!.items.map((it, j) => (j === k ? { ...it, ...patch } : it)) }));
  const L = d.layout;
  const usesItems = !['cover', 'section', 'comparison', 'table', 'quote', 'image_full', 'closing'].includes(L);
  const usesValue = ['stats', 'chart', 'timeline'].includes(L);
  return (
    <Sheet title={`✏️ نص الشريحة ${i + 1}`} close={close}>
      <label className="lbl">العنوان</label>
      <textarea rows={2} dir="auto" value={d.title} onChange={e => up({ title: e.target.value })} />
      {['cover', 'section', 'cards', 'image_full', 'closing', 'agenda'].includes(L) && <><label className="lbl">العنوان الفرعي</label><textarea rows={2} dir="auto" value={d.subtitle} onChange={e => up({ subtitle: e.target.value })} /></>}
      {L === 'stat' && <><label className="lbl">الرقم الكبير</label><input dir="auto" value={d.value} onChange={e => up({ value: e.target.value })} /></>}
      {['stat', 'chart', 'cycle', 'cover'].includes(L) && <><label className="lbl">{L === 'chart' ? 'الخلاصة' : L === 'cycle' ? 'النص في النص' : L === 'cover' ? 'السطر الصغير فوق العنوان' : 'شرح الرقم'}</label><input dir="auto" value={d.label} onChange={e => up({ label: e.target.value })} /></>}
      {L === 'quote' && <><label className="lbl">الاقتباس</label><textarea rows={3} dir="auto" value={d.quote} onChange={e => up({ quote: e.target.value })} /><label className="lbl">القائل</label><input dir="auto" value={d.author} onChange={e => up({ author: e.target.value })} /></>}
      {usesItems && d.items.map((it, k) => (
        <div className="item-ed" key={k}>
          <div className="item-hd"><b>{k + 1}</b><button className="icon-btn" onClick={() => setD(x => ({ ...x!, items: x!.items.filter((_, j) => j !== k) }))} aria-label="حذف">🗑</button></div>
          <input dir="auto" placeholder="العنوان" value={it.title} onChange={e => upItem(k, { title: e.target.value })} />
          {L !== 'chart' && <textarea rows={2} dir="auto" placeholder="الشرح" value={it.text} onChange={e => upItem(k, { text: e.target.value })} />}
          {usesValue && <input dir="auto" placeholder="الرقم / القيمة" value={it.value} onChange={e => upItem(k, { value: e.target.value })} />}
        </div>
      ))}
      {usesItems && d.items.length < 6 && <button className="ghost wide" onClick={() => setD(x => ({ ...x!, items: [...x!.items, { icon: 'sparkles', title: '', text: '', value: '' }] }))}>+ إضافة عنصر</button>}
      {L === 'comparison' && (['left', 'right'] as const).map(side => (
        <div className="item-ed" key={side}>
          <input dir="auto" value={d[side].title} onChange={e => up({ [side]: { ...d[side], title: e.target.value } } as any)} />
          <textarea rows={4} dir="auto" value={d[side].items.join('\n')} onChange={e => up({ [side]: { ...d[side], items: e.target.value.split('\n') } } as any)} />
          <small className="hint">كل سطر = نقطة</small>
        </div>
      ))}
      {L === 'table' && <>
        <label className="lbl">الجدول (كل سطر صف، والأعمدة بينها |)</label>
        <textarea rows={6} dir="auto" value={[d.headers.join(' | '), ...d.rows.map(r => r.join(' | '))].join('\n')} onChange={e => { const lines = e.target.value.split('\n'); up({ headers: (lines[0] || '').split('|').map(x => x.trim()), rows: lines.slice(1).map(l => l.split('|').map(x => x.trim())) }); }} />
      </>}
      {d.userImage && <div className="item-ed"><img src={d.userImage} alt="" style={{ maxHeight: 120, objectFit: 'contain' }} /><button className="ghost" onClick={() => up({ userImage: undefined })}>🗑 شيل الصورة دي</button></div>}
      <label className="lbl">المصدر أسفل الشريحة</label>
      <input dir="auto" value={d.source} onChange={e => up({ source: e.target.value })} />
      {p.dk?.notes && <><label className="lbl">🎤 ملاحظات المتحدث</label><textarea rows={4} dir="auto" value={notes} onChange={e => setNotes(e.target.value)} /></>}
      <button className="primary wide-btn" onClick={() => { act(ctx => applyStyle(ctx, q => { q.slides![i].data = { ...d, items: d.items.filter(x => x.title || x.text || x.value), left: { ...d.left, items: d.left.items.filter(Boolean) }, right: { ...d.right, items: d.right.items.filter(Boolean) } }; q.slides![i].notes = notes; }, 'تعديل نص الشريحة ' + (i + 1))); close(); }}>حفظ ✓</button>
    </Sheet>
  );
}

function DocStyleSheet({ p, close, act }: { p: V6Project; close: () => void; act: (job: (ctx: Ctx) => Promise<void>) => void }) {
  const [st, setSt] = useState<DocStyle>(p.docStyle || DEFAULT_DOC_STYLE);
  const [fm, setFm] = useState<DocFormat>({ ...DEFAULT_FORMAT, ...(p.docFormat || {}) });
  const [cs, setCs] = useState(p.ro?.citationStyle || 'APA');
  const set = <K extends keyof DocFormat>(k: K, v: DocFormat[K]) => setFm(x => ({ ...x, [k]: v }));
  const [cov, setCov] = useState({ title: p.title, ...p.cover });
  const [cs2, setCs2] = useState(p.coverStyle || { nameScale: 1, titleScale: 1 });
  const [logo, setLogo] = useState<string | undefined>(p.logo);

  const [prev, setPrev] = useState<{ images: string[]; total: number } | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    setBusy(true);
    import('./v6/docDesign').then(m => m.previewPages({ ...p, logo, title: cov.title || p.title, cover: { ...p.cover, ...cov }, coverStyle: cs2, docFormat: fm, ro: p.ro ? { ...p.ro, citationStyle: cs } : p.ro }, st, 3)).then(r => { if (live) { setPrev(r); setBusy(false); } }).catch(() => live && setBusy(false));
    return () => { live = false; };
  }, [st, fm, cs, cov, cs2, logo, p.updatedAt]);
  const save = () => { act(ctx => applyStyle(ctx, q => { q.docStyle = st; q.docFormat = fm; if (q.ro) q.ro = { ...q.ro, citationStyle: cs }; const { title, ...c } = cov; q.title = title || q.title; q.cover = { ...q.cover, ...c }; q.coverStyle = cs2; q.logo = logo; }, 'شكل الـ PDF')); close(); };
  return (
    <Sheet title="🎨 شكل الـ PDF" close={close}>
      <h4>الستايل</h4>
      <div className="doc-themes">{(Object.keys(DOC_THEMES) as DocTheme[]).map(k => {
        const t = DOC_THEMES[k];
        return <button key={k} className={st.theme === k ? 'on' : ''} onClick={() => setSt(x => ({ ...x, theme: k }))}>
          <span className="mini" style={{ background: t.cover }}><i style={{ background: t.accent }} /><em style={{ fontFamily: t.heading, color: t.coverInk }}>Aa</em></span>{t.name}</button>;
      })}</div>
      <h4>حجم الخط</h4>
      <Chips value={st.size} onChange={v => setSt(x => ({ ...x, size: v }))} options={[['compact', 'صغير'], ['normal', 'عادي'], ['large', 'كبير']]} />
      <h4>الغلاف</h4>
      <div className="grid2">
        <input dir="auto" value={cov.title} placeholder="عنوان البحث" onChange={e => setCov(x => ({ ...x, title: e.target.value }))} />
        {([['student', 'اسم الطالب'], ['university', 'الجامعة'], ['faculty', 'الكلية'], ['course', 'المادة'], ['professor', 'اسم الدكتور'], ['date', 'التاريخ']] as const).map(([k, l]) =>
          <input key={k} dir="auto" placeholder={l} value={(cov as any)[k] || ''} onChange={e => setCov(x => ({ ...x, [k]: e.target.value }))} />)}
      </div>
      <h4>🏛️ لوجو الجامعة (اختياري)</h4>
      <LogoInput value={logo} onChange={setLogo} />
      <h4>حجم الأسماء في الغلاف</h4>
      <Chips value={cs2.nameScale} onChange={v => setCs2(x => ({ ...x, nameScale: v }))} options={[[1, 'عادي'], [1.3, 'كبير'], [1.6, 'كبير جدًا']]} />
      <h4>حجم عنوان الغلاف</h4>
      <Chips value={cs2.titleScale} onChange={v => setCs2(x => ({ ...x, titleScale: v }))} options={[[0.85, 'أصغر'], [1, 'عادي'], [1.15, 'كبير'], [1.3, 'كبير جدًا']]} />
      <h4>ترقيم العناوين</h4>
      <Chips value={fm.numbering} onChange={v => set('numbering', v)} options={[['padded', '01'], ['decimal', '1'], ['roman', 'I'], ['letters', p.ro?.language === 'Arabic' ? 'أ' : 'A'], ['none', 'من غير']]} />
      <h4>المسافة بين السطور</h4>
      <Chips value={fm.lineSpacing} onChange={v => set('lineSpacing', v)} options={[['auto', 'تلقائي', 'يظبط عدد الصفحات'], ['1.15', 'مفرد'], ['1.5', '1.5'], ['2', 'دبل']]} />
      {fm.lineSpacing !== 'auto' && <p className="hint">⚠️ مع المسافة الثابتة، عدد الصفحات ممكن يختلف عن {p.ro?.pages}.</p>}
      <h4>الهوامش</h4>
      <Chips value={fm.margins} onChange={v => set('margins', v)} options={[['narrow', 'ضيقة'], ['normal', 'عادية'], ['wide', 'واسعة']]} />
      <h4>رقم الصفحة</h4>
      <Chips value={fm.pageNumber} onChange={v => set('pageNumber', v)} options={[['end', 'في الطرف'], ['center', 'في النص'], ['start', 'الطرف التاني'], ['none', 'من غير']]} />
      <h4>نظام المراجع</h4>
      <Chips value={cs} onChange={v => setCs(v)} options={[['APA', 'APA 7'], ['Vancouver', 'Vancouver'], ['Harvard', 'Harvard']]} />
      <label className="toggle small"><input type="checkbox" checked={fm.toc} onChange={e => set('toc', e.target.checked)} /> صفحة الفهرس</label>
      <label className="toggle small"><input type="checkbox" checked={fm.abstract} onChange={e => set('abstract', e.target.checked)} /> الـ Abstract (لو موجود)</label>
      <h4>نص الهيدر أعلى الصفحات</h4>
      <input dir="auto" value={fm.header} placeholder="لو فاضي هيبقى عنوان البحث" onChange={e => set('header', e.target.value)} />
      <p className="hint">{fm.lineSpacing === 'auto' ? `المسافات بتتظبط لوحدها عشان عدد الصفحات يفضل ${p.ro?.pages} على قد ما الكلام يسمح. ` : ''}التنسيق بيظهر في PDF Premium. ونظام المراجع بيتغيّر في كل الملفات. وتقدر تطلب أي حاجة من دول من الشات كمان.</p>
      <h4>معاينة {prev && <small>{prev.total} صفحة</small>}</h4>
      <div className="doc-prev">{busy && !prev ? <div className="skeleton"><span /><span /><span /></div> : prev?.images.map((src, i) => <img key={i} src={src} alt={'صفحة ' + (i + 1)} style={{ opacity: busy ? 0.5 : 1 }} />)}</div>
      <button className="primary wide-btn" onClick={save}>اعتمد الشكل ده ✓</button>
    </Sheet>
  );
}

function DocTextSheet({ p, i, close, act }: { p: V6Project; i: number; close: () => void; act: (job: (ctx: Ctx) => Promise<void>) => void }) {
  const s0 = p.sections![i]! as AcademicSection & { keyPoint?: string };
  const [s, setS] = useState(() => structuredClone(s0));
  const upP = (k: number, text: string) => setS(x => ({ ...x, paragraphs: x.paragraphs.map((q, j) => (j === k ? { ...q, text } : q)) }));
  const words = s.paragraphs.reduce((n, x) => n + x.text.split(/\s+/).filter(Boolean).length, 0);
  return (
    <Sheet title={`✏️ نص الجزء ${i + 1}`} close={close}>
      <label className="lbl">العنوان</label>
      <input dir="auto" value={s.heading} onChange={e => setS(x => ({ ...x, heading: e.target.value }))} />
      {s.paragraphs.map((x, k) => (
        <div className="item-ed" key={k}>
          <div className="item-hd"><b>فقرة {k + 1}{x.sourceIds.length ? <small className="hint"> · {x.sourceIds.length} مرجع محفوظ</small> : null}</b><button className="icon-btn" aria-label="حذف" onClick={() => setS(y => ({ ...y, paragraphs: y.paragraphs.filter((_, j) => j !== k) }))}>🗑</button></div>
          <textarea rows={6} dir="auto" value={x.text} onChange={e => upP(k, e.target.value)} />
        </div>
      ))}
      <button className="ghost wide" onClick={() => setS(y => ({ ...y, paragraphs: [...y.paragraphs, { text: '', sourceIds: [] }] }))}>+ فقرة جديدة</button>
      {(s as any).figure && <><label className="lbl">🖼️ تعليق الصورة</label><input dir="auto" value={(s as any).figure.caption} onChange={e => setS(x => ({ ...x, figure: { ...(x as any).figure, caption: e.target.value } } as any))} /></>}
      <label className="lbl">💡 النقطة الأهم (بتظهر في صندوق ملوّن)</label>
      <textarea rows={2} dir="auto" value={s.keyPoint || ''} onChange={e => setS(x => ({ ...x, keyPoint: e.target.value }))} />
      <p className="hint">{words} كلمة في الجزء ده. المراجع جوه كل فقرة بتفضل زي ما هي.</p>
      <button className="primary wide-btn" onClick={() => { act(ctx => applyStyle(ctx, q => { q.sections![i] = { ...s, paragraphs: s.paragraphs.filter(x => x.text.trim()) }; if (q.outline?.[i]) q.outline[i].heading = s.heading; }, 'تعديل نص الجزء ' + (i + 1))); close(); }}>حفظ ✓</button>
    </Sheet>
  );
}

/* ─────────── Chat ─────────── */

function md(text: string) {
  const lines = text.split('\n');
  return lines.map((l, i) => {
    const bullet = /^\s*[-•]\s+/.test(l);
    const parts = l.replace(/^\s*[-•]\s+/, '').split(/(\*\*[^*]+\*\*)/g).map((x, k) => x.startsWith('**') ? <b key={k}>{x.slice(2, -2)}</b> : x);
    return bullet ? <li key={i}>{parts}</li> : l.trim() ? <p key={i}>{parts}</p> : <br key={i} />;
  });
}

function Typewriter({ text, animate: initial }: { text: string; animate: boolean }) {
  const [animate] = useState(initial);
  const [n, setN] = useState(initial ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setN(text.length); return; }
    const step = Math.max(2, Math.ceil(text.length / 70));
    const t = setInterval(() => setN(x => { if (x >= text.length) { clearInterval(t); return x; } return x + step; }), 16);
    return () => clearInterval(t);
  }, [text, animate]);
  return <>{md(text.slice(0, n))}{n < text.length && <span className="caret" />}</>;
}

function Chat({ p }: { p: V6Project }) {
  const end = useRef<HTMLDivElement>(null);
  const [seen] = useState(() => new Set(p.messages.map(m => m.id)));
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); const t = setTimeout(() => p.messages.forEach(m => seen.add(m.id)), 1500); return () => clearTimeout(t); }, [p.messages.length, p.progress]);
  const visible = p.messages;
  return (
    <div className="chat">
      {visible.map(m => {
        const fresh = !seen.has(m.id);
        return <div key={m.id} className={`msg ${m.role} ${m.tone || ''}`}>{m.role === 'assistant' && <span className="avatar">M</span>}<div className="bubble">{m.attachments?.length ? <div className="att-line">{m.attachments.map(a => <span key={a}>📎 {a}</span>)}</div> : null}<Typewriter text={m.content} animate={fresh && m.role === 'assistant'} />{m.files?.length ? <FileButtons p={p} files={m.files} /> : null}</div></div>;
      })}
      {p.status === 'working' && p.progress && <div className="msg assistant thinking"><span className="avatar">M</span><div className="bubble"><span className="dots"><i /><i /><i /></span>{p.progress}</div></div>}
      <div ref={end} />
    </div>
  );
}

function FileButtons({ p, files }: { p: V6Project; files: string[] }) {
  const [work, setWork] = useState('');
  return (
    <div className="file-btns">
      {files.map(f => f.startsWith('pick_image:')
        ? <button key={f} onClick={() => window.dispatchEvent(new CustomEvent('mia-pick-image', { detail: Number(f.split(':')[1]) }))}>🖼️ اختار الصورة ({Number(f.split(':')[1]) + 1})</button>
        : <button key={f} disabled={!!work} onClick={async () => { try { toast(await exportFile(p, f, setWork)); } catch (e) { alert((e as Error).message); } setWork(''); }}>{FILE_LABELS[f] || f} ⬇</button>)}
      {work && <small>{work}</small>}
    </div>
  );
}

/* ─────────── Composer ─────────── */

function Composer({ busy, deck, selected, clear, submit }: { busy: boolean; deck: boolean; selected: number | null; clear: () => void; submit: (t: string, att: ReadResult[]) => void }) {
  const [text, setText] = useState('');
  const [att, setAtt] = useState<(ReadResult & { busy?: string; key: string })[]>([]);
  const reading = att.some(a => a.busy);
  const attach = async (list: FileList | null) => {
    for (const f of [...(list || [])].slice(0, 4)) {
      const key = uid();
      setAtt(a => [...a, { key, name: f.name, text: '', warnings: [], busy: 'بقرا…' }]);
      try {
        const r = await readFile(f, msg => setAtt(a => a.map(x => x.key === key ? { ...x, busy: msg } : x)));
        setAtt(a => a.map(x => x.key === key ? { ...r, key } : x));
      } catch (e) {
        setAtt(a => a.filter(x => x.key !== key));
        alert('مقدرتش أقرا ' + f.name + ': ' + (e as Error).message);
      }
    }
  };
  const ta = useRef<HTMLTextAreaElement>(null);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  useLayoutEffect(() => {
    const el = ta.current!;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 168) + 'px';
  }, [text]);
  useEffect(() => { if (selected !== null && !touch) ta.current?.focus(); }, [selected, touch]);
  const go = () => {
    const t = text.trim() || (att.length ? (att.some(a => a.image) ? 'بص على الصورة دي' : 'استخدم الملف ده') : '');
    if (!t || busy || reading) return;
    submit(t, att.map(({ busy: _b, key: _k, ...r }) => r)); setText(''); setAtt([]);
  };
  const suggestions = deck ? ['خلّي الألوان أغمق', 'زوّد صور حقيقية', 'الشريحة دي زحمة', 'ضيف شريحة أسئلة في الآخر'] : ['زوّد أمثلة إكلينيكية', 'خلّي الأسلوب أبسط', 'زوّد مراجع أحدث', 'ضيف جزء عن العلاج'];
  return (
    <div className="composer">
      {selected !== null && <div className="target">✏️ هتعدّل: {deck ? 'الشريحة' : 'الجزء'} {selected + 1}<button onClick={clear}>×</button></div>}
      {!text && !busy && <div className="sugg">{suggestions.map(s => <button key={s} onClick={() => { setText(s); ta.current?.focus(); }}>{s}</button>)}</div>}
      {att.length > 0 && <div className="att-row">{att.map(a => (
        <span key={a.key} className="att-chip">{a.image ? <img src={a.image} alt="" /> : <b>📄</b>}<span className="att-name">{a.name}{a.busy && <small> {a.busy}</small>}</span><button onClick={() => setAtt(x => x.filter(y => y.key !== a.key))} aria-label="إزالة">×</button></span>
      ))}</div>}
      <div className="input-row">
        <label className="clip" aria-label="إرفاق ملف أو صورة">📎<input type="file" multiple accept="image/*,.pdf,.docx,.pptx,.txt,.md" onChange={e => { attach(e.target.files); e.target.value = ''; }} /></label>
        <textarea ref={ta} rows={1} value={text} dir="auto" placeholder={busy ? 'استنى ثواني، بخلّص الشغل…' : 'اكتب تعديل، أو ابعت ملف أو سكرين شوت 📎'}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }} />
        <button className="send" disabled={(!text.trim() && !att.length) || busy || reading} onClick={go} aria-label="إرسال">↑</button>
      </div>
      {!touch && <div className="kbd-hint">Enter للإرسال · Shift + Enter لسطر جديد</div>}
    </div>
  );
}
