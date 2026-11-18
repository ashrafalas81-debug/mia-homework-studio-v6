import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { it, expect, vi } from 'vitest';
import { z } from 'zod';
import { reservePaidBudget, route, type Env, type BudgetDatabase } from '../server/ai';

function ledger() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('drizzle/0000_ai_budget.sql','utf8'));
  const binding = {prepare(sql: string) {return {bind(...args: any[]) {return {async first() {return db.prepare(sql).get(...args) || null;}};}};}} as BudgetDatabase;
  return {db, binding};
}
function env(DB: BudgetDatabase): Env {return {DB,OPENROUTER_MODEL:'z-ai/glm-5.3-flash',GROQ_API_KEY:'test',OPENROUTER_API_KEY:'test',OPENROUTER_ENABLED:'true',OWNER_PAID_ENABLED:'true',PAID_GLOBAL_CAP_USD:'0.01'};}
const schema=z.object({answer:z.string()}).strict();
const metadata=()=>new Response(JSON.stringify({data:{id:'z-ai/glm-5.3-flash',endpoints:[{status:0,supported_parameters:['structured_outputs','response_format','max_tokens','temperature'],pricing:{prompt:'0.0000001',completion:'0.0000002'}},{status:0,supported_parameters:['max_tokens'],pricing:{prompt:'0.00000001',completion:'0.00000001'}}]}}));
const answer=()=>new Response(JSON.stringify({choices:[{message:{content:'{"answer":"ok"}'}}],usage:{prompt_tokens:20,completion_tokens:10}}));
it('reserves budget atomically across concurrent requests and new connections, with no resets', async()=>{
  const {db,binding}=ledger();
  const results=await Promise.allSettled(Array.from({length:10},()=>reservePaidBudget(env(binding),'owner',0.003)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
  expect(db.prepare('SELECT reserved_microusd FROM mia_ai_budget').get()?.reserved_microusd).toBe(9000);
  await expect(reservePaidBudget(env(binding),'owner',0.002)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
  db.close();
});
it('routes heavy operations to the configured GLM with owner authorization even for saved projects',async()=>{
  const {db,binding}=ledger();const f=vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(answer());
  const result=await route(env(binding),schema,'Reply as JSON','Task',100,false,'owner',undefined,f,true);
  expect(result.provider).toBe('openrouter');expect(result.model).toBe('z-ai/glm-5.3-flash');
  expect(f.mock.calls[1][0]).toContain('openrouter.ai/api/v1/chat/completions');
  const body=JSON.parse(f.mock.calls[1][1].body);expect(body.model).toBe('z-ai/glm-5.3-flash');
  expect(body.provider.max_price.prompt).toBeCloseTo(0.1);expect(body.stream).toBe(false);
  db.close();
});
it('uses one paid fallback when free chat is rate limited',async()=>{
  const {db,binding}=ledger();const f=vi.fn().mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(metadata()).mockResolvedValueOnce(answer());
  expect((await route(env(binding),schema,'','',100,false,'owner',undefined,f)).provider).toBe('openrouter');
  expect(f).toHaveBeenCalledTimes(3);db.close();
});
it('never sends a completion when the durable cap is exhausted',async()=>{
  const {db,binding}=ledger();const f=vi.fn().mockResolvedValueOnce(metadata());
  await expect(route({...env(binding),GROQ_API_KEY:undefined,PAID_GLOBAL_CAP_USD:'0'},schema,'','',100,false,'owner',undefined,f,true)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
  expect(f).toHaveBeenCalledTimes(1);db.close();
});
it('distinguishes exhausted provider credit without retrying or falling back',async()=>{
  const {db,binding}=ledger();const f=vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response('',{status:402}));
  await expect(route(env(binding),schema,'','',100,false,'owner',undefined,f,true)).rejects.toMatchObject({code:'PROVIDER_CREDIT'});
  expect(f).toHaveBeenCalledTimes(2);db.close();
});
it('fails closed when a database is unavailable',async()=>{
  const broken={prepare(){throw new Error('offline')}} as BudgetDatabase;
  await expect(reservePaidBudget(env(broken),'owner',0.001)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
});
it('moves to the next paid model when the first one is down, without touching budget errors',async()=>{
  const {db,binding}=ledger();
  const f=vi.fn(async(u:any,init?:any)=>{
    const url=String(u);
    if(url.includes('/models/')&&url.includes('glm-5.3-flash'))return new Response('',{status:404});
    if(url.includes('/models/'))return new Response(JSON.stringify({data:{id:url.split('/models/')[1].replace('/endpoints',''),endpoints:[{status:0,supported_parameters:['structured_outputs','response_format','max_tokens','temperature'],pricing:{prompt:'0.0000001',completion:'0.0000002'}}]}}));
    return answer();
  });
  const r=await route({...env(binding),PAID_GLOBAL_CAP_USD:'1',OPENROUTER_FAST_MODEL:'google/gemini-test',OPENROUTER_BACKUP_MODELS:'qwen/qwen-test'},schema,'','',100,false,'owner',undefined,f as any,true);
  expect(r.model).toBe('google/gemini-test');
  db.close();
});

it('falls back after a completion transport timeout', async () => {
  const {db,binding}=ledger();
  const f=vi.fn().mockResolvedValueOnce(metadata())
    .mockRejectedValueOnce(new DOMException('Timed out','TimeoutError'))
    .mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'google/gemini-test',endpoints:[{status:0,supported_parameters:['response_format','max_tokens','temperature'],pricing:{prompt:'0.0000001',completion:'0.0000002'}}]}})))
    .mockResolvedValueOnce(answer());
  const r=await route({...env(binding),PAID_GLOBAL_CAP_USD:'1',OPENROUTER_FAST_MODEL:'google/gemini-test'},schema,'','',100,false,'owner',undefined,f,true);
  expect(r.model).toBe('google/gemini-test');
  db.close();
});

it('falls back after a model metadata transport timeout', async () => {
  const {db,binding}=ledger();
  const f=vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response(JSON.stringify({data:{id:'google/gemini-test',endpoints:[{status:0,supported_parameters:['response_format','max_tokens','temperature'],pricing:{prompt:'0.0000001',completion:'0.0000002'}}]}})))
    .mockResolvedValueOnce(answer());
  const r=await route({...env(binding),PAID_GLOBAL_CAP_USD:'1',OPENROUTER_FAST_MODEL:'google/gemini-test'},schema,'','',100,false,'owner',undefined,f,true);
  expect(r.model).toBe('google/gemini-test');
  db.close();
});

it('preserves price ceilings during the relaxed provider retry',async()=>{
  const {db,binding}=ledger();
  const f=vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response('No endpoints found',{status:404})).mockResolvedValueOnce(answer());
  await route({...env(binding),PAID_GLOBAL_CAP_USD:'1'},schema,'','',100,false,'owner',undefined,f,true);
  const first=JSON.parse(f.mock.calls[1][1].body), retry=JSON.parse(f.mock.calls[2][1].body);
  expect(retry.provider.max_price).toEqual(first.provider.max_price);
  expect(retry.response_format.type).toBe('json_object');
  db.close();
});

it('reserves expanded output retries before sending another paid completion',async()=>{
  const {db,binding}=ledger();
  const f=vi.fn().mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{'}}]})))
    .mockResolvedValueOnce(answer());
  const result=await route({...env(binding),PAID_GLOBAL_CAP_USD:'1'},schema,'','',100,false,'owner',undefined,f,true);
  expect(f).toHaveBeenCalledTimes(3);
  expect(db.prepare('SELECT requests FROM mia_ai_budget').get()?.requests).toBe(2);
  expect('reservedCostUsd' in result && result.reservedCostUsd).toBeGreaterThan(0.00005);
  db.close();
});

it('blocks an expanded retry when the operation cap cannot cover both attempts',async()=>{
  const {db,binding}=ledger();
  const f=vi.fn().mockResolvedValueOnce(metadata())
    .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{'}}]})));
  await expect(route({...env(binding),PAID_GLOBAL_CAP_USD:'1',GROQ_API_KEY:undefined,PAID_MAX_OPERATION_USD:'0.0001'},schema,'','',100,false,'owner',undefined,f,true)).rejects.toMatchObject({code:'BUDGET_EXHAUSTED'});
  expect(f).toHaveBeenCalledTimes(2);
  db.close();
});

it('tries a lower priced model when the first estimate exceeds the operation limit',async()=>{
  const {db,binding}=ledger();
  const metadataFor=(id:string,price:string)=>new Response(JSON.stringify({data:{id,endpoints:[{status:0,supported_parameters:['response_format','max_tokens','temperature'],pricing:{prompt:price,completion:price}}]}}));
  const f=vi.fn().mockResolvedValueOnce(metadataFor('z-ai/glm-5.3-flash','0.001'))
    .mockResolvedValueOnce(metadataFor('google/gemini-test','0.00000001')).mockResolvedValueOnce(answer());
  const r=await route({...env(binding),PAID_GLOBAL_CAP_USD:'1',PAID_MAX_OPERATION_USD:'0.01',OPENROUTER_FAST_MODEL:'google/gemini-test'},schema,'','',100,false,'owner',undefined,f,true);
  expect(r.model).toBe('google/gemini-test');
  expect(f).toHaveBeenCalledTimes(3);
  db.close();
});

it('continues text editing on the free provider when the global paid budget is full', async () => {
  const {db,binding}=ledger();
  const f=vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(answer());
  const r=await route({...env(binding),PAID_GLOBAL_CAP_USD:'0'},schema,'','',100,false,'owner',undefined,f,true);
  expect(r.provider).toBe('groq');
  expect(f.mock.calls[1][0]).toContain('api.groq.com');
  db.close();
});

