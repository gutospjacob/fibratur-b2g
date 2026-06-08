create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text,
  base_url text,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenders (
  id uuid primary key default gen_random_uuid(),
  unique_key text not null unique,
  source_id uuid references public.sources(id),
  source_name text,
  portal text,
  orgao text,
  cnpj_orgao text,
  municipio text,
  uf char(2),
  modalidade text,
  numero_edital text,
  numero_processo text,
  objeto text,
  categoria text,
  data_publicacao timestamptz,
  data_atualizacao timestamptz,
  data_disputa timestamptz,
  prazo_proposta timestamptz,
  valor_estimado numeric,
  criterio_julgamento text,
  link_licitacao text,
  link_edital text,
  status_licitacao text,
  status_interno text,
  relevancia int,
  classificacao_ia text,
  classificacao_financeira text,
  resumo text,
  motivo_classificacao text,
  pontos_atencao jsonb not null default '[]'::jsonb,
  documentos_exigidos jsonb not null default '[]'::jsonb,
  raw_data jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references public.tenders(id) on delete cascade,
  document_type text,
  title text,
  url text,
  file_path text,
  text_content text,
  created_at timestamptz not null default now()
);

create table if not exists public.tender_checks (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references public.tenders(id) on delete cascade,
  source_name text,
  checked_at timestamptz not null default now(),
  changes_detected jsonb not null default '[]'::jsonb,
  raw_response jsonb
);

create table if not exists public.tender_classifications (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references public.tenders(id) on delete cascade,
  classification text,
  relevance_score int,
  financial_status text,
  summary text,
  reason text,
  attention_points jsonb not null default '[]'::jsonb,
  ai_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid references public.tenders(id) on delete cascade,
  channel text,
  recipient text,
  status text,
  sent_at timestamptz,
  error_message text
);

create index if not exists idx_tenders_unique_key on public.tenders(unique_key);
create index if not exists idx_tenders_portal on public.tenders(portal);
create index if not exists idx_tenders_uf on public.tenders(uf);
create index if not exists idx_tenders_categoria on public.tenders(categoria);
create index if not exists idx_tenders_status_interno on public.tenders(status_interno);
create index if not exists idx_tenders_relevancia on public.tenders(relevancia desc);
create index if not exists idx_tenders_prazo on public.tenders(prazo_proposta);

insert into public.sources (name, type, base_url, enabled)
values
  ('PNCP', 'api', 'https://pncp.gov.br/api/consulta/v1', true),
  ('Compras.gov', 'api', 'https://dadosabertos.compras.gov.br', false)
on conflict (name) do update
set type = excluded.type,
    base_url = excluded.base_url,
    updated_at = now();
