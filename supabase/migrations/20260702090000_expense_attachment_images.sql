create index if not exists attachments_uploaded_by_user_id_idx
  on public.attachments (uploaded_by_user_id);

alter table public.attachments
  drop constraint if exists attachments_image_type_check;

alter table public.attachments
  add constraint attachments_image_type_check
  check (file_type is null or file_type like 'image/%');

alter table public.attachments
  drop constraint if exists attachments_image_size_check;

alter table public.attachments
  add constraint attachments_image_size_check
  check (file_size is null or file_size <= 10485760);
