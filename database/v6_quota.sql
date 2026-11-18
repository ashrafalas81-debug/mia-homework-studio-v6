-- MIA Homework Studio v6: daily limits per student and per job kind (research, deck, edit).
begin;
create table if not exists public.mia_daily_kind_quota(user_id uuid not null references auth.users(id) on delete cascade,day date not null,kind text not null,requests integer not null,primary key(user_id,day,kind));
alter table public.mia_daily_kind_quota enable row level security;
revoke all on public.mia_daily_kind_quota from anon,authenticated;
grant all on public.mia_daily_kind_quota to service_role;
create or replace function public.mia_take_kind_quota(user_uuid uuid,kind text,daily_limit integer) returns integer language plpgsql security invoker set search_path='' as $$declare n integer;begin if daily_limit<=0 then return null;end if;insert into public.mia_daily_kind_quota values(user_uuid,current_date,kind,1) on conflict(user_id,day,kind) do update set requests=public.mia_daily_kind_quota.requests+1 where public.mia_daily_kind_quota.requests<daily_limit returning requests into n;return n;end;$$;
revoke all on function public.mia_take_kind_quota(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.mia_take_kind_quota(uuid,text,integer) to service_role;
commit;
