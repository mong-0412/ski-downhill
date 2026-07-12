-- Run this in Supabase SQL Editor after the initial leaderboard table exists.
-- It keeps only the best score per nickname and exposes a constrained RPC for score submission.

begin;

drop index if exists public.leaderboard_nickname_unique_idx;

update public.leaderboard
set nickname = left(trim(regexp_replace(coalesce(nickname, ''), '[[:space:]]+', ' ', 'g')), 12)
where nickname is distinct from left(trim(regexp_replace(coalesce(nickname, ''), '[[:space:]]+', ' ', 'g')), 12);

update public.leaderboard
set nickname = '스키어'
where nickname = '';

with ranked as (
  select
    id,
    row_number() over (
      partition by nickname
      order by score desc, created_at asc, id asc
    ) as row_number
  from public.leaderboard
)
delete from public.leaderboard as leaderboard
using ranked
where leaderboard.id = ranked.id
  and ranked.row_number > 1;

create unique index if not exists leaderboard_nickname_unique_idx
on public.leaderboard (nickname);

create or replace function public.submit_leaderboard_score(
  p_nickname text,
  p_score integer,
  p_distance integer default 0,
  p_bonus integer default 0
)
returns table (
  nickname text,
  score integer,
  distance integer,
  bonus integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := left(trim(regexp_replace(coalesce(p_nickname, ''), '[[:space:]]+', ' ', 'g')), 12);
  v_score integer := coalesce(p_score, 0);
  v_distance integer := coalesce(p_distance, 0);
  v_bonus integer := coalesce(p_bonus, 0);
begin
  if v_nickname = '' then
    v_nickname := '스키어';
  end if;

  if v_score < 1 or v_score > 999999 then
    raise exception 'Invalid score' using errcode = '22023';
  end if;

  if v_distance < 0 or v_distance > 999999 then
    raise exception 'Invalid distance' using errcode = '22023';
  end if;

  if v_bonus < 0 or v_bonus > 999999 then
    raise exception 'Invalid bonus' using errcode = '22023';
  end if;

  insert into public.leaderboard (nickname, score, distance, bonus, created_at)
  values (v_nickname, v_score, v_distance, v_bonus, now())
  on conflict (nickname) do update
    set score = excluded.score,
        distance = excluded.distance,
        bonus = excluded.bonus,
        created_at = now()
    where excluded.score > leaderboard.score;

  return query
  select
    leaderboard.nickname,
    leaderboard.score,
    leaderboard.distance,
    leaderboard.bonus,
    leaderboard.created_at
  from public.leaderboard
  order by leaderboard.score desc, leaderboard.created_at asc
  limit 10;
end;
$$;

revoke all on function public.submit_leaderboard_score(text, integer, integer, integer) from public;
grant execute on function public.submit_leaderboard_score(text, integer, integer, integer) to anon;

commit;
