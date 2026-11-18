import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { SLIDE_LAYOUTS } from '../shared/model';

export interface BudgetDatabase {
  prepare(sql: string): { bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null> } };
}
export type Env = Partial<Record<
  'GROQ_API_KEY' | 'GROQ_MODEL' | 'GROQ_FALLBACK_MODEL' |
  'OPENROUTER_API_KEY' | 'OPENROUTER_ENABLED' | 'OPENROUTER_MODEL' | 'VISION_MODEL' |
  'PAID_GLOBAL_CAP_USD' | 'PAID_MAX_OPERATION_USD' | 'OWNER_PAID_ENABLED' |
  'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY' |
  'ALLOW_LOCAL_MODE' | 'APP_ORIGIN' | 'NCBI_API_KEY' | 'REQUESTS_PER_HOUR' |
  'AI_REQUESTS_PER_DAY' | 'SITES_AUTH_ENABLED' | 'OPENROUTER_BACKUP_MODELS' | 'OPENROUTER_FAST_MODEL' | 'OPENROUTER_DESIGN_MODEL' | 'MIA_MOCK_AI' | 'DAILY_RESEARCH_LIMIT' | 'DAILY_DECK_LIMIT' | 'DAILY_EDIT_LIMIT' | 'PAID_LEDGER_OPTIONAL', string>> & { DB?: BudgetDatabase };

export class AIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter = 0
  ) {
    super(message);
  }
}

export interface AIProvider {
  generate(
    system: string,
    user: string,
    tokens: number,
    signal?: AbortSignal
  ): Promise<any>;
  generateStructured<T>(
    schema: z.ZodType<T>,
    system: string,
    user: string,
    tokens: number,
    signal?: AbortSignal
  ): Promise<{ data: T; usage: any; model: string; provider: string }>;
  getCapabilities(): Promise<{
    structured: boolean;
    vision: boolean;
    pricing: { prompt: number; completion: number } | null;
  }>;
  estimateCost(input: string, tokens: number): Promise<number | null>;
}

/** Writer: strong + cheap long-form model. Fast: conversational/Arabic + vision. Both overridable by env. */
export const DEFAULT_WRITER_MODEL = 'deepseek/deepseek-v4.1-flash';
export const DEFAULT_FAST_MODEL = 'google/gemini-3.6-flash';

type CapabilityRecord = {
  structured: boolean;
  vision: boolean;
  pricing: { prompt: number; completion: number } | null;
  supportsReasoning: boolean;
};

const endpointCapabilitiesCache = new Map<string, { at: number; value: CapabilityRecord }>();
const CAPABILITY_TTL_MS = 6 * 60 * 60 * 1000;

function extractJsonPayload(rawText: string): string {
  let cleaned = rawText.trim();
  // Strip any <think>...</think> blocks emitted by reasoning models
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function normalizeTableShape(t: any) {
  if (!t || typeof t !== 'object') return null;
  const headers = Array.isArray(t.headers) ? t.headers.map((h: any) => String(h ?? '')) : [];
  const rows = Array.isArray(t.rows)
    ? t.rows.filter(Array.isArray).map((r: any[]) => r.map((c: any) => String(c ?? '')))
    : [];
  if (!headers.length && !rows.length) return null;
  return {
    title: typeof t.title === 'string' && t.title.trim() ? t.title.trim() : 'Comparison Table',
    headers: headers.length ? headers : ['Item', 'Details'],
    rows,
    sourceIds: Array.isArray(t.sourceIds) ? t.sourceIds.map(String) : [],
  };
}

function normalizeDiagramShape(d: any) {
  if (!d || typeof d !== 'object') return null;
  const kind = ['flow', 'cycle', 'hierarchy'].includes(d.kind) ? d.kind : 'flow';
  const nodes = Array.isArray(d.nodes) ? d.nodes.map((n: any) => String(n ?? '').trim()).filter(Boolean) : [];
  if (nodes.length < 2) return null;
  return {
    kind,
    title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Clinical Pathway',
    nodes: nodes.slice(0, 8),
  };
}

function normalizeSectionShape(s: any) {
  if (!s || typeof s !== 'object' || typeof s.heading !== 'string') return s;
  const rawParas = Array.isArray(s.paragraphs) ? s.paragraphs : [];
  const paragraphs = rawParas
    .map((p: any) => {
      if (typeof p === 'string') return { text: p, sourceIds: [] };
      if (!p || typeof p !== 'object') return null;
      return {
        text: typeof p.text === 'string' ? p.text : String(p.content ?? ''),
        sourceIds: Array.isArray(p.sourceIds) ? p.sourceIds.map(String) : [],
      };
    })
    .filter((p: any): p is { text: string; sourceIds: string[] } => !!p && p.text.trim().length > 0);
  const tables = Array.isArray(s.tables)
    ? s.tables.map(normalizeTableShape).filter((t: any): t is NonNullable<typeof t> => !!t)
    : [];
  return {
    id: typeof s.id === 'string' && s.id.trim() ? s.id : crypto.randomUUID(),
    heading: s.heading.trim() || 'Section',
    paragraphs: paragraphs.length ? paragraphs : [{ text: s.heading.trim() || 'Content', sourceIds: [] }],
    tables,
    diagram: normalizeDiagramShape(s.diagram),
  };
}

function normalizeSlideShape(s: any) {
  if (!s || typeof s !== 'object' || typeof s.title !== 'string') return s;
  const layout = (SLIDE_LAYOUTS as readonly string[]).includes(s.layout) ? s.layout : 'cards';
  const points = Array.isArray(s.points)
    ? s.points.map((p: any) => String(p ?? '').trim()).filter(Boolean)
    : Array.isArray(s.bullets)
    ? s.bullets.map((p: any) => String(p ?? '').trim()).filter(Boolean)
    : [];
  const stats = Array.isArray(s.stats)
    ? s.stats
        .filter((x: any) => x && (x.value !== undefined || x.label !== undefined))
        .map((x: any) => ({ value: String(x.value ?? ''), label: String(x.label ?? '') }))
    : [];
  let chart = null;
  if (s.chart && typeof s.chart === 'object' && Array.isArray(s.chart.labels) && Array.isArray(s.chart.values)) {
    const kind = ['bar', 'pie', 'line'].includes(s.chart.kind) ? s.chart.kind : 'bar';
    const values = s.chart.values.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v));
    if (values.length >= 2 && s.chart.labels.length >= values.length) {
      chart = {
        kind,
        title: typeof s.chart.title === 'string' ? s.chart.title : s.title,
        labels: s.chart.labels.slice(0, values.length).map(String),
        values,
        unit: typeof s.chart.unit === 'string' ? s.chart.unit : '',
      };
    }
  }
  return {
    id: typeof s.id === 'string' && s.id.trim() ? s.id : crypto.randomUUID(),
    title: s.title.trim() || 'Slide',
    type: typeof s.type === 'string' && s.type.trim() ? s.type : 'concept',
    layout,
    subtitle: typeof s.subtitle === 'string' ? s.subtitle : null,
    points,
    table: normalizeTableShape(s.table),
    stats,
    chart,
    imageQuery: typeof s.imageQuery === 'string' && s.imageQuery.trim() ? s.imageQuery.trim() : null,
    sourceIds: Array.isArray(s.sourceIds) ? s.sourceIds.map(String) : [],
    speakerNotes: typeof s.speakerNotes === 'string' ? s.speakerNotes : '',
  };
}

/**
 * Coerces minor LLM schema omissions (such as omitted nullable/array defaults or extra keys)
 * only when the object has recognizable core domain properties.
 */
export function coerceDomainObject(raw: any): any {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;

  // 1. DialogueTurn shape (must have reply, question, ready)
  if (typeof raw.reply === 'string' && typeof raw.question === 'string' && typeof raw.ready === 'boolean') {
    const validQ = ['topic', 'requirements', 'student', 'language', 'count', 'pages', 'none'].includes(raw.question)
      ? raw.question
      : 'none';
    const validDeliv = Array.isArray(raw.deliverables)
      ? raw.deliverables.filter((d: any) => ['assignment', 'research', 'present', 'filemaker'].includes(d))
      : [];
    const st = raw.student && typeof raw.student === 'object'
      ? {
          name: typeof raw.student.name === 'string' ? raw.student.name.slice(0, 120) : null,
          university: typeof raw.student.university === 'string' ? raw.student.university.slice(0, 160) : null,
          faculty: typeof raw.student.faculty === 'string' ? raw.student.faculty.slice(0, 160) : null,
          department: typeof raw.student.department === 'string' ? raw.student.department.slice(0, 160) : null,
          course: typeof raw.student.course === 'string' ? raw.student.course.slice(0, 160) : null,
          professor: typeof raw.student.professor === 'string' ? raw.student.professor.slice(0, 160) : null,
          year: typeof raw.student.year === 'string' ? raw.student.year.slice(0, 60) : null,
        }
      : null;
    return {
      reply: raw.reply,
      question: validQ,
      ready: raw.ready,
      topic: typeof raw.topic === 'string' && raw.topic.trim().length >= 2 ? raw.topic.trim() : null,
      instructions: typeof raw.instructions === 'string' ? raw.instructions.slice(0, 12000) : '',
      deliverables: validDeliv.length ? validDeliv.slice(0, 4) : ['assignment'],
      student: st,
    };
  }

  // 2. VivaTurn shape (must have reply and done)
  if (typeof raw.reply === 'string' && typeof raw.done === 'boolean' && !('question' in raw)) {
    return {
      reply: raw.reply.slice(0, 2000),
      score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.min(10, Math.max(0, raw.score)) : null,
      done: raw.done,
    };
  }

  // 3. Single Section shape
  if (typeof raw.heading === 'string' && Array.isArray(raw.paragraphs) && !('sections' in raw)) {
    return normalizeSectionShape(raw);
  }

  // 4. Single Slide shape
  if (typeof raw.title === 'string' && (Array.isArray(raw.points) || typeof raw.layout === 'string') && !('slides' in raw) && !('sections' in raw) && !('taskType' in raw)) {
    return normalizeSlideShape(raw);
  }

  // 5. Doc shape
  if (typeof raw.title === 'string' && Array.isArray(raw.sections)) {
    const out: any = {
      title: raw.title,
      language: typeof raw.language === 'string' && raw.language.trim() ? raw.language : 'English',
      sections: raw.sections.map(normalizeSectionShape),
      limitations: Array.isArray(raw.limitations) ? raw.limitations.map(String) : [],
    };
    if ('comparisonTable' in raw && raw.comparisonTable) {
      const ct = normalizeTableShape(raw.comparisonTable);
      if (ct) out.comparisonTable = ct;
    }
    return out;
  }

  // 6. DeckOutline vs Deck shape
  if (Array.isArray(raw.slides)) {
    const isOutline = raw.slides.length > 0 && raw.slides.every((s: any) => s && typeof s.keyMessage === 'string' && !Array.isArray(s.points));
    if (isOutline) {
      return {
        title: typeof raw.title === 'string' ? raw.title : 'Presentation',
        subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
        slides: raw.slides.map((s: any) => ({
          title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'Slide',
          layout: (SLIDE_LAYOUTS as readonly string[]).includes(s.layout) ? s.layout : 'cards',
          keyMessage: typeof s.keyMessage === 'string' ? s.keyMessage : '',
        })),
      };
    }
    return {
      title: typeof raw.title === 'string' ? raw.title : 'Presentation',
      language: typeof raw.language === 'string' && raw.language.trim() ? raw.language : 'English',
      slides: raw.slides.map(normalizeSlideShape),
      terms: Array.isArray(raw.terms)
        ? raw.terms
            .filter((t: any) => t && typeof t.term === 'string')
            .map((t: any) => ({ term: t.term, explanation: String(t.explanation ?? '') }))
        : [],
      questions: Array.isArray(raw.questions)
        ? raw.questions
            .filter((q: any) => q && typeof q.question === 'string')
            .map((q: any) => ({
              question: q.question,
              answer: String(q.answer ?? ''),
              sourceIds: Array.isArray(q.sourceIds) ? q.sourceIds.map(String) : [],
            }))
        : [],
      script: typeof raw.script === 'string' ? raw.script : '',
      limitations: Array.isArray(raw.limitations) ? raw.limitations.map(String) : [],
    };
  }

  // 7. TaskBrief shape
  if (typeof raw.title === 'string' && ('taskType' in raw || 'requiredSections' in raw || 'professorIntent' in raw)) {
    const validTypes = [
      'short-answer', 'long-form', 'medical-report', 'comparison', 'case-study',
      'critical-discussion', 'pico', 'literature-review', 'research-proposal',
      'presentation', 'file-operation', 'lab-report',
    ];
    const taskType = validTypes.includes(raw.taskType) ? raw.taskType : 'long-form';
    return {
      title: raw.title,
      taskType,
      subject: typeof raw.subject === 'string' ? raw.subject : '',
      specialty: typeof raw.specialty === 'string' ? raw.specialty : '',
      objective: typeof raw.objective === 'string' ? raw.objective : '',
      professorIntent: typeof raw.professorIntent === 'string' ? raw.professorIntent : '',
      requirements: Array.isArray(raw.requirements)
        ? raw.requirements
            .filter((r: any) => r && (typeof r.text === 'string' || typeof r === 'string'))
            .map((r: any) =>
              typeof r === 'string'
                ? { text: r, origin: 'confirmed' as const }
                : {
                    text: String(r.text),
                    origin: ['confirmed', 'inferred', 'student'].includes(r.origin) ? r.origin : ('confirmed' as const),
                  }
            )
        : [],
      requiredSections: Array.isArray(raw.requiredSections) ? raw.requiredSections.map(String) : [],
      deliverable: typeof raw.deliverable === 'string' ? raw.deliverable : 'Academic Document',
      requestedCount: typeof raw.requestedCount === 'number' && Number.isFinite(raw.requestedCount) ? Math.round(raw.requestedCount) : null,
      countUnit: ['pages', 'slides'].includes(raw.countUnit) ? raw.countUnit : null,
      language: typeof raw.language === 'string' ? raw.language : null,
      academicLevel: typeof raw.academicLevel === 'string' ? raw.academicLevel : null,
      referencesRequired: typeof raw.referencesRequired === 'boolean' ? raw.referencesRequired : null,
      citationStyle: ['Vancouver', 'APA'].includes(raw.citationStyle) ? raw.citationStyle : null,
      formatting: Array.isArray(raw.formatting) ? raw.formatting.map(String) : [],
      deadline: typeof raw.deadline === 'string' ? raw.deadline : null,
      rubric: Array.isArray(raw.rubric) ? raw.rubric.map(String) : [],
      ambiguousInstructions: Array.isArray(raw.ambiguousInstructions) ? raw.ambiguousInstructions.map(String) : [],
      missingInformation: Array.isArray(raw.missingInformation) ? raw.missingInformation.map(String) : [],
      searchQuery: typeof raw.searchQuery === 'string' && raw.searchQuery.trim() ? raw.searchQuery.trim() : raw.title,
    };
  }

  return raw;
}

export class Provider implements AIProvider {
  private supportsReasoning = false;
  private capabilities: {
    structured: boolean;
    vision: boolean;
    pricing: { prompt: number; completion: number } | null;
  } | null = null;

  constructor(
    private name: 'groq' | 'openrouter',
    private env: Env,
    private request: typeof fetch = fetch,
    private overrideModel?: string,
    private imageData?: string,
    private effort: 'low' | 'medium' | 'high' = 'low',
    private reserveRetry?: (tokens: number) => Promise<void>
  ) {}

  get model() {
    if (this.overrideModel) return this.overrideModel;
    return this.name === 'groq'
      ? this.env.GROQ_MODEL || 'openai/gpt-oss-120b'
      : this.env.OPENROUTER_MODEL || DEFAULT_WRITER_MODEL;
  }

  async getCapabilities() {
    if (this.capabilities) return this.capabilities;
    if (this.name === 'groq') {
      return {
        structured: /^openai\/gpt-oss-/.test(this.model),
        vision: false,
        pricing: null,
      };
    }

    const isNativeFetch = this.request === globalThis.fetch && !(this.request as any)?.mock;
    if (isNativeFetch) {
      const cached = endpointCapabilitiesCache.get(this.model);
      if (cached && Date.now() - cached.at < CAPABILITY_TTL_MS) {
        this.supportsReasoning = cached.value.supportsReasoning;
        return (this.capabilities = {
          structured: cached.value.structured,
          vision: cached.value.vision,
          pricing: cached.value.pricing,
        });
      }
    }

    let r: Response;
    try {
      r = await this.request.call(
        globalThis,
        'https://openrouter.ai/api/v1/models/' + this.model.split('/').map(encodeURIComponent).join('/') + '/endpoints',
        { signal: AbortSignal.timeout(15000) }
      );
    } catch {
      if (isNativeFetch) {
        const stale = endpointCapabilitiesCache.get(this.model);
        if (stale) {
          this.supportsReasoning = stale.value.supportsReasoning;
          return (this.capabilities = {
            structured: stale.value.structured,
            vision: stale.value.vision,
            pricing: stale.value.pricing,
          });
        }
      }
      throw new AIError('PROVIDER_UNAVAILABLE', 'AI model information is temporarily unavailable.', 502);
    }
    if (!r.ok)
      throw new AIError(
        'MODEL_UNAVAILABLE',
        'Fallback capabilities could not be verified.',
        503
      );
    const m = ((await r.json()) as any).data;
    if (!m || m.id !== this.model)
      throw new AIError('MODEL_UNAVAILABLE', 'The configured AI model is unavailable.', 503);
    const available = (m.endpoints || []).filter((e: any) =>
      e.status === 0 && ['response_format', 'max_tokens', 'temperature'].every(p => (e.supported_parameters || []).includes(p)) &&
      e.pricing && [e.pricing.prompt, e.pricing.completion].every((p: unknown) => p !== null && p !== undefined && Number.isFinite(Number(p)) && Number(p) >= 0) &&
      Number(e.pricing.request || 0) === 0);
    const strict = available.filter((e: any) => e.supported_parameters.includes('structured_outputs'));
    const peak = (e: any, k: 'prompt' | 'completion') => Math.max(Number(e.pricing[k]), ...((e.pricing.overrides || []).map((o: any) => Number(o[k])).filter(Number.isFinite)));
    const peakSum = (e: any) => peak(e, 'prompt') + peak(e, 'completion');
    const pool = (strict.length ? strict : available).slice().sort((a: any, b: any) => peakSum(a) - peakSum(b)).slice(0, 8);
    if (!pool.length) throw new AIError('NO_COMPATIBLE_PROVIDER', 'No compatible AI provider is available for this model. Retry later.', 503);
    this.supportsReasoning = pool.every((e: any) => e.supported_parameters.includes('reasoning'));
    const resolved = {
      structured: strict.length > 0,
      vision: (m.architecture?.input_modalities || []).includes('image'),
      pricing: {
        prompt: Math.max(...pool.map((e: any) => peak(e, 'prompt'))),
        completion: Math.max(...pool.map((e: any) => peak(e, 'completion'))),
      },
    };
    if (isNativeFetch) {
      endpointCapabilitiesCache.set(this.model, {
        at: Date.now(),
        value: { ...resolved, supportsReasoning: this.supportsReasoning },
      });
    }
    return (this.capabilities = resolved);
  }

  async estimateCost(input: string, tokens: number) {
    const c = await this.getCapabilities();
    if (!c.pricing || !Number.isFinite(c.pricing.prompt + c.pricing.completion)) return null;
    const byteLen = new TextEncoder().encode(input).length;
    // Keep exact byte*2 accounting for short inputs (<512B), and realistic character-based token estimation for large Arabic/English payloads
    const estimatedInputTokens = byteLen <= 512 ? byteLen * 2 : Math.min(byteLen * 2, Math.max(512, Math.ceil(input.length / 2.8)));
    return estimatedInputTokens * c.pricing.prompt + tokens * c.pricing.completion;
  }

  async generate(
    system: string,
    user: string,
    tokens: number,
    signal?: AbortSignal
  ) {
    return this.send(system, user, tokens, { type: 'json_object' }, signal);
  }

  private async send(
    system: string,
    user: string,
    tokens: number,
    format: any,
    signal?: AbortSignal,
    relaxed = false
  ): Promise<{ content: any; usage: any; model: string; provider: string }> {
    const key =
      this.name === 'groq' ? this.env.GROQ_API_KEY : this.env.OPENROUTER_API_KEY;
    if (!key)
      throw new AIError(
        'MISSING_KEY',
        'AI is not configured on the server. File Maker remains available.',
        503
      );
    const price =
      this.name === 'openrouter' ? (await this.getCapabilities()).pricing : null;
    if (
      this.name === 'openrouter' &&
      (!price ||
        !Number.isFinite(price.prompt + price.completion) ||
        Math.min(price.prompt, price.completion) < 0)
    )
      throw new AIError(
        'PAID_DISABLED',
        'Fallback price could not be verified.',
        503
      );

    const isReasoningModel =
      this.name === 'groq' && /^openai\/gpt-oss-/.test(this.model);

    let r: Response;
    try {
      r = await this.request.call(
        globalThis,
        this.name === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : 'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + key,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: this.imageData ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: this.imageData } }] : user },
            ],
            temperature: this.effort === 'low' ? 0.3 : 0.5,
            stream: false,
            max_completion_tokens: this.name === 'groq' ? tokens : undefined,
            max_tokens: this.name === 'openrouter' ? tokens : undefined,
            reasoning_effort: isReasoningModel ? this.effort : undefined,
            reasoning: this.name === 'openrouter' && this.supportsReasoning && !relaxed ? { effort: this.effort, exclude: true } : undefined,
            response_format: relaxed && format?.type === 'json_schema' ? { type: 'json_object' } : format,
            ...(this.name === 'openrouter'
              ? {
                  provider: {
                    ...(relaxed ? {} : { require_parameters: true }),
                    sort: 'throughput',
                    max_price: {
                      prompt: price!.prompt * 1e6,
                      completion: price!.completion * 1e6,
                      request: 0,
                      image: this.imageData ? price!.prompt * 1e6 : 0,
                    },
                  },
                }
              : {}),
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(240000)])
            : AbortSignal.timeout(240000),
        }
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new AIError('PROVIDER_UNAVAILABLE', 'AI connection timed out or was interrupted. Please retry.', 502);
    }

    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      const retryAfter = Math.min(Number(r.headers.get('retry-after') || 5), 120);
      if (r.status === 429) {
        throw new AIError(
          'CAPACITY_LIMIT',
          this.name === 'groq' ? 'Free AI capacity is temporarily unavailable. Retry later.' : 'AI capacity is temporarily unavailable. Your saved work is safe; retry later.',
          429,
          retryAfter
        );
      }
      if (r.status >= 500) {
        throw new AIError(
          'PROVIDER_UNAVAILABLE',
          'AI is temporarily unavailable.',
          502,
          retryAfter
        );
      }
      if (r.status === 402) {
        throw new AIError('PROVIDER_CREDIT', 'The paid AI key has insufficient credits or has reached its spending limit.', 402);
      }
      if (r.status === 401) {
        throw new AIError(
          'KEY_REJECTED',
          'The server API key was rejected.',
          502
        );
      }
      if (r.status === 403) {
        throw new AIError(
          'MODEL_FORBIDDEN',
          `Model "${this.model}" is not permitted or requires provider terms qualification on the server account.`,
          502
        );
      }
      if (r.status === 404 && /no endpoints|no providers/i.test(errBody) && this.name === 'openrouter' && !relaxed) {
        const schemaHint = format?.type === 'json_schema' ? '\nReturn JSON matching this schema: ' + JSON.stringify(format.json_schema.schema) : '';
        return this.send(system + schemaHint, user, tokens, format, signal, true);
      }
      if (r.status === 404 && /no endpoints|no providers/i.test(errBody))
        throw new AIError('NO_COMPATIBLE_PROVIDER', 'No compatible AI provider is available within the configured price limit. Retry later.', 503);
      if (r.status === 404 || /model_not_found|does not exist|decommissioned/i.test(errBody)) {
        throw new AIError(
          'MODEL_UNAVAILABLE',
          `Model "${this.model}" is not available on ${this.name}. Configure a supported model in server settings.`,
          503
        );
      }
      if (this.name === 'groq' && (r.status === 413 || /request too large|tokens per minute|context.length/i.test(errBody)))
        throw new AIError('FREE_CONTEXT_LIMIT', 'The conversation exceeds the free provider input limit.', 413);
      if (this.name === 'groq' && /json_validate_failed|failed to generate json/i.test(errBody))
        throw new AIError('INVALID_OUTPUT', 'The provider returned invalid JSON.', 422);
      throw new AIError(
        'INVALID_REQUEST',
        this.name === 'groq' ? 'The free provider rejected this request. Please retry.' : 'The AI provider could not process this request. Please retry.',
        502
      );
    }

    const j: any = await r.json();
    if (j.choices?.[0]?.finish_reason === 'length' && tokens < 48000 && !(this as any)._lengthRetry) {
      const retryTokens = Math.min(64000, tokens * 2);
      await this.reserveRetry?.(retryTokens);
      (this as any)._lengthRetry = true;
      try { return await this.send(system, user, retryTokens, format, signal, relaxed); }
      finally { (this as any)._lengthRetry = false; }
    }
    if (j.choices?.[0]?.finish_reason === 'length')
      throw new AIError(
        'OUTPUT_LIMIT',
        'Response exceeded the operation limit. Reduce the requested size.',
        422
      );
    return {
      content: j.choices?.[0]?.message?.content,
      usage: j.usage || {},
      model: this.model,
      provider: this.name,
    };
  }

  async generateStructured<T>(
    schema: z.ZodType<T>,
    system: string,
    user: string,
    tokens: number,
    signal?: AbortSignal
  ) {
    const c = await this.getCapabilities();
    const js = z.toJSONSchema(schema, { target: 'draft-7' });
    let r;
    if (c.structured && this.name !== 'groq') {
      r = await this.send(
        system + '\nReturn JSON only. ',
        user,
        tokens,
        {
          type: 'json_schema',
          json_schema: { name: 'academic_output', strict: true, schema: js },
        },
        signal
      );
    } else {
      r = await this.send(
        system + '\nReturn JSON only. ' + JSON.stringify(js),
        user,
        tokens,
        { type: 'json_object' },
        signal
      );
    }
    let parsed: any;
    try {
      const raw = typeof r.content === 'string' ? r.content : '';
      parsed = JSON.parse(extractJsonPayload(raw));
    } catch {
      throw new AIError(
        'INVALID_OUTPUT',
        'The model returned invalid JSON. Nothing was saved as successful output.',
        422
      );
    }
    let result = schema.safeParse(parsed);
    if (!result.success) {
      const coerced = coerceDomainObject(parsed);
      if (coerced !== parsed) {
        result = schema.safeParse(coerced);
      }
    }
    if (!result.success)
      throw new AIError(
        'INVALID_OUTPUT',
        'The model output did not match the required structure.',
        422
      );
    return {
      data: result.data,
      usage: r.usage,
      model: r.model,
      provider: r.provider,
    };
  }
}

/** Reserve conservatively before any paid call. Reservations are not refunded after
 * ambiguous network failures, so retries and concurrent Workers cannot overspend. */
export function ledgerOptional(env: Env) {
  return env.PAID_LEDGER_OPTIONAL === 'true' && !env.DB && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function reservePaidBudget(env: Env, userId: string | null, amount: number) {
  const perOperation = Number(env.PAID_MAX_OPERATION_USD || 0.25);
  if (ledgerOptional(env)) {
    if (!Number.isFinite(amount) || amount < 0 || amount > perOperation)
      throw new AIError('BUDGET_EXHAUSTED', 'This task exceeds the per-operation spending limit. No paid request was sent.', 429);
    return;
  }
  if (!userId || (!env.DB && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)))
    throw new AIError('PAID_DISABLED', 'Paid AI requires an authenticated durable budget ledger.', 503);
  const cap = Number(env.PAID_GLOBAL_CAP_USD || 0);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(amount) || amount < 0 ||
      !Number.isFinite(perOperation) || perOperation <= 0 || amount > perOperation)
    throw new AIError('BUDGET_EXHAUSTED', 'Paid AI budget is unavailable or this task exceeds the per-operation limit. No paid request was sent.', 429);
  if (env.DB) {
    const micro = Math.max(1, Math.ceil(amount * 1e6));
    const limit = Math.floor(cap * 1e6);
    try {
      const result = await env.DB.prepare(`INSERT INTO mia_ai_budget (scope, reserved_microusd, requests)
        SELECT 'global', ?, 1 WHERE ? <= ?
        ON CONFLICT(scope) DO UPDATE SET reserved_microusd = reserved_microusd + excluded.reserved_microusd,
        requests = requests + 1 WHERE reserved_microusd + excluded.reserved_microusd <= ?
        RETURNING reserved_microusd`).bind(micro, micro, limit, limit).first();
      if (result) return;
    } catch { /* Fail closed when durable storage is unavailable. */ }
    throw new AIError('BUDGET_EXHAUSTED', 'Paid AI budget is exhausted or unavailable. No paid request was sent.', 429);
  }
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const r = await db.rpc('mia_reserve_budget', {
    ticket: crypto.randomUUID(), user_uuid: userId, amount, cap,
  });
  if (r.error || r.data !== true)
    throw new AIError('BUDGET_EXHAUSTED', 'Paid budget unavailable; no paid request was sent.', 429);
}

export const DEFAULT_BACKUP_MODELS = 'qwen/qwen3.8-flash';
const CHAIN_RETRY = ['CAPACITY_LIMIT', 'PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_FORBIDDEN', 'NO_COMPATIBLE_PROVIDER', 'INVALID_OUTPUT', 'OUTPUT_LIMIT', 'VISION_UNAVAILABLE', 'MODEL_OVER_BUDGET'];
/** Ordered paid models: preferred role first, then the other role, then cheap strong backups (OPENROUTER_BACKUP_MODELS, comma separated). */
export const DEFAULT_DESIGN_MODEL = 'anthropic/claude-sonnet-5.5';
export function modelChain(env: Env, role?: 'fast' | 'writer' | 'designer', vision = false) {
  const writer = env.OPENROUTER_MODEL || DEFAULT_WRITER_MODEL;
  const fast = env.OPENROUTER_FAST_MODEL || DEFAULT_FAST_MODEL;
  if (vision) return [...new Set([env.VISION_MODEL || fast, fast])];
  if (role === 'designer') return [...new Set([env.OPENROUTER_DESIGN_MODEL || DEFAULT_DESIGN_MODEL, fast, writer])];
  const backups = (env.OPENROUTER_BACKUP_MODELS ?? DEFAULT_BACKUP_MODELS).split(',').map(x => x.trim()).filter(Boolean);
  const first = role === 'fast' ? [fast, writer] : [writer, fast];
  return [...new Set([...first, ...backups])].slice(0, 4);
}

export async function route<T>(
  env: Env, schema: z.ZodType<T>, system: string, user: string, tokens: number,
  allowPaid: boolean, userId: string | null, signal?: AbortSignal,
  request: typeof fetch = fetch, preferPaid = false, imageData?: string,
  opts: { role?: 'fast' | 'writer' | 'designer'; effort?: 'low' | 'medium' | 'high' } = {}
) {
  const paidAllowed = env.OPENROUTER_ENABLED === 'true' &&
    (allowPaid || env.OWNER_PAID_ENABLED === 'true') && !!env.OPENROUTER_API_KEY;
  const paidOnce = async (model: string | undefined) => {
    let reserved = 0;
    const input = system + user + JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }));
    const p = new Provider('openrouter', env, request, model, imageData, opts.effort || 'low', async retryTokens => {
      const estimate = await p.estimateCost(input, retryTokens);
      const extra = estimate === null ? NaN : estimate + (imageData ? 0.01 : 0);
      const operationCap = Number(env.PAID_MAX_OPERATION_USD || 0.25);
      if (!Number.isFinite(extra) || reserved + extra > operationCap)
        throw new AIError('BUDGET_EXHAUSTED', 'The expanded response exceeds the per-operation spending limit.', 429);
      await reservePaidBudget(env, userId, extra);
      reserved += extra;
    });
    await p.getCapabilities();
    if (imageData && !(await p.getCapabilities()).vision) throw new AIError('VISION_UNAVAILABLE', 'The configured model does not support image understanding.', 503);
    const amount = await p.estimateCost(input, tokens);
    if (amount === null) throw new AIError('PAID_DISABLED', 'Fallback pricing is unavailable.', 503);
    reserved = amount + (imageData ? 0.01 : 0);
    const operationCap = Number(env.PAID_MAX_OPERATION_USD || 0.25);
    if (Number.isFinite(operationCap) && operationCap > 0 && reserved > operationCap)
      throw new AIError('MODEL_OVER_BUDGET', 'This model exceeds the operation budget; trying an alternative.', 429);
    await reservePaidBudget(env, userId, reserved);
    signal?.throwIfAborted();
    const result = await p.generateStructured(schema, system, user, tokens, signal);
    return { ...result, reservedCostUsd: reserved };
  };
  const paid = async () => {
    if (!ledgerOptional(env) && (!userId || (!env.DB && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY))))
      throw new AIError('PAID_DISABLED', 'Paid AI requires an authenticated durable budget ledger.', 503);
    const chain = modelChain(env, opts.role, !!imageData);
    let last: unknown;
    for (const m of chain) {
      try { return await paidOnce(m); }
      catch (e) {
        last = e;
        if (!(e instanceof AIError) || !CHAIN_RETRY.includes(e.code) || signal?.aborted) throw e;
      }
    }
    throw last;
  };
  if (imageData && !paidAllowed) throw new AIError('VISION_UNAVAILABLE', 'Image understanding requires the configured paid vision provider.', 503);
  let attemptedPaid = false;
  if ((preferPaid || imageData) && paidAllowed) {
    attemptedPaid = true;
    try { return await paid(); }
    catch (e) {
      if (imageData || !env.GROQ_API_KEY || !(e instanceof AIError) ||
          !['CAPACITY_LIMIT', 'PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_FORBIDDEN', 'KEY_REJECTED', 'PAID_DISABLED', 'NO_COMPATIBLE_PROVIDER', 'INVALID_OUTPUT', 'OUTPUT_LIMIT', 'MODEL_OVER_BUDGET', 'BUDGET_EXHAUSTED'].includes(e.code)) throw e;
    }
  }
  let failure: unknown;
  try {
    return await new Provider('groq', env, request).generateStructured(schema, system, user, tokens, signal);
  } catch (e) { failure = e; }
  if (failure instanceof AIError && ['MODEL_UNAVAILABLE', 'MODEL_FORBIDDEN', 'CAPACITY_LIMIT', 'PROVIDER_UNAVAILABLE', 'INVALID_OUTPUT', 'FREE_CONTEXT_LIMIT'].includes(failure.code) &&
      env.GROQ_FALLBACK_MODEL && env.GROQ_FALLBACK_MODEL !== (env.GROQ_MODEL || 'openai/gpt-oss-120b')) {
    try {
      return await new Provider('groq', env, request, env.GROQ_FALLBACK_MODEL)
        .generateStructured(schema, system, user, tokens, signal);
    } catch (e) { failure = e; }
  }
  if (attemptedPaid || !(failure instanceof AIError) ||
      !['CAPACITY_LIMIT', 'PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_FORBIDDEN', 'MISSING_KEY', 'INVALID_OUTPUT', 'FREE_CONTEXT_LIMIT'].includes(failure.code) ||
      !paidAllowed) throw failure;
  return paid();
}
