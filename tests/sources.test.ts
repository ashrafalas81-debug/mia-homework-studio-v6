import { it, expect, vi } from 'vitest';
import { parseOpenAlex } from '../server/research';
import { fullTextExcerpts } from '../server/fulltext';

it('rebuilds OpenAlex abstracts and keeps only PubMed-verifiable records', () => {
  const out = parseOpenAlex({ results: [
    { ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/12345' }, doi: 'https://doi.org/10.1/abc', title: 'Shoulder rehab', publication_year: 2024,
      authorships: [{ author: { display_name: 'A B' } }], primary_location: { source: { display_name: 'J Ortho' } },
      abstract_inverted_index: { Exercise: [0], improved: [1], pain: [2] }, biblio: { volume: '5', first_page: '10', last_page: '20' } },
    { ids: {}, title: 'No pmid', abstract_inverted_index: { x: [0] } },
    { ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/9' }, is_retracted: true, abstract_inverted_index: { x: [0] } },
  ] });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ id: 'pmid:12345', doi: '10.1/abc', abstract: 'Exercise improved pain', pages: '10-20', provenance: 'OpenAlex' });
});

it('finds open-access full text by DOI as well as PMID, with one retry', async () => {
  const xml = '<article><body><sec><title>Results</title><p>' + 'Grip strength improved markedly after training. '.repeat(12) + '</p></sec></body></article>';
  let first = true;
  const f = vi.fn(async (u: any) => {
    const url = String(u);
    if (url.includes('/search')) {
      if (first) { first = false; return new Response('', { status: 503 }); }
      if (!decodeURIComponent(url.replace(/\+/g, " ")).includes("DOI:\"10.1234/xyz\"")) throw new Error("no doi in query: " + url);
      return new Response(JSON.stringify({ resultList: { result: [{ pmcid: 'PMC1', doi: '10.1234/XYZ' }] } }));
    }
    return new Response(xml);
  });
  const res = await fullTextExcerpts([], f as any, 5, ["10.1234/xyz"]);
  expect(res['doi:10.1234/xyz']).toMatch(/^Results: Grip strength/);
});
