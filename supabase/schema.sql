-- Run this in the Supabase SQL Editor for your project.
create table if not exists public.vocabulary (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  german text not null,
  english text not null,
  topic text not null default 'My vocabulary',
  type text,
  plural text,
  example text,
  example_translation text,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.word_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id text not null,
  due_at timestamptz not null default now(),
  interval_days integer not null default 0,
  correct_count integer not null default 0,
  last_correct boolean,
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id),
  foreign key (user_id, word_id) references public.vocabulary(user_id, id) on delete cascade
);

alter table public.vocabulary enable row level security;
alter table public.word_progress enable row level security;
create policy "Users manage their own vocabulary" on public.vocabulary for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own progress" on public.word_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
