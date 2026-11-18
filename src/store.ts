import { openDB } from 'idb';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Project } from '../shared/model';

let ns = 'local';
const dbs = new Map<string, ReturnType<typeof openDB>>();
export let cloud: SupabaseClient | null = null;

function db() {
  const key = 'mia-homework-' + ns;
  let d = dbs.get(key);
  if (!d) {
    d = openDB(key, 1, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('files');
      },
    });
    dbs.set(key, d);
  }
  return d;
}

export function configCloud(url: string, key: string) {
  if (url && key) cloud = createClient(url, key);
}

export function account(id: string | null) {
  ns = id || 'local';
}

export async function headers(): Promise<Record<string, string>> {
  const s = await cloud?.auth.getSession();
  return s?.data.session
    ? { Authorization: 'Bearer ' + s.data.session.access_token }
    : {};
}

export async function save(p: Project) {
  const owner = ns,
    d = await db();
  await d.put('projects', p);
  if (cloud && owner !== 'local') {
    const s = await cloud.auth.getSession();
    if (s.data.session?.user.id !== owner) return;
    const { error } = await cloud.from('mia_projects').upsert({
      id: p.id,
      user_id: owner,
      title: p.title,
      tool: p.tool,
      payload: p,
      updated_at: p.updatedAt,
    });
    if (error)
      throw new Error('Saved locally; cloud sync failed: ' + error.message);
  }
}

export async function list(): Promise<Project[]> {
  const d = await db(),
    local: Project[] = await d.getAll('projects');
  if (cloud && ns !== 'local') {
    const { data, error } = await cloud.from('mia_projects').select('payload');
    if (error) throw new Error('Cloud projects could not load.');
    const m = new Map(local.map((p) => [p.id, p]));
    for (const row of data) {
      const p = row.payload as Project;
      if (!m.has(p.id) || m.get(p.id)!.updatedAt < p.updatedAt) {
        m.set(p.id, p);
        await d.put('projects', p);
      }
    }
    return [...m.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }
  return local.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function remove(id: string) {
  const d = await db();
  await d.delete('projects', id);
  for (const key of await d.getAllKeys('files'))
    if (String(key).startsWith(id + ':')) await d.delete('files', key);
  if (cloud && ns !== 'local') {
    const r = await cloud.from('mia_projects').delete().eq('id', id);
    if (r.error)
      throw new Error('Local deletion complete; cloud deletion failed.');
  }
}

export async function filePut(project: string, id: string, f: File) {
  await (await db()).put('files', f, project + ':' + id);
}

export async function fileRemove(project: string, id: string) {
  await (await db()).delete('files', project + ':' + id);
}

export async function api(path: string, body: any, signal?: AbortSignal) {
  const r = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await headers()) },
    body: JSON.stringify(body),
    signal,
  });
  const j = await r
    .json()
    .catch(() => ({ message: 'Unreadable server response.' }));
  if (!r.ok) {
    const arabic = typeof localStorage !== 'undefined' && localStorage.getItem('mia-lang') !== 'en';
    const messages: Record<string,string> = {
      INVALID_REQUEST:'تعذّر إرسال الطلب بصيغته الحالية للنموذج. المحادثة محفوظة.',
      FREE_CONTEXT_LIMIT:'حجم الرسائل أو المرفقات أكبر من سعة النموذج المتاح. اختار الصفحات المتعلقة بالمطلوب.',
      INVALID_CITATIONS:'تعذر تصحيح بعض المراجع بعد المحاولة التلقائية. اضغط حاول تاني لاستكمال الدفعة المتوقفة؛ الدفعات الناجحة محفوظة.',
      INVALID_OUTPUT:'النتيجة رجعت بصيغة غير مكتملة. اضغط حاول تاني لاستكمال الدفعة المتوقفة.',
      CAPACITY_LIMIT:'خدمة الذكاء الاصطناعي مشغولة مؤقتًا. الدفعات الناجحة محفوظة؛ أعد المحاولة بعد قليل.',
      PAID_BUDGET:'وصلنا لحد الإنفاق المضبوط. يلزم رفع الحد من إعدادات الخادم لاستكمال التنفيذ.',
      NO_COMPATIBLE_PROVIDER:'مزود الذكاء الاصطناعي مشغول دلوقتي. شغلك محفوظ؛ اضغط حاول تاني بعد لحظة.',
      PROVIDER_UNAVAILABLE:'خدمة الذكاء الاصطناعي مش متاحة لحظياً. شغلك محفوظ؛ جرّب تاني.',
      MODEL_UNAVAILABLE:'الموديل المضبوط مش متاح. راجع اسم الموديل في إعدادات السيرفر.',
      PROVIDER_CREDIT:'رصيد مفتاح OpenRouter خلص أو وصل لحد الصرف. اشحن الرصيد أو ارفع الحد.',
      KEY_REJECTED:'مفتاح الذكاء الاصطناعي اترفض. راجع المفتاح في إعدادات السيرفر.',
      MODEL_OVER_BUDGET:'النماذج المتاحة لا تناسب حد التكلفة المضبوط للطلب. الشغل محفوظ؛ جرّب تقسيم الطلب.',
      BUDGET_EXHAUSTED:'المهمة دي أكبر من حد الصرف للعملية الواحدة. صغّر الطلب أو ارفع PAID_MAX_OPERATION_USD.',
      PAID_DISABLED:'المفتاح المدفوع مش مفعّل على السيرفر. فعّل OPENROUTER_ENABLED و PAID_LEDGER_OPTIONAL.',
    };
    throw new Error(arabic && messages[j.error] ? messages[j.error] : j.message || 'Request failed.');
  }
  return j;
}

export function aiBody(
  p: Project,
  operation: string,
  action = '',
  toolOverride?: Project['tool'],
  section: any = null,
  slide: any = null
) {
  const deckSummary =
    operation === 'chat' && p.deck?.slides?.length
      ? p.deck.slides
          .map((s, i) => `${i + 1}. [${s.layout}] ${s.title}: ${s.points.join(' | ')}`)
          .join('\n')
          .slice(0, 6000)
      : undefined;
  return {
    operation,
    messages: operation === 'chat' ? (p.messages || []).slice(-18).map(m => ({role: m.role, content: m.content.slice(0, 1500)})) : undefined,
    uiLanguage: (typeof localStorage !== 'undefined' && localStorage.getItem('mia-lang')) || 'ar',
    tool: toolOverride || p.tool,
    instructions:
      p.instructions +
      '\n' +
      p.attachments
        .filter((a) => a.role === 'instructions')
        .map((a) => a.text)
        .join('\n'),
    support: p.attachments
      .filter((a) => a.role === 'support')
      .map((a) => a.text)
      .join('\n'),
    brief: p.brief,
    settings: p.settings,
    mirror: p.mirror,
    revision: p.revision || 0,
    sourceIds: p.selected,
    section,
    slide,
    researchDoc: ['chat', 'deck', 'outline'].includes(operation) && p.doc ? p.doc : null,
    ...(deckSummary ? { deckSummary } : {}),
    action,
    searches: p.searches,
  };
}

export async function ai(
  p: Project,
  operation: string,
  signal: AbortSignal,
  section: any = null,
  slide: any = null,
  action = '',
  toolOverride?: Project['tool']
) {
  return api('ai', aiBody(p, operation, action, toolOverride, section, slide), signal);
}
