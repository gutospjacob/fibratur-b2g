/**
 * licitacoesService.js
 *
 * Camada de serviço para acesso à tabela `licitacoes`.
 * Quando Supabase não está configurado, usa os dados mock como fallback.
 * Para ativar o banco real: preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase'

// ─── PERSISTÊNCIA LOCAL (modo mock/offline) ───────────────────────────────────
const LOCAL_KEY        = 'fibratur:licitacoes-locais'
const BACKUP_PREFIX    = 'fibratur:backup-'
const MAX_BACKUPS_DIAS = 14   // mantém 14 dias de backups por dia
const SHADOW_KEY       = 'fibratur:shadow-ultimo'  // cópia "espelho" sempre atualizada

/** Mapeia status antigos para o novo modelo simplificado. */
const STATUS_MIGRATION = {
  pendente_analise: 'em_analise',
  relevante:        'participando',
  analisado:        'descartado',   // "Analisado" antigo virava "decisão tomada" — vira descartado por padrão; user reclassifica
  alterado:         'novo',
}
function migrarStatus(list) {
  if (!Array.isArray(list)) return list
  return list.map(l => {
    const novo = STATUS_MIGRATION[l.status_triagem]
    return novo ? { ...l, status_triagem: novo } : l
  })
}

/** Carrega licitações da chave principal, com fallback automático para o backup mais recente. */
function loadLocal() {
  const limpar = list => migrarStatus((Array.isArray(list) ? list : []).filter(l => !foraDoEscopoLocal(l)))
  // 1. Chave principal
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) return limpar(parsed)
      } catch (e) {
        console.warn('[licitacoesService] chave principal corrompida — tentando backup', e)
      }
    }
  } catch (e) { /* ignora */ }

  // 2. Shadow key (cópia atualizada a cada save)
  try {
    const shadow = localStorage.getItem(SHADOW_KEY)
    if (shadow) {
      const parsed = JSON.parse(shadow)
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.warn('[licitacoesService] usando shadow backup —', parsed.length, 'registros recuperados')
        // Restaura a chave principal com o shadow
        try { localStorage.setItem(LOCAL_KEY, shadow) } catch {}
        return limpar(parsed)
      }
    }
  } catch (e) { /* ignora */ }

  // 3. Backup mais recente (ordena por data desc)
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort().reverse()
    for (const k of keys) {
      try {
        const parsed = JSON.parse(localStorage.getItem(k))
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.warn('[licitacoesService] recuperado do backup', k, '—', parsed.length, 'registros')
          // Restaura a chave principal
          try { localStorage.setItem(LOCAL_KEY, JSON.stringify(parsed)) } catch {}
          return limpar(parsed)
        }
      } catch (e) { /* tenta próximo */ }
    }
  } catch (e) { /* ignora */ }

  return []
}

/**
 * Salva no servidor (arquivo dados.json no HD) — persistência permanente.
 * Fire-and-forget: não bloqueia a UI, erro é silencioso (localStorage é fallback).
 */
function salvarNoServidor(list) {
  if (!Array.isArray(list) || list.length === 0) return Promise.resolve()
  return fetch('/api/dados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  }).catch(() => { /* servidor indisponível — localStorage cobre */ })
}

/** Salva a chave principal + shadow + backup diário + arquivo no servidor. */
function saveLocal(list) {
  if (!Array.isArray(list)) return Promise.resolve()
  const json = JSON.stringify(list)

  // 1. Chave principal no localStorage (cache rápido)
  try { localStorage.setItem(LOCAL_KEY, json) }
  catch (e) { console.error('[licitacoesService] erro ao salvar principal:', e) }

  // 2. Shadow key (espelho — fallback se principal corromper)
  try { localStorage.setItem(SHADOW_KEY, json) } catch {}

  // 3. Backup do dia (só se houver dados)
  if (list.length > 0) {
    try {
      const hoje = new Date().toISOString().slice(0, 10)
      localStorage.setItem(BACKUP_PREFIX + hoje, json)
    } catch {}
  }

  // 5. Limpa backups antigos (mantém últimos N dias)
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort()
    if (keys.length > MAX_BACKUPS_DIAS) {
      keys.slice(0, keys.length - MAX_BACKUPS_DIAS).forEach(k => localStorage.removeItem(k))
    }
  } catch {}

  // 5. Arquivo no servidor (persistência permanente no HD)
  return salvarNoServidor(list)
}

/** Lista todos os backups disponíveis (data + qtd registros). */
export function listarBackups() {
  const out = []
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort().reverse()
    for (const k of keys) {
      try {
        const parsed = JSON.parse(localStorage.getItem(k))
        if (Array.isArray(parsed)) {
          out.push({ chave: k, data: k.replace(BACKUP_PREFIX, ''), qtd: parsed.length })
        }
      } catch {}
    }
  } catch {}
  return out
}

/** Restaura um backup específico para a chave principal. */
export function restaurarBackup(chave) {
  try {
    const raw = localStorage.getItem(chave)
    if (!raw) return { ok: false, erro: 'Backup não encontrado' }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, erro: 'Formato inválido' }
    saveLocal(parsed)
    return { ok: true, qtd: parsed.length }
  } catch (e) {
    return { ok: false, erro: e.message }
  }
}

/** Lista TODAS as chaves fibratur:* com contagem de registros. Usado pra recovery. */
export function listarTudoFibratur() {
  const out = []
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('fibratur'))
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      let qtd = 0, tipo = 'desconhecido'
      try {
        const p = JSON.parse(raw)
        if (Array.isArray(p)) { qtd = p.length; tipo = 'array' }
        else if (p && typeof p === 'object') { qtd = 1; tipo = 'objeto' }
      } catch { tipo = 'corrompido' }
      out.push({ chave: k, tamanho_bytes: raw?.length || 0, qtd, tipo })
    }
  } catch {}
  return out.sort((a, b) => b.qtd - a.qtd)
}

/** Auto-recuperação: encontra a chave fibratur com maior número de licitações válidas e restaura. */
export function autoRecover() {
  const candidatos = listarTudoFibratur()
    .filter(c => c.tipo === 'array' && c.qtd > 0)

  if (candidatos.length === 0) {
    return { ok: false, erro: 'Nenhum backup recuperável encontrado em nenhuma chave do localStorage.' }
  }

  // Pega a chave com mais registros
  const melhor = candidatos[0]
  try {
    const raw = localStorage.getItem(melhor.chave)
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { ok: false, erro: 'Chave ' + melhor.chave + ' está vazia.' }
    }
    saveLocal(parsed)
    return { ok: true, qtd: parsed.length, fonte: melhor.chave }
  } catch (e) {
    return { ok: false, erro: e.message }
  }
}

/** Diagnóstico — retorna estatísticas de todas as chaves do localStorage. */
export function diagnosticarStorage() {
  const out = { principal: 0, shadow: 0, backups: [], total_keys: 0 }
  try {
    out.total_keys = Object.keys(localStorage).length
    const principal = localStorage.getItem(LOCAL_KEY)
    out.principal = principal ? JSON.parse(principal).length : 0
    const shadow = localStorage.getItem(SHADOW_KEY)
    out.shadow = shadow ? JSON.parse(shadow).length : 0
    out.backups = listarBackups()
  } catch (e) {
    out.erro = e.message
  }
  return out
}

function upsertLocal(registro) {
  const list = loadLocal()
  const idx = list.findIndex(l => l.id === registro.id)
  if (idx >= 0) list[idx] = mergeRegistroLocal(list[idx], registro)
  else list.unshift(registro)
  return saveLocal(list)
}

/** Adiciona/atualiza várias licitações de uma vez (usado pelo import CSV). */
function valorVazio(v) {
  const s = String(v ?? "").trim()
  return v === undefined || v === null || s === "" || s === "—" || s === "â€”"
}

function textoNormalizadoLocal(v) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function chaveEstavelLicitacao(r) {
  if (!r) return ""
  if (r.pncp_key) return String(r.pncp_key)
  const raw = r.raw_data || {}
  const cnpj = String(raw?.orgaoEntidade?.cnpj || r.cnpj_orgao || "").replace(/\D/g, "")
  const ano = String(raw?.anoCompra || raw?.ano || "").replace(/\D/g, "")
  const seq = String(raw?.sequencialCompra || raw?.numero_sequencial || "").replace(/\D/g, "")
  if (cnpj && ano && seq) return ["pncp", cnpj, ano, seq].join("-")
  const texto = [
    r.id, r.unique_key, r.numero_processo, raw.numeroControlePNCP, raw.numero_controle_pncp, r.link_licitacao, r.link_edital
  ].filter(Boolean).join(" ")
  const controle = texto.match(/(\d{14})-\d+-(\d+)\/(\d{4})/)
  if (controle) return ["pncp", controle[1], controle[3], String(Number(controle[2]))].join("-")
  const url = texto.match(/editais\/(\d{14})\/(\d{4})\/(\d+)/)
  if (url) return ["pncp", url[1], url[2], String(Number(url[3]))].join("-")
  return r.id || r.unique_key || ""
}

function foraDoEscopoLocal(r) {
  const texto = textoNormalizadoLocal([
    r?.categoria, r?.modalidade, r?.tipo_contrato, r?.tipo_lance, r?.objeto, r?.resumo, r?.link_licitacao
  ].filter(Boolean).join(" "))
  return Number(r?.raw_data?.modalidadeId) === 1
    || /leilao|alienacao de bens|bens moveis inserviveis|bens imoveis|sucatas?|maior lance|sodresantoro\.com\.br\/leilao/.test(texto)
    || /nao relacionada|construcao|obra(s)? de engenharia|servicos? de engenharia|engenharia civil|reforma|ampliacao|retrofit|pavimentacao|passarela|quadra|ginasio|creche|pre-escola|escola|posto de saude|residencial|modulos? padronizados|equipamentos urbanisticos/.test(texto)
}

function mergeRegistroLocal(atual, novo) {
  const merged = { ...(atual || {}), ...(novo || {}) }
  const chave = chaveEstavelLicitacao(atual) || chaveEstavelLicitacao(novo)
  if (chave && chave.startsWith("pncp-")) merged.pncp_key = chave
  const keys = new Set([...Object.keys(atual || {}), ...Object.keys(novo || {})])
  keys.forEach(k => {
    if (valorVazio(novo?.[k]) && !valorVazio(atual?.[k])) merged[k] = atual[k]
  })

  ;[
    "status_triagem", "status_interno", "relevante", "observacoes",
    "motivo_descarte", "motivo_perda", "foi_analisada", "foi_participada",
    "analisada_em", "participou_em", "descartado_em", "perdemos_em",
    "status_historico", "categoria_descarte"
  ].forEach(k => {
    if (!valorVazio(atual?.[k])) merged[k] = atual[k]
  })

  if (atual?.raw_data || novo?.raw_data) {
    merged.raw_data = { ...(atual?.raw_data || {}), ...(novo?.raw_data || {}) }
  }
  return merged
}
function mesclarBasesLocalServidor(localData, serverData) {
  const byId = new Map()
  const localPorChave = new Map()
  ;(Array.isArray(localData) ? localData : []).forEach(l => {
    const key = chaveEstavelLicitacao(l)
    if (key) localPorChave.set(key, l)
  })
  ;(Array.isArray(serverData) ? serverData : []).forEach(s => {
    if (foraDoEscopoLocal(s)) return
    if (!s?.id) return
    const key = chaveEstavelLicitacao(s)
    if (!key) return
    const local = localPorChave.get(key)
    byId.set(key, local ? mergeRegistroLocal(local, s) : { ...s, pncp_key: key.startsWith("pncp-") ? key : s.pncp_key })
  })
  return migrarStatus(Array.from(byId.values()))
}
export function bulkUpsertLocal(registros) {
  if (!Array.isArray(registros) || registros.length === 0) return Promise.resolve()
  const list = loadLocal()
  for (const r of registros) {
    const key = chaveEstavelLicitacao(r)
    const idx = list.findIndex(l => l.id === r.id || (key && chaveEstavelLicitacao(l) === key))
    if (idx >= 0) list[idx] = mergeRegistroLocal(list[idx], r)
    else          list.unshift(r)
  }
  return saveLocal(list)
}

function patchLocal(id, patch) {
  const list = loadLocal()
  const alvo = list.find(l => l.id === id)
  const key = chaveEstavelLicitacao(alvo) || chaveEstavelLicitacao({ id })
  const idx = list.findIndex(l => l.id === id || (key && chaveEstavelLicitacao(l) === key))
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch, updated_at: new Date().toISOString() }
    return saveLocal(list)
  }
  return Promise.resolve()
}

// ─── LEITURA ──────────────────────────────────────────────────────────────────

/**
 * Busca todas as licitações.
 * Prioridade: arquivo no servidor → localStorage → mock vazio
 * Retorna { data: [], source: 'arquivo' | 'local' | 'supabase' | 'mock', error: null | Error }
 */
export async function fetchLicitacoes() {
  if (!isSupabaseConfigured) {
    // 1. Tenta carregar do servidor (arquivo dados.json — persistência permanente)
    try {
      const res = await fetch('/api/dados')
      if (res.ok) {
        const serverData = await res.json()
        if (Array.isArray(serverData) && serverData.length > 0) {
          const localData = loadLocal()
          const melhor = mesclarBasesLocalServidor(localData, serverData)
          try { localStorage.setItem(LOCAL_KEY, JSON.stringify(melhor)) } catch {}
          try { localStorage.setItem(SHADOW_KEY, JSON.stringify(melhor)) } catch {}
          if (JSON.stringify(melhor) !== JSON.stringify(serverData)) salvarNoServidor(melhor)
          console.log('[licitacoesService] Dados mesclados:', melhor.length, 'licitações')
          return { data: melhor, source: 'arquivo', error: null }
        }
      }
    } catch (e) {
      console.warn('[licitacoesService] Servidor indisponível — usando localStorage:', e.message)
    }

    // 2. Fallback: localStorage (com cascata shadow → backup diário)
    const locais = loadLocal()
    return { data: locais, source: 'local', error: null }
  }

  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .select('*')
      .order('data_coleta', { ascending: false })

    if (error) throw error
    return { data: data ?? [], source: 'supabase', error: null }
  } catch (err) {
    console.error('[licitacoesService] fetchLicitacoes:', err)
    const locais = loadLocal()
    return { data: locais, source: 'local_fallback', error: err }
  }
}

// ─── SCRAPING (chama o endpoint do servidor local) ────────────────────────────

/**
 * Acessa o endpoint /api/scrape para buscar e parsear a página do processo.
 * Retorna { ok: true, data: {...} } ou { ok: false, error: '...' }
 */
export async function scrapeBllUrl(targetUrl) {
  try {
    const endpoint = '/api/scrape?url=' + encodeURIComponent(targetUrl)
    const res = await fetch(endpoint)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, error: body.error || `Erro HTTP ${res.status}` }
    }

    const body = await res.json()
    return body // { ok: true, data: {...} } ou { ok: false, error: '...' }
  } catch (err) {
    return {
      ok: false,
      error: 'Não foi possível conectar ao servidor de scraping. Certifique-se de que o servidor está rodando (node dist/server.js ou npm run dev).'
    }
  }
}

// ─── ANÁLISE DE PDF ───────────────────────────────────────────────────────────

/**
 * Baixa e analisa o PDF do arquivo (extração + regex).
 * Retorna { ok, keywords, requisitos, trechos, datas, valores, recomendacao, preview, ... }
 */
export async function coletarLicitacoesReais({ dias = 14, paginas = 2 } = {}) {
  try {
    const endpoint = `/api/coletar?dias=${encodeURIComponent(dias)}&paginas=${encodeURIComponent(paginas)}`
    const res = await fetch(endpoint)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `Erro HTTP ${res.status}`, registros: [], fontes: body.fontes || [] }
    }
    const registros = Array.isArray(body.registros) ? body.registros : []
    if (registros.length) await bulkUpsertLocal(registros)
    return { ok: true, registros, total: registros.length, fontes: body.fontes || [] }
  } catch (err) {
    return { ok: false, error: err.message || 'Erro ao coletar licitações reais', registros: [] }
  }
}

export async function buscarArquivosPncp({ cnpj, ano, seq }) {
  try {
    const endpoint = `/api/pncp-arquivos?cnpj=${encodeURIComponent(cnpj || '')}&ano=${encodeURIComponent(ano || '')}&seq=${encodeURIComponent(seq || '')}`
    const res = await fetch(endpoint)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `Erro HTTP ${res.status}`, arquivos: [] }
    return { ok: true, arquivos: Array.isArray(body.arquivos) ? body.arquivos : [] }
  } catch (err) {
    return { ok: false, error: err.message || 'Erro ao buscar arquivos PNCP', arquivos: [] }
  }
}

export async function buscarDetalhePncp({ cnpj, ano, seq }) {
  try {
    const endpoint = `/api/pncp-detalhe?cnpj=${encodeURIComponent(cnpj || '')}&ano=${encodeURIComponent(ano || '')}&seq=${encodeURIComponent(seq || '')}`
    const res = await fetch(endpoint)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `Erro HTTP ${res.status}` }
    return { ok: true, patch: body.patch || {}, detalhe: body.detalhe || null }
  } catch (err) {
    return { ok: false, error: err.message || 'Erro ao buscar detalhe PNCP' }
  }
}

export async function updateLicitacaoPatch(id, patch) {
  if (!id || !patch || typeof patch !== 'object') return { error: new Error('Patch invalido') }
  if (!isSupabaseConfigured || String(id).startsWith('local-')) {
    await patchLocal(id, patch)
    return { error: null }
  }

  const { error } = await supabase
    .from('licitacoes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) console.error('[licitacoesService] updateLicitacaoPatch:', error)
  return { error }
}

export async function analyzePdf(fileUrl) {
  try {
    const endpoint = '/api/analyze-pdf?url=' + encodeURIComponent(fileUrl)
    const res = await fetch(endpoint)
    const body = await res.json()
    return body
  } catch (err) {
    return { ok: false, erro: 'Não foi possível conectar ao servidor.' }
  }
}

/**
 * Salva o resultado de uma análise junto com a licitação.
 * Computa automaticamente flags `tem_indices_financeiros` e `tem_pl_minimo`
 * agregando todas as análises de arquivos da mesma licitação.
 */
export async function salvarAnaliseFinanceira(id, fileUrl, analise) {
  // Carrega a licitação local (em modo mock)
  const list = loadLocal()
  let lic = list.find(l => l.id === id)

  // Em modo Supabase, busca também no banco se não está local
  if (!lic && isSupabaseConfigured) {
    try {
      const { data } = await supabase.from('licitacoes').select('*').eq('id', id).single()
      lic = data
    } catch { /* ignora */ }
  }
  if (!lic) lic = { id }

  // Mantém análises de outros arquivos da mesma licitação
  const analises = (lic.analises_pdf && typeof lic.analises_pdf === 'object') ? { ...lic.analises_pdf } : {}
  analises[fileUrl] = {
    ok: !!analise.ok,
    erro: analise.erro || null,
    indices_financeiros: analise.indices_financeiros || [],
    patrimonio_liquido:  analise.patrimonio_liquido || [],
    subcontratacao_hospedagem: analise.subcontratacao_hospedagem || null,
    paginas:             analise.paginas || 0,
    tamanho_bytes:       analise.tamanho_bytes || 0,
    tamanho_texto:       analise.tamanho_texto || 0,
    data_analise:        new Date().toISOString(),
  }

  // Recalcula flags agregadas (true se QUALQUER arquivo analisado tem critério)
  let temIndices = false, temPL = false
  let subHospedagemCritica = false
  for (const k in analises) {
    const a = analises[k]
    if (Array.isArray(a.indices_financeiros) && a.indices_financeiros.length > 0) temIndices = true
    if (Array.isArray(a.patrimonio_liquido)  && a.patrimonio_liquido.length  > 0) temPL = true
    if (a.subcontratacao_hospedagem?.nivel === 'critico') subHospedagemCritica = true
  }

  const patch = {
    analises_pdf:            analises,
    tem_indices_financeiros: temIndices,
    tem_pl_minimo:           temPL,
    tem_restricao_subcontratacao_hospedagem: subHospedagemCritica,
    analisado_em:            new Date().toISOString(),
    foi_analisada:           true,
    analisada_em:            lic.analisada_em || new Date().toISOString(),
  }

  // Persiste local
  await patchLocal(id, patch)

  // Persiste no Supabase (se configurado)
  if (isSupabaseConfigured && !String(id).startsWith('local-')) {
    try {
      const { error } = await supabase
        .from('licitacoes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) {
        // Fallback: se a coluna ainda não existe, ignora silenciosamente
        if (!/analises_pdf|tem_indices|tem_pl/i.test(error.message)) {
          console.warn('[licitacoesService] salvarAnalise:', error.message)
        }
      }
    } catch (e) { /* ignora */ }
  }

  return { ...lic, ...patch }
}

// ─── INSERÇÃO ─────────────────────────────────────────────────────────────────

/**
 * Insere uma nova licitação importada manualmente.
 * Em modo mock retorna um objeto simulado com ID gerado localmente.
 * Retorna { data: {...}, error: null | Error }
 */
export async function insertLicitacao(fields) {
  // Garante os campos obrigatórios / defaults
  const now = new Date().toISOString()
  const registro = {
    ...fields,
    data_coleta:       fields.data_coleta || now.slice(0, 10),
    situacao:          fields.situacao    || fields.fase_atual || 'Importado manualmente',
    relevante:         fields.relevante   ?? false,
    status_triagem:    fields.status_triagem || 'novo',
    observacoes:       fields.observacoes || '',
    importado_manualmente: true,
    created_at:        now,
    updated_at:        now,
  }

  if (!isSupabaseConfigured) {
    // Modo offline: salva no localStorage e retorna o registro com ID fake
    const fakeId = 'local-' + Date.now()
    const completo = { ...registro, id: fakeId }
    await upsertLocal(completo)
    return { data: completo, error: null, source: 'local' }
  }

  try {
    let { data, error } = await supabase
      .from('licitacoes')
      .insert([registro])
      .select()
      .single()

    // Fallback: se a coluna `arquivos` ainda não existe no schema, tenta sem ela
    if (error && /arquivos/i.test(error.message || '')) {
      const { arquivos, ...semArquivos } = registro
      const retry = await supabase
        .from('licitacoes')
        .insert([semArquivos])
        .select()
        .single()
      data  = retry.data
      error = retry.error
      if (!error) {
        console.warn('[licitacoesService] coluna `arquivos` não existe no schema — registro salvo sem ela. Rode a migration em supabase/schema.sql.')
      }
    }

    if (error) throw error
    return { data, error: null, source: 'supabase' }
  } catch (err) {
    console.error('[licitacoesService] insertLicitacao:', err)
    return { data: null, error: err, source: 'supabase' }
  }
}

// ─── ATUALIZAÇÃO ──────────────────────────────────────────────────────────────

export async function updateRelevante(id, relevante) {
  if (!isSupabaseConfigured) {
    await patchLocal(id, { relevante })
    return { error: null }
  }

  const { error } = await supabase
    .from('licitacoes')
    .update({ relevante, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) console.error('[licitacoesService] updateRelevante:', error)
  return { error }
}

export async function updateStatusTriagem(id, status_triagem, extras = {}) {
  const patch = { status_triagem, ...extras }
  if (!isSupabaseConfigured) {
    await patchLocal(id, patch)
    return { error: null }
  }

  const { error } = await supabase
    .from('licitacoes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) console.error('[licitacoesService] updateStatusTriagem:', error)
  return { error }
}

export async function updateObservacoes(id, observacoes) {
  if (!isSupabaseConfigured) {
    await patchLocal(id, { observacoes })
    return { error: null }
  }

  const { error } = await supabase
    .from('licitacoes')
    .update({ observacoes, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) console.error('[licitacoesService] updateObservacoes:', error)
  return { error }
}

// ─── REMOÇÃO ──────────────────────────────────────────────────────────────────

export async function deleteLicitacao(id) {
  if (!isSupabaseConfigured || String(id).startsWith('local-')) {
    const list = loadLocal().filter(l => l.id !== id)
    await saveLocal(list)
    return { error: null }
  }

  const { error } = await supabase.from('licitacoes').delete().eq('id', id)
  if (error) console.error('[licitacoesService] deleteLicitacao:', error)
  return { error }
}
