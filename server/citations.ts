import type { Source } from '../shared/model';

// Resolve only identifiers that unambiguously name a source we actually fetched.
// Never infer a reference from a claim or replace an unknown ID with a nearby one.
export function normalizeCitations(data: any, sources: Source[]) {
  const eligible = sources.filter(s => s.accessLevel === 'abstract' && s.abstract.trim() && !s.retracted);
  const aliases = new Map<string, string>();
  function key(id: string) { return id.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, 'doi:').replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/i, 'pmid:$1').replace(/^PMID\s*[:=]?\s*/i, 'pmid:').toLowerCase(); }
  for (const s of eligible) {
    for (const id of [s.id, s.pmid, s.pmid ? 'pmid:'+s.pmid : null, s.doi, s.doi ? 'doi:'+s.doi : null]) if (id) aliases.set(key(id), s.id);
  }
  const invalid = new Set<string>();
  function walk(node: any) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    for (const [name, value] of Object.entries(node)) {
      if (name === 'sourceIds' && Array.isArray(value)) node[name] = [...new Set(value.map(id => {const canonical = aliases.get(key(String(id))); if (!canonical) invalid.add(String(id)); return canonical || id;}))];
      else walk(value);
    }
  }
  walk(data);
  return [...invalid];
}
