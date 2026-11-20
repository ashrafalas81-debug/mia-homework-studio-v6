/**
 * Offline mock AI, enabled only with MIA_MOCK_AI=true. Used for automated
 * end-to-end UI tests without spending money. Never enabled in production.
 */
import type { Source } from '../shared/model';

export function mockSources(n: number): Source[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => ({
    id: 'pmid:' + (40000000 + i),
    title: `Mock study ${i + 1} on rotator cuff tendinopathy rehabilitation outcomes`,
    authors: ['Smith J', 'Ali M', 'Chen L'],
    year: String(2020 + (i % 5)),
    journal: 'Journal of Mock Physiotherapy',
    pmid: String(40000000 + i), doi: '10.0000/mock.' + i,
    url: 'https://pubmed.ncbi.nlm.nih.gov/' + (40000000 + i) + '/',
    abstract: 'Background: mock abstract. Results: exercise therapy improved pain by 30% at 12 weeks compared with control.',
    accessLevel: 'abstract', publicationTypes: ['Randomized Controlled Trial'], retracted: false, concerns: [],
    retrievedAt: new Date().toISOString(), volume: '12', issue: '3', pages: '100-110',
  }));
}

const lorem = (n: number) => Array.from({ length: n }, (_, i) => ['Rotator', 'cuff', 'tendons', 'stabilise', 'the', 'glenohumeral', 'joint', 'during', 'elevation', 'and', 'progressive', 'loading', 'restores', 'capacity'][i % 14]).join(' ') + '.';

export function mockAI(_schema: unknown, system: string, user: string): any {
  const u = JSON.parse(user);
  if (/Plan an academic/.test(system)) {
    const lab = /LAB REPORT/.test(system);
    const heads = lab ? ['Aim', 'Introduction', 'Materials and Methods', 'Procedure', 'Results', 'Discussion', 'Conclusion'] : ['Introduction', 'Functional Anatomy', 'Pathophysiology', 'Clinical Assessment', 'Evidence-Based Management', 'Conclusion'];
    return { title: 'Rotator Cuff Tendinopathy: Mechanisms, Assessment and Evidence-Based Rehabilitation', sections: heads.map(h => ({ heading: h, focus: 'Cover ' + h, words: 300 })), queries: ['rotator cuff tendinopathy exercise', 'shoulder impingement diagnosis'] };
  }
  if (/ONE section|REVISE the supplied section/.test(system)) {
    const w = u.thisSection.words as number;
    const paras = Math.max(1, Math.round(w / 130));
    const ids = (u.SOURCES || []).map((s: any) => s.id);
    return {
      id: 's1', heading: u.thisSection.heading,
      paragraphs: Array.from({ length: paras }, (_, i) => ({ text: (u.instruction ? '[revised] ' : '') + lorem(Math.round(w / paras)), sourceIds: ids.length ? [ids[i % ids.length], ids[(i + 1) % ids.length]] : [] })),
      keyPoint: /Conclusion|Aim|Abstract/.test(u.thisSection.heading) ? '' : 'Progressive loading, not rest, restores tendon capacity and reduces pain.',
      tables: /Assessment/.test(u.thisSection.heading) ? [{ title: 'Diagnostic accuracy of common tests', headers: ['Test', 'Sensitivity', 'Specificity'], rows: [['Painful arc', '0.53', '0.76'], ['Drop arm', '0.27', '0.88'], ['Belly press', '0.40', '0.98']], sourceIds: ids.slice(0, 1) }] : [], diagram: /Pathophysiology/.test(u.thisSection.heading) ? { kind: 'flow', title: 'Tendinopathy continuum', nodes: ['Overload', 'Reactive', 'Disrepair', 'Degenerative'] } : null,
    };
  }
  if (/route a student's chat message/.test(system)) {
    const m: string = u.MESSAGE;
    const num = Number((m.match(/\d+/) || [])[0]);
    if (/حط صورة|غير الصورة|اختار الصورة/.test(m) && !u.HAS_IMAGE) return { action: 'pick_image', targets: [num || 1], files: [], instruction: '', reply: 'اختار الصورة اللي تعجبك.' };
    if (/لون|أحمر|احمر|إطار|اطار/.test(m)) return { action: 'restyle', targets: [], files: [], instruction: m, reply: 'هغيّر الشكل.' };
    if (/الكفر|الغلاف|الكافر/.test(m)) return { action: 'cover', targets: [], files: [], instruction: m, reply: 'هعدّل الغلاف.' };
    if (/ابعت|فين الملف|نزّله|نزله|عاوز الملف/.test(m)) return { action: 'send_files', targets: [], files: u.AVAILABLE_FILES, instruction: '', reply: 'الملفات تحت، دوس على الزرار.' };
    if (u.HAS_IMAGE && /ضيف/.test(m)) return { action: 'revise', targets: [num || 2], files: [], instruction: 'Use the uploaded image', reply: 'هحط الصورة في الشريحة.' };
    if (u.HAS_IMAGE) return { action: 'answer', targets: [], files: [], instruction: '', reply: 'شايف السكرين شوت: فيها شريحة عنوانها كبير.' };
    if (/ليه|معلق|واقف|بطيء/.test(m)) return { action: 'answer', targets: [], instruction: '', reply: u.STATE?.lastError ? `وقفت عند ${u.STATE.done} من ${u.STATE.total} بسبب: ${u.STATE.lastError}. اكتب كمّل.` : `خلصت ${u.STATE?.done ?? 0} من ${u.STATE?.total ?? 0}.` };
    if (/ترقيم|روماني|دبل|سطور|فانكوفر|Vancouver|الفهرس|حواشي/i.test(m)) return { action: 'restyle', targets: [], instruction: m, reply: 'تمام، هظبط التنسيق.' };
    if (/احذف|امسح|شيل/.test(m)) return { action: 'remove', targets: num ? [num] : [], instruction: 'remove', reply: 'تمام، هشيلها.' };
    if (/زود|ضيف|أضف/.test(m) && /سلايد|شريحة|جزء|قسم/.test(m)) return { action: 'add', targets: [u.ITEMS.length], instruction: m, reply: 'تمام، هضيف جزء جديد في الآخر.' };
    if (u.ITEMS.length && /كبّر العناوين|كبر العناوين|أغمق|غيّر الخط/.test(m) && !num) return { action: 'restyle', targets: [], instruction: m, reply: 'تمام، هغيّر التنسيق.' };
    if (/\?|؟/.test(m)) return { action: 'answer', targets: [], instruction: '', reply: 'ده سؤال حلو — الإجابة باختصار: آه ينفع.' };
    return { action: 'revise', targets: num ? [num] : [u.SELECTED || 1], instruction: m, reply: `تمام، هعدّل رقم ${num || u.SELECTED || 1} زي ما طلبت.` };
  }
  if (/Plan a \d+-slide presentation/.test(system)) {
    const n = Number(system.match(/Plan a (\d+)-slide/)![1]);
    const order = ['cover', 'agenda', 'cards', 'steps', 'stat', 'comparison', 'chart', 'cycle', 'timeline', 'table', 'image_points', 'stats', 'quote', 'hierarchy', 'checklist', 'closing'];
    const premium = /custom=true ONLY/.test(system);
    return {
      title: 'Rotator Cuff Tendinopathy', subtitle: 'From mechanism to rehabilitation',
      slides: Array.from({ length: n }, (_, i) => ({ title: i ? 'Key idea ' + i : 'Rotator Cuff Tendinopathy', layout: i === n - 1 ? 'closing' : order[i % (order.length - 1)], keyMessage: 'Load management drives recovery.', content: lorem(30), custom: premium && i === 3 })),
    };
  }
  if (/on-slide content|REVISE the CURRENT slide content/.test(system)) {
    const I = (icon: string, title: string, text: string, value = '') => ({ icon, title, text, value });
    return {
      slides: u.SLIDES.map((s: any, k: number) => ({
        layout: s.layout, title: (u.INSTRUCTION ? '[revised] ' : '') + s.title, subtitle: s.layout === 'cover' ? 'From mechanism to rehabilitation' : '',
        items: [I('activity', 'Supraspinatus', 'Initiates abduction and compresses the humeral head.', '68%'), I('refresh-cw', 'Infraspinatus', 'Main external rotator of the shoulder.', '42%'), I('shield-check', 'Teres minor', 'Posterior stability during elevation.', '30%'), I('hand', 'Subscapularis', 'Internal rotation and anterior stability.', '18%')],
        left: { title: 'Tendinopathy', items: ['Gradual onset', 'Painful arc', 'Strength preserved'] }, right: { title: 'Tear', items: ['Traumatic onset', 'Weakness', 'Night pain'] },
        headers: ['Test', 'Sensitivity', 'Specificity'], rows: [['Painful arc', '0.53', '0.76'], ['Drop arm', '0.27', '0.88']],
        value: '68%', label: s.layout === 'cover' ? 'Physiotherapy · Shoulder' : 'Loading programmes outperform rest.', quote: 'Tendons need load to heal.', author: 'J. Cook',
        imageQuery: ['cover', 'image_points', 'image_full'].includes(s.layout) ? 'rotator cuff' : '', source: k % 3 === 0 ? 'Source: Smith 2023' : '', notes: 'Speaker notes for ' + s.title,
      })),
    };
  }
  if (/careful CSS designer/.test(system)) {
    const doc = /research PDF/.test(system);
    return { css: doc ? '.mp .hdr{color:#C1121F;border-bottom:2px solid #C1121F}.mp .sh h2{color:#C1121F}' : '.t h2{color:#C1121F}', changes: ['لون الهيدر والعناوين أحمر'], unsupported: '' };
  }
  if (/request about the COVER/.test(system)) {
    const r = u.REQUEST as string;
    const name = (r.match(/اسمي ([^،,]+)/) || [])[1] || '';
    return { title: '', subtitle: '', student: name.trim(), university: '', faculty: '', course: '', professor: '', date: '', nameSize: /كبر|كبّر/.test(r) ? 'large' : '', titleSize: '', unsupported: /لوجو|logo/i.test(r) ? 'إضافة لوجو' : '' };
  }
  if (/Map the student's formatting request/.test(system)) {
    const r = u.REQUEST as string;
    return { numbering: /روماني|roman/i.test(r) ? 'roman' : /1، 2|ارقام عادية|1, 2/.test(r) ? 'decimal' : '', lineSpacing: /دبل|double|2/.test(r) ? '2' : /1\.5|ونص/.test(r) ? '1.5' : '', margins: '', pageNumber: /النص|center|المنتصف/.test(r) ? 'center' : '', toc: /شيل الفهرس/.test(r) ? 'off' : '', abstract: '', header: '', citationStyle: /vancouver|فانكوفر/i.test(r) ? 'Vancouver' : '', size: '', theme: '', unsupported: /حواشي|footnote/i.test(r) ? 'الحواشي السفلية' : '', reply: 'تمام، غيّرت التنسيق.' };
  }
  if (/Map the student's visual request/.test(system)) {
    const cur = u.CURRENT || {};
    const bigger = /كبر|كبّر|bigger/.test(u.REQUEST);
    return { palette: /غامق|أغمق|dark/.test(u.REQUEST) ? 'navy' : '', fonts: '', titleScale: (cur.titleScale || 1) + (bigger ? 0.15 : 0), bodyScale: cur.bodyScale || 1, showNumbers: cur.showNumbers ?? true, reply: 'تمام، غيّرت التنسيق.' };
  }
  if (/elite presentation designer/.test(system)) {
    return {
      slides: u.SLIDES.map((s: any) => ({
        notes: 'Speaker notes for ' + s.title,
        html: s.kind === 'cover'
          ? `<style>.s${s.number}{background:linear-gradient(135deg,var(--bg),color-mix(in srgb,var(--accent2) 30%,var(--bg)));display:flex;flex-direction:column;justify-content:center;padding:80px}.s${s.number} h1{font:800 76px var(--hfont);margin:0;color:var(--text)}.s${s.number} p{font:400 28px var(--bfont);color:var(--accent);margin-top:18px}.s${s.number} .brand{position:absolute;bottom:48px;font:600 18px var(--bfont);color:var(--muted)}</style><section class="slide s${s.number}"><h1>${s.title}</h1><p>${u.INSTRUCTION ? 'Revised: ' : ''}From mechanism to rehabilitation</p><div class="brand">Medical Intelligence Academy</div></section>`
          : `<style>.s${s.number}{padding:64px;background:var(--bg)}.s${s.number} h2{font:700 46px var(--hfont);margin:0 0 36px;color:var(--text)}.s${s.number} .g{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}.s${s.number} .c{background:var(--surface);border-radius:20px;padding:28px;height:360px;color:var(--text);font:400 22px/1.4 var(--bfont)}.s${s.number} .c b{display:block;color:var(--accent);font:800 48px var(--hfont);margin-bottom:12px}.s${s.number} .n{position:absolute;right:48px;bottom:32px;color:var(--muted);font:600 16px var(--bfont)}</style><section class="slide s${s.number}"><h2>${s.title}</h2><div class="g">${[1, 2, 3].map(k => `<div class="c"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent2)"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg><b>0${k}</b>${s.keyMessage}</div>`).join('')}</div><div class="n">${s.number}</div></section>`,
      })),
    };
  }
  throw new Error('Mock: unknown operation');
}
