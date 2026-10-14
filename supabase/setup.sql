-- Day Tracker: push reminders (run in Supabase → SQL Editor; safe to run again)

-- 0. Tasks get a start time (due_time is the deadline)
alter table public.tasks add column if not exists start_time time;

-- 1. Devices that receive push notifications (one row per browser / installed app)
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'Asia/Kolkata',
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Which reminders were already sent, so each one goes out only once
create table if not exists public.reminder_log (
  task_id text not null,
  stage   text not null,          -- start_soon | start | due_soon | late
  due_at  timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, stage, due_at)
);
alter table public.reminder_log enable row level security;  -- no policies: only the server can touch it

-- 3. Reminders that should go out right now (tasks not done yet):
--    start_soon = 15 min before start, start = at start,
--    due_soon = 15 min before deadline, late = 1 min after the deadline passed
drop function if exists public.due_reminders();
create function public.due_reminders()
returns table (task_id text, user_id uuid, title text, category text, at_time text, event_at timestamptz, stage text)
language sql security definer set search_path = public as $$
  with tz as (
    select distinct on (p.user_id) p.user_id, p.tz
    from push_subscriptions p order by p.user_id, p.updated_at desc
  ), t as (
    select t.id::text as task_id, t.user_id, t.title, t.category, t.task_date,
           t.start_time::time as st, t.due_time::time as dt, tz.tz
    from tasks t join tz on tz.user_id = t.user_id
    where not t.done and (t.start_time is not null or t.due_time is not null)
      and t.task_date between current_date - 2 and current_date + 2
  ), ev as (
    select t.task_id, t.user_id, t.title, t.category, s.stage,
           left((case when s.field = 'start' then t.st else t.dt end)::text, 5) as at_time,
           (t.task_date + case when s.field = 'start' then t.st else t.dt end) at time zone t.tz as event_at,
           s.off_min
    from t cross join (values ('start_soon', 'start', -15), ('start', 'start', 0),
                              ('due_soon', 'due', -15), ('late', 'due', 1)) as s(stage, field, off_min)
    where (s.field = 'start' and t.st is not null) or (s.field = 'due' and t.dt is not null)
  )
  select ev.task_id, ev.user_id, ev.title, ev.category, ev.at_time, ev.event_at, ev.stage
  from ev
  where now() >= ev.event_at + make_interval(mins => ev.off_min)
    and now() <  ev.event_at + make_interval(mins => ev.off_min) + interval '20 minutes'
    and not exists (select 1 from reminder_log r
                    where r.task_id = ev.task_id and r.stage = ev.stage and r.due_at = ev.event_at)
$$;
revoke all on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;

-- 4. Scheduler extensions (the every-minute job itself is in your private keys file,
--    because it contains a secret)
create extension if not exists pg_cron;
create extension if not exists pg_net;
