-- AGROTRIAL Finanzas: esquema inicial para sincronización centralizada.
-- Aplicar en un proyecto Supabase nuevo. No contiene credenciales.
begin;

create table if not exists public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'contabilidad'
    check (role in ('admin', 'administracion', 'contabilidad')),
  active boolean not null default false,
  avatar text not null default '👤',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_records (
  collection text not null
    check (collection in ('ingresos', 'egresos', 'gastosfijos', 'sugerencias', 'meta')),
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists app_records_collection_updated_idx
  on public.app_records (collection, updated_at desc);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.app_profiles as p
  where p.id = (select auth.uid())
    and p.active = true
  limit 1
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_profiles_set_updated_at on public.app_profiles;
create trigger app_profiles_set_updated_at
before update on public.app_profiles
for each row execute function public.set_updated_at();

drop trigger if exists app_records_set_updated_at on public.app_records;
create trigger app_records_set_updated_at
before update on public.app_records
for each row execute function public.set_updated_at();

-- Los usuarios nuevos quedan inactivos hasta que un administrador los habilite.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_profiles (id, email, name, role, active, avatar)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    'contabilidad',
    false,
    coalesce(new.raw_user_meta_data ->> 'avatar', '👤')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_agrotrial on auth.users;
create trigger on_auth_user_created_agrotrial
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.app_profiles enable row level security;
alter table public.app_records enable row level security;

revoke all on public.app_profiles from anon, authenticated;
revoke all on public.app_records from anon, authenticated;
grant select, update on public.app_profiles to authenticated;
grant select, insert, update, delete on public.app_records to authenticated;

drop policy if exists "profile_read_self_or_admin" on public.app_profiles;
create policy "profile_read_self_or_admin"
on public.app_profiles for select to authenticated
using (id = (select auth.uid()) or (select public.current_app_role()) = 'admin');

drop policy if exists "profile_update_admin_only" on public.app_profiles;
create policy "profile_update_admin_only"
on public.app_profiles for update to authenticated
using ((select public.current_app_role()) = 'admin')
with check ((select public.current_app_role()) = 'admin');

-- Registros financieros: usuarios activos pueden leer; administración registra,
-- contabilidad registra; solo admin puede borrar registros.
drop policy if exists "finance_read_active_users" on public.app_records;
create policy "finance_read_active_users"
on public.app_records for select to authenticated
using ((select public.current_app_role()) is not null);

drop policy if exists "finance_insert_authorized" on public.app_records;
create policy "finance_insert_authorized"
on public.app_records for insert to authenticated
with check (
  (
    collection in ('ingresos', 'egresos', 'gastosfijos')
    and (select public.current_app_role()) in ('admin', 'contabilidad')
  )
  or (
    collection = 'sugerencias'
    and (select public.current_app_role()) is not null
  )
  or (
    collection = 'meta'
    and (select public.current_app_role()) = 'admin'
  )
);

drop policy if exists "finance_update_authorized" on public.app_records;
create policy "finance_update_authorized"
on public.app_records for update to authenticated
using (
  (
    collection in ('ingresos', 'egresos', 'gastosfijos')
    and (select public.current_app_role()) in ('admin', 'contabilidad')
  )
  or (
    collection = 'sugerencias'
    and (select public.current_app_role()) = 'admin'
  )
  or (
    collection = 'meta'
    and (select public.current_app_role()) = 'admin'
  )
)
with check (
  (
    collection in ('ingresos', 'egresos', 'gastosfijos')
    and (select public.current_app_role()) in ('admin', 'contabilidad')
  )
  or (
    collection = 'sugerencias'
    and (select public.current_app_role()) = 'admin'
  )
  or (
    collection = 'meta'
    and (select public.current_app_role()) = 'admin'
  )
);

drop policy if exists "finance_delete_admin_only" on public.app_records;
create policy "finance_delete_admin_only"
on public.app_records for delete to authenticated
using (
  (select public.current_app_role()) = 'admin'
  and collection <> 'meta'
);

-- Habilitar eventos Realtime para cambios en los registros, si la publicación existe
-- y la tabla aún no está incluida. La app podrá suscribirse después de configurar el proyecto.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'app_records'
     ) then
    alter publication supabase_realtime add table public.app_records;
  end if;
end $$;

commit;
