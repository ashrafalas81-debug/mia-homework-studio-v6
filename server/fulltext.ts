/**
 * Free open-access full text from Europe PMC (no key, no cost).
 * For selected PubMed sources that are open access, pulls the Results / Discussion / Conclusion
 * sections so the writer can report real findings instead of relying on the abstract alone.
 * Any failure is silent: the draft simply falls back to abstracts.
 */
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const WANTED = /^(results?|findings|discussion|conclusions?|main results|outcomes?)\b/i;

const clean = (s: string) => s
  .replace(/<xref[^>]*>.*?<\/xref>/gs, '')
  .replace(/<(table-wrap|fig|disp-formula)[^>]*>.*?<\/\1>/gs, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Pulls top-level <sec> blocks whose title matches Results/Discussion/Conclusion. */
export function extractSections(xmlText: string, perSource = 2600) {
  const out: string[] = [];
  const body = xmlText.split(/<body[^>]*>/)[1]?.split('</body>')[0] || '';
  const re = /<sec\b[^>]*>\s*<title>(.*?)<\/title>(.*?)<\/sec>/gs;
  for (const m of body.matchAll(re)) {
    const title = clean(m[1]);
    if (!WANTED.test(title)) continue;
    out.push(`${title}: ${clean(m[2])}`);
  }
  return out.join(' ').slice(0, perSource);
}

export async function fullTextExcerpts(
  pmids: string[],
  request: typeof fetch = fetch,
  max = 5,
  dois: string[] = [],
): Promise<Record<string, string>> {
  const ids = [...new Set(pmids.filter(x => /^\d+$/.test(x)))].slice(0, 25);
  const dd = [...new Set(dois.filter(x => /^10\.\d{4,9}\/[^\s"]{1,200}$/.test(x)))].slice(0, 20);
  if (!ids.length && !dd.length) return {};
  const res: Record<string, string> = {};
  try {
    const u = new URL(EPMC + '/search');
    const terms = [...ids.map(x => 'EXT_ID:' + x), ...dd.map(x => 'DOI:"' + x + '"')];
    u.searchParams.set('query', `(${terms.join(' OR ')}) AND OPEN_ACCESS:y`);
    u.searchParams.set('format', 'json');
    u.searchParams.set('resultType', 'lite');
    u.searchParams.set('pageSize', '25');
    let r: Response | null = null;
    for (let i = 0; i < 2 && !r?.ok; i++) {
      try { r = await request.call(globalThis, u, { signal: AbortSignal.timeout(15000) }); } catch { r = null; }
    }
    if (!r?.ok) return res;
    const hits = ((await r.json()) as any).resultList?.result || [];
    const open = hits.filter((h: any) => h.pmcid && (h.pmid || h.doi)).slice(0, max);
    await Promise.all(open.map(async (h: any) => {
      try {
        let x: Response | null = null;
        for (let i = 0; i < 2 && !x?.ok; i++) {
          try { x = await request.call(globalThis, `${EPMC}/${h.pmcid}/fullTextXML`, { signal: AbortSignal.timeout(15000) }); } catch { x = null; }
        }
        if (!x?.ok) return;
        const text = extractSections(await x.text());
        if (text.length > 300) res[h.pmid || 'doi:' + String(h.doi).toLowerCase()] = text;
      } catch { /* abstract-only fallback */ }
    }));
  } catch { /* abstract-only fallback */ }
  return res;
}
