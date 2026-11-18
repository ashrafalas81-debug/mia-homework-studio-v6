import { recommendEvidence, type Source } from '../shared/model';
import {it,expect,vi,afterEach} from 'vitest';
import {search,expandMedicalQuery} from '../server/research';
afterEach(()=>vi.unstubAllGlobals());
it('removes deliverable words and offers an anatomical query without losing the topic',()=>{
 const qs=expandMedicalQuery('Dermatomes Myotomes clinical anatomy review scientific references');
 expect(qs).toHaveLength(3);
 expect(qs[1]).not.toMatch(/scientific|references|review/);
 expect(qs[2]).toContain('dermatome* OR myotome*');
});
it('tries a bounded broader real query after zero results without repeating unavailable NCBI',async()=>{
 const f=vi.fn(async(url:any)=>{
  const u=String(url);
  if(u.includes('eutils.ncbi'))return new Response('',{status:503});
  const broadened=new URL(u).searchParams.get('query')?.includes('neurological examination');
  return Response.json({resultList:{result:broadened?[{source:'MED',id:'123456',title:'Dermatomal examination',abstractText:'A real API-shaped abstract used only as a test fixture.',pubYear:'2024'}]:[]}});
 });
 vi.stubGlobal('fetch',f);
 const r=await search('Dermatomes Myotomes clinical anatomy review scientific references','pubmed','mixed');
 expect(r.sources).toHaveLength(1);expect(r.sources[0].accessLevel).toBe('abstract');
 expect(f.mock.calls.filter(([u])=>String(u).includes('eutils.ncbi'))).toHaveLength(1);
 expect(f).toHaveBeenCalledTimes(5);expect(r.appliedQueries).toHaveLength(3);
});
it('returns truthful empty results when bounded query alternatives all find nothing',async()=>{
 const f=vi.fn(async(u:any)=>String(u).includes('eutils.ncbi')?new Response('',{status:503}):Response.json({resultList:{result:[]}}));
 vi.stubGlobal('fetch',f);
 const r=await search('Dermatomes Myotomes review scientific references','pubmed','mixed');
 expect(r.sources).toEqual([]);expect(f.mock.calls.length).toBeLessThanOrEqual(5);
});

it('does not select an unrelated high-level trial just because its abstract contains generic research words',()=>{
 const base={abstract:'Clinical scientific research and anatomy review with rehabilitation outcomes.',publicationTypes:['Randomized Controlled Trial'],accessLevel:'abstract',retracted:false,concerns:[]} as any;
 const irrelevant={...base,id:'wrong',title:'Electroacupuncture and glucose control'};
 const relevant={...base,id:'right',title:'Dermatome mapping in neurological assessment'};
 const rec=recommendEvidence([irrelevant,relevant],'Dermatomes Myotomes clinical anatomy review scientific references');
 expect(rec.selectedIds).toEqual(['right']);expect(rec.rationale.wrong).toContain('no topic-term overlap');
});
