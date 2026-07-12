# 씽씽 스키

Mobile portrait skiing game with a Supabase-backed leaderboard.

## Local

1. Create `.env.local`:

   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-public-anon-key
   ```

2. Start the local server:

   ```sh
   npm start
   ```

## Vercel

- Build command: `npm run build`
- Output directory: `dist`
- Environment variables:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

## Supabase

Run `supabase/leaderboard-best-score.sql` in the Supabase SQL Editor after creating the `public.leaderboard` table. It cleans duplicate nicknames, enforces one row per nickname, and adds the score submission RPC used by the game.

Then run `supabase/leaderboard-first-place-reward.sql`. It adds the transactional RPC that confirms whether the current submission actually replaced the first-place score before the game shows the booth prize notice.
