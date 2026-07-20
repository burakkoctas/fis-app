-- Supabase SQL editor'da bunu çalıştır (Project > SQL Editor > New query)

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  date date,
  time text,
  priority text default 'med',
  done boolean default false,
  created_at timestamptz default now()
);

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  done_dates jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table tasks enable row level security;
alter table habits enable row level security;

create policy "kendi görevlerin" on tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "kendi alışkanlıkların" on habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime senkron için (telefon <-> tarayıcı anlık güncelleme):
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table habits;

-- Alışkanlıklara saat özelliği (zaten tablo varsa sadece kolonu ekler):
alter table habits add column if not exists time text;

