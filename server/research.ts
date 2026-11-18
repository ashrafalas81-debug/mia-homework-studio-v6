import { XMLParser } from 'fast-xml-parser';
import { recommendEvidence, type Source } from '../shared/model';

const xml = new XMLParser({ ignoreAttributes: false });
const arr = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x: any): string =>
  typeof x === 'string' || typeof x === 'number'
    ? String(x)
    : x && typeof x === 'object'
    ? Object.entries(x)
        .filter(([k]) => !k.startsWith('@_'))
        .map(([, v]) => text(v))
        .join(' ')
    : '';

let gate = Promise.resolve();

async function ncbi(path: string, key?: string) {
  const prev = gate;
  let done!: () => void;
  gate = new Promise((r) => (done = r));
  await prev;
  try {
    const r = await fetch.call(
      globalThis,
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/' +
        path +
        '&tool=MIAHomeworkStudio' +
        (key ? '&api_key=' + encodeURIComponent(key) : ''),
      { signal: AbortSignal.timeout(30000) }
    );
    if (!r.ok) {
      throw new Error(`Scientific source service is temporarily unavailable (NCBI HTTP ${r.status}).`);
    }
    return await r.text();
  } finally {
    await new Promise((r) => setTimeout(r, key ? 120 : 380));
    done();
  }
}

export function parsePubmedXml(raw: string): Source[] {
  const root = xml.parse(raw).PubmedArticleSet;
  if (!root) return [];

  const articles: Source[] = arr(root.PubmedArticle).map((a) => {
    const m = a.MedlineCitation;
    const v = m?.Article || {};
    const ids = arr(a.PubmedData?.ArticleIdList?.ArticleId);
    const pmid = text(m?.PMID).trim();
    const doi = text(ids.find((i) => i?.['@_IdType'] === 'doi')).trim() || null;
    const types = arr(v.PublicationTypeList?.PublicationType).map(text).filter(Boolean);
    const abstract = arr(v.Abstract?.AbstractText)
      .map((sec) => {
        const label = sec?.['@_Label'];
        const body = text(sec).trim();
        return label && body ? `${label}: ${body}` : body;
      })
      .filter(Boolean)
      .join('\n');
    const concerns = arr(m?.CommentsCorrectionsList?.CommentsCorrections)
      .filter((c) => /RetractionIn|ExpressionOfConcernIn/.test(c?.['@_RefType'] || ''))
      .map((c) => c['@_RefType'] + ': ' + text(c.RefSource));
    const volume = text(v.Journal?.JournalIssue?.Volume).trim() || null;
    const issue = text(v.Journal?.JournalIssue?.Issue).trim() || null;
    const pages = text(v.Pagination?.MedlinePgn).trim() || null;

    return {
      id: 'pmid:' + pmid,
      title: text(v.ArticleTitle).trim(),
      authors: arr(v.AuthorList?.Author)
        .map((au) =>
          au?.CollectiveName
            ? text(au.CollectiveName).trim()
            : [text(au?.LastName).trim(), text(au?.Initials).trim()].filter(Boolean).join(' ')
        )
        .filter(Boolean),
      journal: text(v.Journal?.Title).trim(),
      year:
        text(v.Journal?.JournalIssue?.PubDate?.Year).trim() ||
        text(v.Journal?.JournalIssue?.PubDate?.MedlineDate).match(/\d{4}/)?.[0] ||
        null,
      pmid,
      doi,
      url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
      abstract,
      publicationTypes: types,
      accessLevel: abstract ? 'abstract' : 'metadata',
      retracted:
        types.includes('Retracted Publication') ||
        concerns.some((x) => x.startsWith('RetractionIn')),
      concerns,
      retrievedAt: new Date().toISOString(),
      volume,
      issue,
      pages,
      recordType: types.some((t) => /guideline/i.test(t)) ? 'guideline' : 'article',
      provenance: 'PubMed E-utilities',
    };
  });

  const books: Source[] = arr(root.PubmedBookArticle).map((b) => {
    const doc = b.BookDocument || {};
    const book = doc.Book || {};
    const pmid = text(doc.PMID).trim();
    const ids = arr(b.PubmedBookData?.ArticleIdList?.ArticleId || doc.ArticleIdList?.ArticleId);
    const doi = text(ids.find((i) => i?.['@_IdType'] === 'doi')).trim() || null;
    const bookTitle = text(book.BookTitle).trim();
    const articleTitle = text(doc.ArticleTitle).trim();
    const fullTitle = [articleTitle, bookTitle].filter(Boolean).join(' — ') || 'NCBI Bookshelf Record';
    const abstract = arr(doc.Abstract?.AbstractText)
      .map((sec) => {
        const label = sec?.['@_Label'];
        const body = text(sec).trim();
        return label && body ? `${label}: ${body}` : body;
      })
      .filter(Boolean)
      .join('\n');
    const authorLists = arr(doc.AuthorList).flatMap((al) => arr(al?.Author));
    const authors = authorLists
      .map((au) =>
        au?.CollectiveName
          ? text(au.CollectiveName).trim()
          : [text(au?.LastName).trim(), text(au?.Initials).trim()].filter(Boolean).join(' ')
      )
      .filter(Boolean);
    const year =
      text(book.PubDate?.Year).trim() ||
      text(doc.ContributionDate?.Year).trim() ||
      null;
    const publisher = text(book.Publisher?.PublisherName).trim() || 'NCBI Bookshelf';

    return {
      id: 'pmid:' + pmid,
      title: fullTitle,
      authors,
      journal: bookTitle || publisher,
      year,
      pmid,
      doi,
      url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
      abstract,
      publicationTypes: ['Book Chapter / Monograph'],
      accessLevel: abstract ? 'abstract' : 'metadata',
      retracted: false,
      concerns: [],
      retrievedAt: new Date().toISOString(),
      volume: null,
      issue: null,
      pages: null,
      recordType: 'book',
      provenance: 'PubMed / NCBI Bookshelf',
    };
  });

  return [...articles, ...books].filter((s) => !!s.pmid && !!s.title);
}

export function deduplicateSources(sources: Source[]): Source[] {
  const seenPmid = new Set<string>();
  const seenDoi = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const pmidKey = s.pmid?.trim();
    const doiKey = s.doi?.trim().toLowerCase();
    if (pmidKey && seenPmid.has(pmidKey)) continue;
    if (doiKey && seenDoi.has(doiKey)) continue;
    if (pmidKey) seenPmid.add(pmidKey);
    if (doiKey) seenDoi.add(doiKey);
    out.push(s);
  }
  return out;
}

export function expandMedicalQuery(query: string): string[] {
  const clean = query.trim();
  if (/dermatomes?/i.test(clean) && /myotomes?/i.test(clean)) return [clean, '(dermatome* OR myotome*)', '(dermatome* OR myotome*) AND neurological examination'];
  const queries = [clean];
  const core = clean.replace(/\b(?:scientific references|research summary|presentation|powerpoint|scientific|references|summary|review|research|evidence-based)\b/gi, ' ').replace(/\s+/g,' ').trim();
  if (core.length >= 3 && core !== clean) queries.push(core);
  const lower = clean.toLowerCase();
  const expansions: [RegExp, string][] = [
    [/\bmckenzie\b/i, '(McKenzie method OR mechanical diagnosis and therapy) AND chronic low back pain'],
    [/\bshoulder instability\b/i, 'shoulder instability AND (glenohumeral ligament OR Bankart OR rehabilitation)'],
    [/\badhesive capsulitis\b.*\brotator cuff\b|\brotator cuff\b.*\badhesive capsulitis\b/i, '(adhesive capsulitis OR frozen shoulder) AND rotator cuff tear AND differential diagnosis'],
    [/\bdermatomes?\b.*\bmyotomes?\b/i, '(dermatome* OR myotome*) AND (anatomy OR examination)'],
  ];
  for (const [rx, expanded] of expansions) {
    if (rx.test(lower) && !queries.includes(expanded)) {
      queries.push(expanded);
    }
  }
  return queries;
}

async function verifyPrimary(ids: string[], key?: string): Promise<Source[]> {
  const out: Source[] = [];
  const pmids = ids.filter((x) => /^pmid:\d+$/.test(x)).map((x) => x.slice(5));
  if (pmids.length) {
    out.push(
      ...parsePubmedXml(
        await ncbi('efetch.fcgi?db=pubmed&retmode=xml&id=' + pmids.join(','), key)
      )
    );
  }
  for (const id of ids.filter((x) => x.startsWith('doi:'))) {
    const doi = id.slice(4);
    if (!/^10\.\d{4,9}\/.{1,200}$/.test(doi))
      throw new Error('Invalid source identifier.');
    const r = await fetch.call(
      globalThis,
      'https://api.crossref.org/works/' + encodeURIComponent(doi),
      { signal: AbortSignal.timeout(25000) }
    );
    if (!r.ok) throw new Error(`Source could not be verified (Crossref HTTP ${r.status}).`);
    const w = ((await r.json()) as any).message;
    const abstract = text(xml.parse('<r>' + (w.abstract || '') + '</r>').r).trim();
    out.push({
      id,
      doi,
      pmid: null,
      title: w.title?.[0] || '',
      authors: (w.author || []).map((a: any) =>
        [a.family, a.given].filter(Boolean).join(' ')
      ),
      journal: w['container-title']?.[0] || '',
      year: String(w.published?.['date-parts']?.[0]?.[0] || '') || null,
      url: 'https://doi.org/' + doi,
      abstract,
      accessLevel: abstract ? 'abstract' : 'metadata',
      publicationTypes: [w.type || 'journal-article'],
      retracted: (w['update-to'] || []).some((x: any) => /retract/i.test(x.type)),
      concerns: [],
      retrievedAt: new Date().toISOString(),
      volume: w.volume ? String(w.volume) : null,
      issue: w.issue ? String(w.issue) : null,
      pages: w.page ? String(w.page) : null,
      recordType: 'article',
      provenance: 'Crossref API',
    });
  }
  if (out.length !== ids.length)
    throw new Error('A selected scientific source was not found.');
  return out;
}

async function searchPrimary(
  query: string,
  db: string,
  filter: string,
  key?: string,
  page = 1,
  pageSize = 10
) {
  const safeSize = Math.min(Math.max(pageSize, 4), 20);
  const offset = Math.max(0, (page - 1) * safeSize);

  if (db === 'crossref') {
    const r = await fetch.call(
      globalThis,
      `https://api.crossref.org/works?rows=${safeSize}&offset=${offset}&query.bibliographic=` +
        encodeURIComponent(query),
      { signal: AbortSignal.timeout(30000) }
    );
    if (!r.ok) throw new Error(`Crossref search failed (HTTP ${r.status}).`);
    const j: any = await r.json();
    const ids = (j.message?.items || [])
      .filter((x: any) => x.DOI)
      .slice(0, safeSize)
      .map((x: any) => 'doi:' + x.DOI);
    const results = await Promise.allSettled(ids.map((id: string) => verify([id], key)));
    const sources = deduplicateSources(
      results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    );
    return {
      sources,
      omitted: Math.max(0, ids.length - sources.length),
      appliedQueries: [query],
    };
  }

  const suffix: Record<string, string> = {
    mixed: '',
    recent: ` AND (${new Date().getFullYear() - 5}:3000[pdat])`,
    rct: ' AND randomized controlled trial[pt]',
    systematic: ' AND (systematic review[pt] OR meta-analysis[pt])',
    guideline: ' AND (practice guideline[pt] OR guideline[pt])',
  };

  const expanded = expandMedicalQuery(query);
  const appliedTerm = expanded[0] + (suffix[filter] || '');
  const j = JSON.parse(
    await ncbi(
      `esearch.fcgi?db=pubmed&retmode=json&retstart=${offset}&retmax=${safeSize}&sort=relevance&term=` +
        encodeURIComponent(appliedTerm),
      key
    )
  );
  const ids: string[] = j.esearchresult?.idlist || [];
  const sources = ids.length
    ? deduplicateSources(
        parsePubmedXml(
          await ncbi('efetch.fcgi?db=pubmed&retmode=xml&id=' + ids.join(','), key)
        )
      )
    : [];
  return {
    sources,
    omitted: Math.max(0, ids.length - sources.length),
    appliedQueries: [appliedTerm],
  };
}

async function europe(query: string, pageSize = 10, allowDoiRecords = false): Promise<Source[]> {
  const u = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  u.searchParams.set('query', allowDoiRecords ? query : 'SRC:MED AND (' + query + ')');
  u.searchParams.set('format', 'json');
  u.searchParams.set('resultType', 'core');
  u.searchParams.set('pageSize', String(Math.min(Math.max(pageSize, 4), 20)));
  const r = await fetch.call(globalThis, u, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok)
    throw new Error('Scientific databases are temporarily unavailable. Retry shortly.');
  const j: any = await r.json();
  return (j.resultList?.result || [])
    .filter((w: any) =>
      allowDoiRecords
        ? (w.source === 'MED' && /^\d+$/.test(String(w.id))) || !!w.doi
        : w.source === 'MED' && /^\d+$/.test(String(w.id))
    )
    .map((w: any) => {
      const abstract = text(xml.parse('<r>' + (w.abstractText || '') + '</r>').r).trim();
      const hasPmid = w.source === 'MED' && /^\d+$/.test(String(w.id));
      const pmid = hasPmid ? String(w.id) : w.pmid ? String(w.pmid) : null;
      const doi = w.doi ? String(w.doi) : null;
      const id = pmid ? 'pmid:' + pmid : 'doi:' + doi;
      return {
        id,
        pmid,
        doi,
        title: text(xml.parse('<r>' + (w.title || '') + '</r>').r).trim(),
        authors: (w.authorList?.author || []).map(
          (a: any) =>
            a.fullName || [a.lastName, a.initials].filter(Boolean).join(' ')
        ),
        journal: w.journalInfo?.journal?.title || w.bookOrReportDetails?.publisher || '',
        year: w.pubYear ? String(w.pubYear) : null,
        url: pmid
          ? 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/'
          : 'https://doi.org/' + doi,
        abstract,
        accessLevel: abstract ? 'abstract' : 'metadata',
        publicationTypes: w.pubTypeList?.pubType || [],
        retracted:
          w.isRetracted === 'Y' ||
          (w.pubTypeList?.pubType || []).includes('Retracted Publication'),
        concerns: [],
        retrievedAt: new Date().toISOString(),
        volume: w.journalInfo?.volume ? String(w.journalInfo.volume) : null,
        issue: w.journalInfo?.issue ? String(w.journalInfo.issue) : null,
        pages: w.pageInfo ? String(w.pageInfo) : null,
        recordType: 'article',
        provenance: 'Europe PMC Fallback',
      };
    });
}

/** OpenAlex: free, keyless, very large index. Only records that also have a PubMed ID are kept, so the
 *  normal PubMed verification still re-checks every selected source before writing. */
export function parseOpenAlex(j: any): Source[] {
  return (j?.results || []).flatMap((w: any) => {
    const pmid = String(w.ids?.pmid || '').match(/(\d+)\/?$/)?.[1];
    if (!pmid || w.is_retracted) return [];
    const inv = w.abstract_inverted_index || {};
    const words: string[] = [];
    for (const [word, pos] of Object.entries(inv)) for (const i of pos as number[]) words[i] = word;
    const abstract = words.filter(Boolean).join(' ').trim();
    if (!abstract) return [];
    const doi = w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, '') : null;
    const b = w.biblio || {};
    return [{
      id: 'pmid:' + pmid, pmid, doi,
      title: String(w.title || w.display_name || '').trim(),
      authors: (w.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean),
      journal: w.primary_location?.source?.display_name || '',
      year: w.publication_year ? String(w.publication_year) : null,
      url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
      abstract, accessLevel: 'abstract' as const,
      publicationTypes: [w.type || 'article'], retracted: false, concerns: [],
      retrievedAt: new Date().toISOString(),
      volume: b.volume || null, issue: b.issue || null,
      pages: b.first_page ? b.first_page + (b.last_page ? '-' + b.last_page : '') : null,
      recordType: 'article' as const, provenance: 'OpenAlex',
    }];
  });
}

async function openAlex(query: string, filter: string, pageSize = 10): Promise<Source[]> {
  const u = new URL('https://api.openalex.org/works');
  const f = ['has_abstract:true', 'has_pmid:true'];
  if (filter === 'recent') f.push('from_publication_date:' + (new Date().getFullYear() - 5) + '-01-01');
  if (filter === 'systematic') f.push('type:review');
  u.searchParams.set('search', query);
  u.searchParams.set('filter', f.join(','));
  u.searchParams.set('per-page', String(Math.min(Math.max(pageSize, 4), 20)));
  u.searchParams.set('mailto', 'support@medicalintelligence.academy');
  const r = await fetch.call(globalThis, u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('OpenAlex unavailable.');
  return parseOpenAlex(await r.json());
}

export async function search(
  query: string, db: string, filter: string, key?: string, page = 1, pageSize = 10
) {
  if (db !== 'pubmed') {
    const res = await searchPrimary(query, db, filter, key, page, pageSize);
    const rec = recommendEvidence(res.sources, query);
    return {...res, via: db, recommendedIds: rec.selectedIds, rationale: rec.rationale};
  }
  const filters: Record<string, string> = {
    mixed: '', recent: ' AND FIRST_PDATE:[' + (new Date().getFullYear()-5) + '-01-01 TO 3000-12-31]',
    rct: ' AND PUB_TYPE:"randomized controlled trial"', systematic: ' AND PUB_TYPE:"systematic review"', guideline: ' AND PUB_TYPE:"practice guideline"',
  };
  const appliedQueries: string[] = [];
  let sources: Source[] = [], primaryUnavailable = false, succeeded = false, lastError: unknown;
  const providers = new Set<string>();
  // At most three real queries; failed NCBI requests are not repeated on every variant.
  for (const candidate of expandMedicalQuery(query).slice(0,3)) {
    if (!primaryUnavailable) {
      try {
        const res = await searchPrimary(candidate, db, filter, key, page, pageSize);
        sources = deduplicateSources([...sources, ...res.sources]);
        appliedQueries.push(...res.appliedQueries); providers.add('PubMed'); succeeded = true;
      } catch(e) {primaryUnavailable = true; lastError = e;}
    }
    if (recommendEvidence(sources, query, 14).selectedIds.length >= 6) break;
    const applied = candidate + (filters[filter] || '');
    try {
      const found = await europe(applied, pageSize);
      sources = deduplicateSources([...sources, ...found]);
      appliedQueries.push(applied); providers.add('PubMed via Europe PMC'); succeeded = true;
    } catch(e) {lastError = e;}
    if (recommendEvidence(sources, query, 14).selectedIds.length >= 6) break;
  }
  // Third free index: widens thin topics and keeps research working when NCBI/Europe PMC are down.
  if (recommendEvidence(sources, query, 14).selectedIds.length < 6) {
    try {
      const found = await openAlex(query, filter, pageSize);
      if (found.length) { sources = deduplicateSources([...sources, ...found]); providers.add('OpenAlex'); succeeded = true; appliedQueries.push('OpenAlex: ' + query); }
    } catch (e) { lastError = lastError || e; }
  }
  if (!succeeded) throw lastError || new Error('Scientific databases are temporarily unavailable.');
  const rec = recommendEvidence(sources, query, 14);
  return {sources, omitted:0, via:[...providers].join(' + '), appliedQueries:[...new Set(appliedQueries)], recommendedIds:rec.selectedIds, rationale:rec.rationale};
}

export async function verify(ids: string[], key?: string): Promise<Source[]> {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  try {
    return await verifyPrimary(uniqueIds, key);
  } catch (e) {
    const pmids = uniqueIds.filter((id) => /^pmid:\d+$/.test(id));
    if (pmids.length !== uniqueIds.length) throw e;
    const sources = await europe(
      pmids.map((id) => 'EXT_ID:' + id.slice(5)).join(' OR '),
      Math.max(10, pmids.length)
    );
    if (
      sources.length !== uniqueIds.length ||
      uniqueIds.some((id) => !sources.some((s) => s.id === id))
    )
      throw new Error('A selected source could not be verified.');
    return sources;
  }
}
