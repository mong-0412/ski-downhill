-- Adds an atomic score submission RPC that also reports whether this write
-- strictly replaced the leaderboard's previous first-place score.

begin;

create or replace function public.submit_leaderboard_score_v2(
  p_nickname text,
  p_score integer,
  p_distance integer default 0,
  p_bonus integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := left(trim(regexp_replace(coalesce(p_nickname, ''), '[[:space:]]+', ' ', 'g')), 12);
  v_score integer := coalesce(p_score, 0);
  v_distance integer := coalesce(p_distance, 0);
  v_bonus integer := coalesce(p_bonus, 0);
  v_previous_top integer := 0;
  v_score_changed boolean := false;
  v_entries jsonb := '[]'::jsonb;
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

  -- Serialize every leaderboard writer while the old top score and this write
  -- are evaluated, so simultaneous submissions cannot both claim first place.
  lock table public.leaderboard in share row exclusive mode;

  select coalesce(max(leaderboard.score), 0)
  into v_previous_top
  from public.leaderboard as leaderboard;

  with saved as (
    insert into public.leaderboard (nickname, score, distance, bonus, created_at)
    values (v_nickname, v_score, v_distance, v_bonus, now())
    on conflict (nickname) do update
      set score = excluded.score,
          distance = excluded.distance,
          bonus = excluded.bonus,
          created_at = now()
      where excluded.score > leaderboard.score
    returning true as changed
  )
  select exists(select 1 from saved)
  into v_score_changed;

  select coalesce(
    jsonb_agg(to_jsonb(top_entries) order by top_entries.score desc, top_entries.created_at asc),
    '[]'::jsonb
  )
  into v_entries
  from (
    select
      leaderboard.nickname,
      leaderboard.score,
      leaderboard.distance,
      leaderboard.bonus,
      leaderboard.created_at
    from public.leaderboard as leaderboard
    order by leaderboard.score desc, leaderboard.created_at asc
    limit 10
  ) as top_entries;

  return jsonb_build_object(
    'entries', v_entries,
    'isNewFirstPlace', v_score_changed and v_score > v_previous_top
  );
end;
$$;

revoke all on function public.submit_leaderboard_score_v2(text, integer, integer, integer) from public;
grant execute on function public.submit_leaderboard_score_v2(text, integer, integer, integer) to anon;

commit;
