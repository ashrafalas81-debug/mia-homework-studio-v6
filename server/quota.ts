/**
 * Daily limits per student and per kind of job. Durable when D1 or Supabase is
 * configured; otherwise an in-memory counter (good for local tests only).
 */
import { createClient } from '@supabase/supabase-js';
import { AIError, type Env } from './ai';

export type QuotaKind = 'research' | 'deck' | 'edit';
const DEFAULTS: Record<QuotaKind, number> = { research: 5, deck: 5, edit: 60 };
const NAMES: Record<QuotaKind, string> = { research: 'أبحاث', deck: 'عروض', edit: 'تعديلات' };
const memory = new Map<string, number>();

export function quotaLimit(env: Env, kind: QuotaKind) {
  const raw = (env as any)[`DAILY_${kind.toUpperCase()}_LIMIT`];
  const n = raw === undefined || raw === '' ? DEFAULTS[kind] : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULTS[kind];
}

const today = () => new Date().toISOString().slice(0, 10);

/** Consumes one unit. Limit 0 = unlimited. Throws a clear Arabic message when the limit is reached. */
export async function takeQuota(env: Env, actor: string, kind: QuotaKind) {
  const limit = quotaLimit(env, kind);
  if (limit === 0) return { used: 0, limit: 0 };
  const key = `${kind}:${actor}:${today()}`;
  let used: number | null = null;
  if (env.DB) {
    try {
      const r: any = await env.DB.prepare(`INSERT INTO mia_ai_quota (actor_day, requests) VALUES (?, 1)
        ON CONFLICT(actor_day) DO UPDATE SET requests = requests + 1 WHERE requests < ?
        RETURNING requests`).bind(key, limit).first();
      used = r ? Number(r.requests) : null;
    } catch { throw new AIError('QUOTA_UNAVAILABLE', 'مقدرناش نتأكد من الحد اليومي دلوقتي. جرّب تاني بعد شوية.', 503); }
  } else if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && /^[0-9a-f-]{36}$/i.test(actor)) {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const r = await db.rpc('mia_take_kind_quota', { user_uuid: actor, kind, daily_limit: limit });
    if (r.error) throw new AIError('QUOTA_UNAVAILABLE', 'مقدرناش نتأكد من الحد اليومي دلوقتي. جرّب تاني بعد شوية.', 503);
    used = typeof r.data === 'number' ? r.data : null;
  } else {
    const n = memory.get(key) || 0;
    if (n < limit) memory.set(key, n + 1);
    used = n < limit ? n + 1 : null;
  }
  if (used === null) throw new AIError('QUOTA_REACHED', `خلصت الحد اليومي (${limit} ${NAMES[kind]} في اليوم). الحد بيتجدد بكرة الساعة 2 الصبح بتوقيت مصر.`, 429);
  return { used, limit };
}

export async function readQuota(env: Env, actor: string) {
  const out: Record<string, { used: number | null; limit: number }> = {};
  for (const kind of ['research', 'deck', 'edit'] as QuotaKind[]) {
    const key = `${kind}:${actor}:${today()}`;
    let used: number | null = null;
    if (env.DB) { try { const r: any = await env.DB.prepare('SELECT requests FROM mia_ai_quota WHERE actor_day = ?').bind(key).first(); used = r ? Number(r.requests) : 0; } catch { used = null; } }
    else if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)) used = memory.get(key) || 0;
    out[kind] = { used, limit: quotaLimit(env, kind) };
  }
  return out;
}

export const actorOf = (c: any) => c.get('userId') || c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
