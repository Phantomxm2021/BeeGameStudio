alter table public.beegame_resource_processing_items
  add column if not exists batch_id text,
  add column if not exists batch_receipt_id text;

comment on column public.beegame_resource_processing_items.batch_id is
  'Stable durable identity of the semantic batch currently processing this item.';

comment on column public.beegame_resource_processing_items.batch_receipt_id is
  'Accepted batch acknowledgement shared by all items completed from one provider call.';
