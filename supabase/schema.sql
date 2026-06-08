-- ──────────────────────────────────────────────────────────────────────────────
-- Fibratur — Schema da tabela licitacoes (v2 — com campos de importação BLL)
-- Execute este script no SQL Editor do seu projeto Supabase
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.licitacoes (
  id               uuid primary key default gen_random_uuid(),

  -- Origem e coleta
  data_coleta      date,
  portal           text not null,                         -- ex: "BLL Compras"
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Identificação do órgão
  orgao            text,
  uf               char(2),
  municipio        text,

  -- Identificação do processo
  num_edital       text,                                  -- ex: "019/2026PERP"
  numero_processo  text,                                  -- ex: "103/2026"

  -- Características da licitação
  objeto           text,
  modalidade       text,
  tipo_contrato    text,                                  -- ex: "Registro de Preço"
  fase_atual       text,                                  -- ex: "Recepção de Propostas"
  situacao         text,                                  -- Aberta, Encerrada, Suspensa...
  tipo_lance       text,                                  -- ex: "Menor Lance"
  modo_disputa     text,                                  -- ex: "Aberto"
  exclusivo_me_epp text,                                  -- "Sim" / "Não"
  exclusivo_regional text,                               -- "Sim" / "Não"
  validade_proposta text,                                -- ex: "12 meses"
  valor_estimado   text,                                  -- ex: "R$ 250.000,00"

  -- Datas (armazenadas como text para preservar o formato dd/mm/aaaa hh:mm do portal)
  data_publicacao        text,                           -- Data de publicação
  data_inicio_propostas  text,                           -- Início recebimento propostas
  data_fim_propostas     text,                           -- *** Fim recebimento propostas ***
  data_sessao            text,                           -- Data/hora da sessão de disputa
  data_disputa           date,                           -- Campo legado (data só, sem hora)
  prazo_impugnacao       text,                           -- Prazo final de impugnação
  prazo_esclarecimentos  text,                           -- Prazo final de esclarecimentos

  -- Links de acesso
  link_licitacao   text,
  link_edital      text,

  -- Classificação e palavras-chave
  trecho_encontrado text,
  categoria        text,                                  -- agenciamento, passagens...
  palavras_chave   text[],                               -- array de keywords encontradas
  arquivos         jsonb default '[]'::jsonb,            -- [{nome, criado_em, url}]

  -- Controle interno
  importado_manualmente boolean not null default false,  -- true = importado via link BLL
  relevante        boolean not null default false,
  observacoes      text,
  status_triagem   text not null default 'novo'          -- novo, alterado, pendente_analise, relevante, descartado, analisado
);

-- ─── ÍNDICES ──────────────────────────────────────────────────────────────────
create index if not exists idx_licitacoes_portal                on public.licitacoes (portal);
create index if not exists idx_licitacoes_uf                    on public.licitacoes (uf);
create index if not exists idx_licitacoes_categoria             on public.licitacoes (categoria);
create index if not exists idx_licitacoes_situacao              on public.licitacoes (situacao);
create index if not exists idx_licitacoes_status_triagem        on public.licitacoes (status_triagem);
create index if not exists idx_licitacoes_relevante             on public.licitacoes (relevante);
create index if not exists idx_licitacoes_data_coleta           on public.licitacoes (data_coleta desc);
create index if not exists idx_licitacoes_importado_manualmente on public.licitacoes (importado_manualmente);

-- ─── TRIGGER: atualiza updated_at automaticamente ─────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.licitacoes;
create trigger set_updated_at
  before update on public.licitacoes
  for each row execute procedure public.handle_updated_at();

-- ─── RLS (Row Level Security) ─────────────────────────────────────────────────
alter table public.licitacoes enable row level security;

create policy "Acesso interno total" on public.licitacoes
  for all
  using (true)
  with check (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRATION — Se já tiver a tabela criada com o schema antigo, rode apenas isso:
-- ══════════════════════════════════════════════════════════════════════════════
/*
alter table public.licitacoes
  add column if not exists num_edital             text,
  add column if not exists tipo_contrato          text,
  add column if not exists fase_atual             text,
  add column if not exists tipo_lance             text,
  add column if not exists modo_disputa           text,
  add column if not exists exclusivo_me_epp       text,
  add column if not exists exclusivo_regional     text,
  add column if not exists validade_proposta      text,
  add column if not exists valor_estimado         text,
  add column if not exists data_publicacao        text,
  add column if not exists data_inicio_propostas  text,
  add column if not exists data_fim_propostas     text,
  add column if not exists data_sessao            text,
  add column if not exists prazo_impugnacao       text,
  add column if not exists prazo_esclarecimentos  text,
  add column if not exists palavras_chave         text[],
  add column if not exists arquivos               jsonb default '[]'::jsonb,
  add column if not exists importado_manualmente  boolean not null default false;
*/
