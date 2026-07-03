alter table public.notifications
  add column if not exists created_by uuid;

do $$
begin
  alter table public.notifications
    add constraint notifications_created_by_fkey
    foreign key (created_by)
    references public.users(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists notifications_created_by_idx
  on public.notifications (created_by);
