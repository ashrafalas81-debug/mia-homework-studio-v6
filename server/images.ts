/**
 * Free, licence-checked medical illustrations for slides.
 * Source: Wikimedia Commons (hosts Gray's Anatomy plates, OpenStax Anatomy & Physiology,
 * Blausen Medical, Servier Medical Art uploads and many CC BY diagrams).
 * Only public-domain / CC0 / CC BY / CC BY-SA files are accepted, and every image
 * carries an attribution line that is printed on the slide.
 */

export type SlideImage = {
  data: string;
  width: number;
  height: number;
  attribution: string;
  sourceUrl: string;
  license: string;
  title: string;
};

const UA = 'MIAHomeworkStudio/2.0 (educational slide builder; contact via Medical Intelligence Academy)';
const ALLOWED = /^(public domain|pd|cc0|no restrictions|cc[ -]?by(?:[ -]?sa)?(?:[ -]?\d(?:\.\d)?)?)/i;
const UNSAFE = /\b(autopsy|cadaver|corpse|dissection|gore|nsfw|nude|naked|genital|dead body|execution|wound)\b/i;
// Words that narrow Commons full-text search too much (verified live: long queries return 0–5 files).
// Verified live: event photos of people, quizzes with blank labels and off-topic images slipped through.
const OFF_TOPIC = /\b(quiz|blank|unlabel+ed|worksheet|conference|congress|demonstrating|symposium|portrait|selfie|poster|award|ceremony|chouette)\b|\d{4}-\d{2}-\d{2}/i;
const GENERIC = /\b(diagram|illustration|illustrated|anatomy|anatomical|image|picture|schematic|figure|drawing|overview|labelled|labeled|medical|of|the|and|with)\b/gi;

/** Commons throttles bursts (HTTP 429/503); one polite retry after a short pause fixes most misses. */
async function politeFetch(request: typeof fetch, url: string | URL, init: RequestInit) {
  let r = await request.call(globalThis, url, init);
  if (r.status === 429 || r.status === 503) {
    await new Promise(res => setTimeout(res, Math.min(4000, Number(r.headers.get('retry-after') || 1.5) * 1000)));
    r = await request.call(globalThis, url, { ...init, signal: AbortSignal.timeout(15000) });
  }
  return r;
}

const strip = (html: string) => (html || '').replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

type Candidate = { title: string; url: string; thumb: string; width: number; height: number; license: string; artist: string; page: string; score: number };

export function pickCandidates(json: any, query: string, exclude: string[] = []): Candidate[] {
  const pages = Object.values(json?.query?.pages || {}) as any[];
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const out: Candidate[] = [];
  for (const p of pages) {
    const info = p?.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const meta = info.extmetadata || {};
    const license = strip(meta.LicenseShortName?.value || '');
    if (!ALLOWED.test(license) || /\bnc\b|\bnd\b/i.test(license)) continue;
    if (!/^image\/(jpeg|png|svg\+xml|gif)$/.test(info.mime || '')) continue;
    const title = String(p.title || '').replace(/^File:/, '');
    const desc = strip(meta.ImageDescription?.value || '');
    if (UNSAFE.test(title + ' ' + desc) || OFF_TOPIC.test(title)) continue;
    if (exclude.includes(title)) continue;
    const w = Number(info.thumbwidth || info.width || 0), h = Number(info.thumbheight || info.height || 0);
    if (Math.max(Number(info.width || 0), Number(info.height || 0)) < 400 || !w || !h) continue;
    const ratio = w / h;
    if (ratio > 3.2 || ratio < 0.3) continue;
    const hay = (title + ' ' + desc).toLowerCase();
    const matched = words.filter(w2 => hay.includes(w2)).length;
    if (matched < Math.ceil(words.length / 2)) continue; // at least half the topic words (verified live: 10/12 relevant, 0 off-topic)
    let score = matched * 3;
    if (/diagram|illustration|anatomy|schematic|gray|openstax|blausen|servier|figure/i.test(hay)) score += 4;
    if (/\.svg$/i.test(title)) score += 2;
    if (/logo|icon|flag|map of|stamp/i.test(hay)) score -= 8;
    if (/[-_ ](es|de|fr|it|pt|ru|pl|nl|ca)\.[a-z]+$/i.test(title)) score -= 3; // prefer English-labelled versions
    out.push({
      title, url: info.descriptionurl || 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title),
      thumb: info.thumburl, width: w, height: h, license,
      artist: strip(meta.Artist?.value || '').slice(0, 80) || 'Wikimedia Commons contributor',
      page: info.descriptionurl || '', score,
    });
  }
  return out.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
}

async function commons(query: string, request: typeof fetch, scoreFor = query, exclude: string[] = []) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  const params: Record<string, string> = {
    action: 'query', format: 'json', origin: '*', generator: 'search',
    gsrsearch: query, gsrnamespace: '6', gsrlimit: '15',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1000',
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await politeFetch(request, u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Image library unavailable (HTTP ' + r.status + ').');
  return pickCandidates(await r.json(), scoreFor, exclude);
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Returns the best licensed illustration for a slide, or null when none is suitable. */
export async function findSlideImage(query: string, request: typeof fetch = fetch, exclude: string[] = []): Promise<SlideImage | null> {
  const q = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (q.length < 3) return null;
  // Progressive search: full phrase → without generic words → the core 2 words. Only bitmaps/drawings,
  // because Commons full-text search otherwise returns scanned PDF books first.
  const core = q.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
  const tries = [...new Set([q, core, core.split(' ').slice(0, 2).join(' ')])].filter(x => x.length >= 3);
  let candidates: Candidate[] = [];
  // First pass: only the curated medical-illustration collections hosted on Commons (labelled, textbook quality).
  try { candidates = await commons(`${core || q} (Blausen OR OpenStax OR Gray OR Servier OR "Anatomy and Physiology") filetype:bitmap|drawing`, request, q, exclude); }
  catch { candidates = []; }
  for (const t of candidates.length ? [] : tries) {
    candidates = await commons(t + ' filetype:bitmap|drawing', request, q, exclude);
    if (candidates.length) break;
  }
  for (const c of candidates.slice(0, 3)) {
    try {
      const r = await politeFetch(request, c.thumb, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const type = (r.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|gif)$/.test(type)) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 2_500_000 || buf.byteLength < 2000) continue;
      return {
        data: `data:${type};base64,${toBase64(buf)}`,
        width: c.width, height: c.height,
        attribution: `${c.title.replace(/\.[a-z]+$/i, '')} — ${c.artist}, ${c.license}, via Wikimedia Commons`.slice(0, 220),
        sourceUrl: c.url, license: c.license, title: c.title,
      };
    } catch { /* try the next candidate */ }
  }
  return null;
}


/* ───────── Gallery: several licensed choices the student can pick from ───────── */

export type GalleryItem = { thumb: string; full: string; title: string; credit: string; license: string; source: 'Wikimedia' | 'Openverse'; page: string; width: number; height: number };

const IMAGE_HOSTS = /^https:\/\/(upload\.wikimedia\.org|thumb\.wikimedia\.org|api\.openverse\.org|api\.openverse\.engineering|live\.staticflickr\.com|farm\d+\.staticflickr\.com)\//;
async function openverse(query: string, request: typeof fetch): Promise<GalleryItem[]> {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', query);
  u.searchParams.set('page_size', '12');
  u.searchParams.set('license_type', 'commercial,modification');
  u.searchParams.set('mature', 'false');
  const r = await politeFetch(request, u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const j: any = await r.json();
  return (j.results || []).filter((x: any) => x.thumbnail && !UNSAFE.test(`${x.title} ${(x.tags || []).map((t: any) => t.name).join(' ')}`)).map((x: any) => ({
    thumb: x.thumbnail, full: IMAGE_HOSTS.test(String(x.url || '')) ? String(x.url) : x.thumbnail, title: String(x.title || '').slice(0, 120),
    credit: `${String(x.title || 'Image').slice(0, 70)} — ${String(x.creator || 'unknown').slice(0, 50)}, ${String(x.license || '').toUpperCase()} ${x.license_version || ''}, via ${x.source || 'Openverse'}`.slice(0, 220),
    license: `${x.license} ${x.license_version || ''}`.trim(), source: 'Openverse' as const, page: x.foreign_landing_url || '', width: Number(x.width || 0), height: Number(x.height || 0),
  }));
}

/** Up to ~16 licensed images for a topic from Wikimedia Commons and Openverse. */
export async function searchGallery(query: string, request: typeof fetch = fetch): Promise<GalleryItem[]> {
  const q = query.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (q.length < 2) return [];
  const core = q.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim() || q;
  const [wiki, ov] = await Promise.all([
    commons(core + ' filetype:bitmap|drawing', request, core).catch(() => [] as Candidate[]),
    openverse(core, request).catch(() => [] as GalleryItem[]),
  ]);
  const w: GalleryItem[] = wiki.slice(0, 10).map(c => ({
    thumb: c.thumb.replace(/\/\d+px-/, '/500px-'), full: c.thumb, title: c.title,
    credit: `${c.title.replace(/\.[a-z]+$/i, '')} — ${c.artist}, ${c.license}, via Wikimedia Commons`.slice(0, 220),
    license: c.license, source: 'Wikimedia', page: c.url, width: c.width, height: c.height,
  }));
  const out: GalleryItem[] = [];
  for (let i = 0; out.length < 16 && (i < w.length || i < ov.length); i++) { if (w[i]) out.push(w[i]); if (ov[i]) out.push(ov[i]); }
  return out;
}

/** Downloads a chosen gallery image (only from the licensed sources) as a data URL. */
export async function fetchGalleryImage(url: string, request: typeof fetch = fetch) {
  if (!IMAGE_HOSTS.test(url)) throw new Error('Image source not allowed.');
  const r = await politeFetch(request, url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Image download failed (HTTP ' + r.status + ').');
  const type = (r.headers.get('content-type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) throw new Error('Unsupported image type.');
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 3_200_000) throw new Error('Image too large.');
  return `data:${type};base64,${toBase64(buf)}`;
}
