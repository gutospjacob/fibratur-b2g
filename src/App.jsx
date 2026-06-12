import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  fetchLicitacoes,
  bulkUpsertLocal,
  analyzePdf,
  salvarAnaliseFinanceira,
  listarBackups,
  restaurarBackup,
  diagnosticarStorage,
  listarTudoFibratur,
  autoRecover,
  updateRelevante,
  updateStatusTriagem,
  updateObservacoes,
  updateLicitacaoPatch,
  deleteLicitacao,
  insertLicitacao,
  scrapeBllUrl,
  coletarLicitacoesReais,
  buscarArquivosPncp,
  buscarDetalhePncp,
} from "./services/licitacoesService"
import { isSupabaseConfigured } from "./lib/supabase"

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const PORTAIS = [
  "BLL Compras", "Compras.gov", "Compras.gov (PNCP)",
  "Portal de Compras Públicas", "Licitações-e", "Licitanet",
  "ComprasNet", "Outro"
]

const CATEGORIAS = [
  "agenciamento", "passagem_aerea", "passagens_rodoviarias", "hospedagem",
  "locacao_veiculos", "seguro_viagem", "viagens_fluviais"
]

const SITUACOES = ["Aberta", "Encerrada", "Suspensa", "Anulada", "Homologada", "Importado manualmente"]

const STATUS_TRIAGEM = [
  "novo", "amanha", "em_analise", "participando", "ganhamos", "perdemos", "descartado"
]

const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"
]

const CATEGORIA_LABEL = {
  agenciamento: "Agenciamento",
  passagem_aerea: "Passagem aérea",
  passagens: "Passagem aérea",
  passagens_rodoviarias: "Rodoviário",
  hospedagem: "Hospedagem",
  locacao_veiculos: "Locação Veículos",
  seguro_viagem: "Seguro Viagem",
  viagens_fluviais: "Viagens Fluviais",
  ti_cloud: "TI/Cloud",
  nao_relacionada: "Não relacionada"
}

const CATEGORIA_ID_POR_LABEL = {
  "agenciamento": "agenciamento",
  "passagem aérea": "passagem_aerea",
  "passagem aerea": "passagem_aerea",
  "passagens": "passagem_aerea",
  "passagens aéreas": "passagem_aerea",
  "passagens aereas": "passagem_aerea",
  "rodoviário": "passagens_rodoviarias",
  "rodoviario": "passagens_rodoviarias",
  "passagens rodoviárias": "passagens_rodoviarias",
  "passagens rodoviarias": "passagens_rodoviarias",
  "hospedagem": "hospedagem",
  "locação veículos": "locacao_veiculos",
  "locacao veiculos": "locacao_veiculos",
  "locação de veículos": "locacao_veiculos",
  "locacao de veiculos": "locacao_veiculos",
  "seguro viagem": "seguro_viagem",
  "viagens fluviais": "viagens_fluviais",
}

const STATUS_LABEL = {
  novo:        "🆕 Novo",
  amanha:      "📅 Amanhã",
  em_analise:  "🔍 Em análise",
  participando:"✅ Participando",
  ganhamos:    "🏆 Ganhamos",
  perdemos:    "❌ Perdemos",
  descartado:  "🗑️ Descartado",
  // legados (caso existam licitações com status antigo)
  alterado: "Alterado",
  pendente_analise: "Pendente Análise (legado)",
  relevante: "Relevante (legado)",
  analisado: "Analisado (legado)"
}

const SITUACAO_COLOR = {
  Aberta: "#16a34a",
  Encerrada: "#6b7280",
  Suspensa: "#d97706",
  Anulada: "#dc2626",
  Homologada: "#2563eb",
  "Importado manualmente": "#7c3aed"
}

const STATUS_COLOR = {
  novo:        "#3b82f6",   // azul
  amanha:      "#f59e0b",   // amarelo
  em_analise:  "#a855f7",   // roxo
  participando:"#16a34a",   // verde
  ganhamos:    "#059669",   // verde forte
  perdemos:    "#dc2626",   // vermelho
  descartado:  "#dc2626",   // vermelho
  // legados
  alterado: "#f59e0b",
  pendente_analise: "#8b5cf6",
  relevante: "#16a34a",
  analisado: "#0891b2"
}

const MOTIVOS_DESCARTE = [
  "Fora do escopo",
  "Prazo perdido / encerrado",
  "Não pode subcontratar",
  "Pede índices financeiros",
  "Pede patrimônio líquido mínimo",
  "Exigência documental inviável",
  "Atestado técnico incompatível",
  "Região / logística ruim",
  "Preço ou margem ruim",
  "Credenciamento",
  "TI / cloud / hospedagem de sistema",
  "Leilão / alienação",
  "Outro"
]

// Todas as palavras-chave rastreadas
const TODAS_KEYWORDS = [
  "agenciamento de viagens",
  "agenciamento de passagens",
  "passagens aéreas",
  "bilhete aéreo",
  "emissão de bilhetes",
  "emissão de passagens",
  "passagens rodoviárias",
  "bilhete rodoviário",
  "transporte rodoviário de passageiros",
  "passagens marítimas",
  "passagens fluviais",
  "passagens ferroviárias",
  "passagens nacionais",
  "passagens internacionais",
  "hospedagem",
  "seguro viagem",
  "locação de veículos",
  "eventos",
  "traslado",
  "transporte",
  "turismo",
]

const DOCS_KEY = "fibratur:documentos"
const SENHAS_KEY = "fibratur:senhas"
const LISTA_FILTROS_KEY = "fibratur:filtros-lista"
const LISTA_SCROLL_KEY = "fibratur:scroll-lista"

function carregarFiltrosLista() {
  try {
    const raw = sessionStorage.getItem(LISTA_FILTROS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function salvarFiltrosLista(filtros) {
  try { sessionStorage.setItem(LISTA_FILTROS_KEY, JSON.stringify(filtros || {})) } catch {}
}

function carregarDocumentos() {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function documentoKey(doc) {
  return doc?.id || doc?.arquivo_url || doc?.numero || doc?.nome || ""
}

function mesclarDocumentos(localDocs, serverDocs) {
  const manterPreenchido = (atual, novo) => {
    const merged = { ...(atual || {}), ...(novo || {}) }
    Object.keys(merged).forEach(k => {
      const novoVazio = merged[k] === undefined || merged[k] === null || String(merged[k]).trim() === "" || String(merged[k]).trim() === "—"
      const atualTemValor = atual?.[k] !== undefined && atual?.[k] !== null && String(atual[k]).trim() !== "" && String(atual[k]).trim() !== "—"
      if (novoVazio && atualTemValor) merged[k] = atual[k]
    })
    return merged
  }
  const byKey = new Map()
  ;[...(Array.isArray(localDocs) ? localDocs : []), ...(Array.isArray(serverDocs) ? serverDocs : [])].forEach(doc => {
    const key = documentoKey(doc)
    if (!key) return
    const existenteKey = Array.from(byKey.keys()).find(k => {
      const atual = byKey.get(k)
      return (doc.arquivo_url && atual?.arquivo_url === doc.arquivo_url)
        || (doc.numero && atual?.numero === doc.numero && doc.nome && atual?.nome === doc.nome)
    })
    const finalKey = existenteKey || key
    const atual = byKey.get(finalKey)
    byKey.set(finalKey, atual ? manterPreenchido(atual, doc) : doc)
  })
  return Array.from(byKey.values())
}

function salvarDocumentos(docs) {
  try { localStorage.setItem(DOCS_KEY, JSON.stringify(docs || [])) } catch {}
  return fetch("/api/documentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(docs || []),
  }).catch(() => {})
}

async function carregarDocumentosServidor() {
  const locais = carregarDocumentos()
  try {
    const res = await fetch("/api/documentos")
    const docs = await res.json().catch(() => [])
    if (res.ok && Array.isArray(docs)) {
      const mesclados = mesclarDocumentos(locais, docs)
      try { localStorage.setItem(DOCS_KEY, JSON.stringify(mesclados)) } catch {}
      if (JSON.stringify(mesclados) !== JSON.stringify(docs)) salvarDocumentos(mesclados)
      return mesclados
    }
  } catch {}
  return locais
}

function carregarSenhas() {
  try {
    const raw = localStorage.getItem(SENHAS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function salvarSenhas(senhas) {
  try { localStorage.setItem(SENHAS_KEY, JSON.stringify(senhas || [])) } catch {}
  return fetch("/api/senhas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(senhas || []),
  }).catch(() => {})
}

async function carregarSenhasServidor() {
  const locais = carregarSenhas()
  try {
    const res = await fetch("/api/senhas")
    const senhas = await res.json().catch(() => [])
    if (res.ok && Array.isArray(senhas)) {
      const byId = new Map()
      ;[...locais, ...senhas].forEach(s => {
        const key = s?.id || [s?.plataforma, s?.login].filter(Boolean).join("|")
        if (!key) return
        const atual = byId.get(key)
        byId.set(key, atual ? { ...atual, ...s, senha: s.senha || atual.senha } : s)
      })
      const mescladas = Array.from(byId.values())
      try { localStorage.setItem(SENHAS_KEY, JSON.stringify(mescladas)) } catch {}
      if (JSON.stringify(mescladas) !== JSON.stringify(senhas)) salvarSenhas(mescladas)
      return mescladas
    }
  } catch {}
  return locais
}

function downloadArquivoUrl(arq) {
  const url = arq?.url || ""
  const nome = arq?.nome || "arquivo.pdf"
  return "/api/download?url=" + encodeURIComponent(url) + "&name=" + encodeURIComponent(nome)
}

function downloadDocumentoUrl(doc) {
  if (!doc?.arquivo_url) return ""
  return doc.arquivo_url + (doc.arquivo_url.includes("?") ? "&" : "?") + "download=1"
}

async function uploadDocumentoArquivo(file) {
  const body = new FormData()
  body.append("file", file)
  const res = await fetch("/api/upload", { method: "POST", body })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.ok) throw new Error(out.error || "Erro ao enviar arquivo")
  return out
}

function diasAteVencimento(data) {
  if (!data) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const venc = new Date(data + "T00:00:00")
  if (Number.isNaN(venc.getTime())) return null
  return Math.ceil((venc - hoje) / 86400000)
}

function statusDocumento(doc) {
  const dias = diasAteVencimento(doc.vencimento)
  if (dias === null) return { label: "Sem vencimento", color: "#64748b", bg: "#f8fafc", dias }
  if (dias < 0) return { label: `Vencido há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`, color: "#b91c1c", bg: "#fee2e2", dias }
  if (dias === 0) return { label: "Vence hoje", color: "#b45309", bg: "#fef3c7", dias }
  if (dias <= 15) return { label: `Vence em ${dias} dia${dias === 1 ? "" : "s"}`, color: "#b45309", bg: "#fef3c7", dias }
  if (dias <= 30) return { label: `Vence em ${dias} dias`, color: "#1d4ed8", bg: "#dbeafe", dias }
  return { label: "Válido", color: "#15803d", bg: "#dcfce7", dias }
}

function situacaoArquivada(situacao) {
  const s = textoNormalizado(situacao)
  return ["revogada", "anulada", "suspensa", "cancelada", "fracassada", "deserta"].some(x => s.includes(x))
}

function textoNormalizado(valor) {
  return (valor || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function grupoMotivoDescarte(valor) {
  const raw = (valor || "Sem motivo").toString().trim()
  const t = textoNormalizado(raw)
  if (!t || t === "sem motivo") return "Sem motivo"
  if (/subcontrat|sub contrat|terceiriz/.test(t)) return "Não pode subcontratar"
  if (/prazo|expir|encerrad|perdid|decurso|passou|vencid/.test(t)) return "Prazo perdido / encerrado"
  if (/indice|indices|lg|lc|sg|ge|liquidez|solvencia|financeir/.test(t)) return "Pede índices financeiros"
  if (/patrimonio|pl minimo|capital social|balanco/.test(t)) return "Pede patrimônio líquido mínimo"
  if (/credenciamento|credenciar/.test(t)) return "Credenciamento"
  if (/ti|cloud|sistema|software|informatiz|licenca de uso|hospedagem de sistema/.test(t)) return "TI / cloud / hospedagem de sistema"
  if (/leilao|alienacao|venda de bem|imovel|veiculo usado/.test(t)) return "Leilão / alienação"
  if (/fora.*escopo|nao relacionada|nao relacionado|sem relacao|construcao|obra|creche/.test(t)) return "Fora do escopo"
  if (/document|certidao|habilitacao|exigencia|inviavel|regularidade/.test(t)) return "Exigência documental inviável"
  if (/atestado|capacidade tecnica|tecnico incompat/.test(t)) return "Atestado técnico incompatível"
  if (/regiao|logistica|distancia|localidade|local/.test(t)) return "Região / logística ruim"
  if (/preco|margem|custo|baixo|inviavel economic/.test(t)) return "Preço ou margem ruim"
  return raw
}

function ehPassagemRodoviariaTexto(texto) {
  return /passagens? rodovi|bilhetes? rodovi|passagens? terrestres?|bilhetes? terrestres?|passagens? de onibus|bilhetes? de onibus|fornecimento de passagens? terrestres?|agenciamento de passagens? terrestres?|transporte rodoviario de passageiros/.test(texto)
    || ((/rodoviari[ao]s?|terrestres?|onibus/.test(texto)) && /passagens?|bilhetes?|agenciamento|reserva|emissao|remarcacao|cancelamento|fornecimento/.test(texto))
}

function normalizarCategoriaId(categoria) {
  const c = textoNormalizado(categoria).trim()
  return CATEGORIA_ID_POR_LABEL[c] || c
}

function textoCategoriasLicitacao(l) {
  const itens = Array.isArray(l?.itens_pncp)
    ? l.itens_pncp.map(it => [it.descricao, it.objeto, it.nome, it.criterio_julgamento].filter(Boolean).join(" "))
    : []
  const raw = l?.raw_data || {}
  return textoNormalizado([
    l?.categoria,
    ...(Array.isArray(l?.categorias) ? l.categorias : []),
    l?.objeto,
    l?.descricao,
    l?.resumo,
    l?.termo_referencia,
    l?.informacao_complementar,
    l?.observacoes,
    ...(Array.isArray(l?.palavras_chave) ? l.palavras_chave : [l?.palavras_chave]),
    ...itens,
    raw?.objetoCompra,
    raw?.description,
    raw?.informacaoComplementar,
    raw?.rawSearch?.description,
  ].filter(Boolean).join(" "))
}

function categoriasDaLicitacao(l) {
  const categorias = new Set()
  if (Array.isArray(l?.categorias)) {
    l.categorias.forEach(c => {
      const id = normalizarCategoriaId(c)
      if (id) categorias.add(id)
    })
  }

  const texto = textoCategoriasLicitacao(l)
  if (/hospedagem (?:de )?(?:site|sitios|portal|sistema|pagina|website|web|aplicacao|software)|hospedagem em nuvem|infraestrutura de datacenter|computacao em nuvem|datacenter|data center|servidor\s+(?:dedicado|web|em nuvem|virtual|de aplicacao|de banco)|sistema informatizado|licenca de uso|suporte tecnico|manutencao corretiva|manutencao evolutiva/.test(texto)) categorias.add("ti_cloud")
  if (/passagens? aere|bilhetes? aere|transporte aereo|passagens? nacionais|passagens? internacionais|passagens? aereas? nacionais|passagens? aereas? internacionais|agenciamento de viagens aereas|fornecimento de passagens? aereas|reserva.*passagens? aereas|emissao.*passagens? aereas|remarcacao.*passagens? aereas|cancelamento.*passagens? aereas/.test(texto)) categorias.add("passagem_aerea")
  if (ehPassagemRodoviariaTexto(texto) || /transporte rodoviario|transporte terrestre/.test(texto)) categorias.add("passagens_rodoviarias")
  if (/hospedagem|hoteis?|hotel|diarias?|reserva de hotel|reserva hoteleira|acomodacao|servicos? hoteleiros/.test(texto)) categorias.add("hospedagem")
  if (/locacao de veiculos|aluguel de veiculos|veiculo locado|carros?|vans?|onibus locado|transporte com motorista|transporte sem motorista|frota|motorista|traslado|transfer/.test(texto)) categorias.add("locacao_veiculos")
  if (/seguro viagem|seguro de viagem|assistencia viagem|assistencia medica internacional|seguro internacional|cobertura medica em viagem/.test(texto)) categorias.add("seguro_viagem")
  if (/transporte fluvial|passagens? fluviais?|embarcacao|barco|lancha|balsa|transporte aquaviario|transporte hidroviario/.test(texto)) categorias.add("viagens_fluviais")
  if (/agencia de viagens|agenciamento de viagens|servico de agenciamento|gestao de viagens|organizacao de viagens|intermediacao de servicos de viagem|reserva.*emissao.*remarcacao.*cancelamento/.test(texto)) categorias.add("agenciamento")

  if (!categorias.size && /nao relacionada|não relacionada/.test(texto)) categorias.add("nao_relacionada")
  if (!categorias.size && l?.categoria) categorias.add(normalizarCategoriaId(l.categoria))
  return Array.from(categorias).filter(Boolean)
}

function categoriaDaLicitacao(l) {
  return categoriasDaLicitacao(l)[0] || ""
}

function pncpIdsDaLicitacao(l) {
  const bruto = [
    l?.link_licitacao,
    l?.link_edital,
    l?.id,
    l?.unique_key,
    l?.numero_processo,
    l?.raw_data?.numeroControlePNCP,
    l?.raw_data?.numero_controle_pncp,
  ].filter(Boolean).join(" ")
  const raw = l?.raw_data || {}
  const cnpj = raw?.orgaoEntidade?.cnpj || raw?.orgao_cnpj || l?.cnpj_orgao || (bruto.match(/(\d{14})/)?.[1] || "")
  const ano = raw?.anoCompra || raw?.ano || (bruto.match(/(?:editais|compras|pncp)[^\d]*(?:\d{14})[^\d]+(\d{4})[^\d]+(\d+)/i)?.[1] || bruto.match(/(?:^|[^\d])(\d{4})[^\d]+(\d{1,8})(?:[^\d]|$)/)?.[1] || "")
  const seq = raw?.sequencialCompra || raw?.numero_sequencial || (bruto.match(/(?:editais|compras|pncp)[^\d]*(?:\d{14})[^\d]+(\d{4})[^\d]+(\d+)/i)?.[2] || "")
  return { cnpj: String(cnpj || "").replace(/\D/g, ""), ano: String(ano || "").replace(/\D/g, ""), seq: String(seq || "").replace(/\D/g, "") }
}

function linkLicitacaoCorrigido(l) {
  if (textoNormalizado(l?.portal || l?.fonte).includes("pncp")) {
    const ids = pncpIdsDaLicitacao(l)
    if (ids.cnpj && ids.ano && ids.seq) return `https://pncp.gov.br/app/editais/${ids.cnpj}/${ids.ano}/${ids.seq}`
  }
  return l?.link_licitacao || ""
}

function modalidadeFiltroDaLicitacao(l) {
  const t = textoNormalizado([l?.modalidade, l?.tipo_contrato, l?.tipo_lance, l?.objeto, l?.num_edital].filter(Boolean).join(" "))
  if (/credenciamento|chamamento publico/.test(t)) return "credenciamento"
  if (/pregao/.test(t) && /eletronico/.test(t)) return "pregao_eletronico"
  if (/pregao/.test(t)) return "pregao"
  if (/dispensa/.test(t)) return "dispensa"
  if (/inexigibilidade/.test(t)) return "inexigibilidade"
  if (/concorrencia/.test(t)) return "concorrencia"
  if (/leilao/.test(t)) return "fora_escopo"
  return ""
}

const MODALIDADE_FILTROS = [
  { value: "sem_credenciamento", label: "Ocultar credenciamento" },
  { value: "", label: "Todas modalidades" },
  { value: "pregao_eletronico", label: "Pregão eletrônico" },
  { value: "pregao", label: "Pregão" },
  { value: "credenciamento", label: "Credenciamento" },
  { value: "dispensa", label: "Dispensa" },
  { value: "inexigibilidade", label: "Inexigibilidade" },
  { value: "concorrencia", label: "Concorrência" },
]

function documentosCriticos(docs, limiteDias = 5) {
  return (Array.isArray(docs) ? docs : []).filter(d => {
    const dias = statusDocumento(d).dias
    return dias !== null && dias <= limiteDias
  })
}

function tempoRestanteLabel(data) {
  const d = parseBrDateTime(data)
  if (!d) return null
  const diff = d.getTime() - Date.now()
  if (diff <= 0) return { text: "Prazo encerrado", color: "#64748b", bg: "#f1f5f9" }
  const min = Math.floor(diff / 60000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return { text: `Vence em ${h}h ${String(m).padStart(2, "0")}m`, color: h <= 3 ? "#dc2626" : "#ea580c", bg: h <= 3 ? "#fee2e2" : "#ffedd5" }
  const dias = Math.floor(h / 24)
  return { text: `Vence em ${dias} dia${dias === 1 ? "" : "s"}`, color: "#2563eb", bg: "#dbeafe" }
}

// ─── EXPORT / IMPORT CSV (Excel-compatível) ──────────────────────────────────
const COLUNAS_CSV = [
  "id", "portal", "link_licitacao", "orgao", "uf", "municipio",
  "num_edital", "numero_processo", "modalidade", "tipo_contrato", "fase_atual",
  "data_publicacao", "data_inicio_propostas", "data_fim_propostas", "data_sessao",
  "prazo_impugnacao", "prazo_esclarecimentos", "validade_proposta",
  "tipo_lance", "modo_disputa", "exclusivo_me_epp", "exclusivo_regional",
  "objeto", "valor_estimado", "palavras_chave", "arquivos",
  "situacao", "status_triagem", "relevante", "observacoes",
  "data_coleta", "created_at", "updated_at", "importado_manualmente",
]

function csvEscape(v) {
  if (v == null) return ""
  let s
  if (Array.isArray(v) || typeof v === "object") s = JSON.stringify(v)
  else s = String(v)
  if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

function exportarCSV(licitacoes) {
  if (!licitacoes || licitacoes.length === 0) {
    alert("Nada para exportar — a lista está vazia.")
    return
  }
  const linhas = [COLUNAS_CSV.join(";")]
  for (const l of licitacoes) {
    linhas.push(COLUNAS_CSV.map(c => csvEscape(l[c])).join(";"))
  }
  // BOM UTF-8 para Excel reconhecer acentos automaticamente
  const conteudo = "﻿" + linhas.join("\r\n")
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const ts = new Date().toISOString().slice(0, 10)
  a.download = `fibratur-licitacoes-${ts}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function parseCsvLine(line) {
  // Parser simples para CSV com `;` separador e aspas duplas
  const fields = []
  let cur = "", inQ = false, i = 0
  while (i < line.length) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue }
      if (c === '"') { inQ = false; i++; continue }
      cur += c; i++
    } else {
      if (c === '"') { inQ = true; i++; continue }
      if (c === ";") { fields.push(cur); cur = ""; i++; continue }
      cur += c; i++
    }
  }
  fields.push(cur)
  return fields
}

async function importarCSV(file) {
  const txt = await file.text()
  const semBom = txt.replace(/^﻿/, "")
  const linhas = semBom.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (linhas.length < 2) return []
  const header = parseCsvLine(linhas[0])
  const out = []
  for (let i = 1; i < linhas.length; i++) {
    const cols = parseCsvLine(linhas[i])
    const obj = {}
    for (let j = 0; j < header.length; j++) {
      let v = cols[j] ?? ""
      // Tenta interpretar palavras_chave e arquivos como JSON
      if (header[j] === "palavras_chave" || header[j] === "arquivos") {
        try { v = v ? JSON.parse(v) : [] } catch { /* mantém como string */ }
      } else if (header[j] === "relevante" || header[j] === "importado_manualmente") {
        v = v === "true" || v === "1" || v === "TRUE"
      }
      obj[header[j]] = v
    }
    if (!obj.id) obj.id = "local-" + Date.now() + "-" + i
    out.push(obj)
  }
  return out
}

function mesclarPorId(lista) {
  const byId = new Map()
  lista.forEach(l => {
    const key = chaveEstavelLicitacao(l)
    if (!key) return
    byId.set(key, byId.has(key) ? mergeLicitacaoCompleta(byId.get(key), l) : l)
  })
  return Array.from(byId.values())
}

function chaveEstavelLicitacao(l) {
  if (!l) return ""
  if (l.pncp_key) return String(l.pncp_key)
  const raw = l.raw_data || {}
  const cnpj = String(raw?.orgaoEntidade?.cnpj || l.cnpj_orgao || "").replace(/\D/g, "")
  const ano = String(raw?.anoCompra || raw?.ano || "").replace(/\D/g, "")
  const seq = String(raw?.sequencialCompra || raw?.numero_sequencial || "").replace(/\D/g, "")
  if (cnpj && ano && seq) return ["pncp", cnpj, ano, seq].join("-")
  const texto = [l.id, l.unique_key, l.numero_processo, raw.numeroControlePNCP, raw.numero_controle_pncp, l.link_licitacao, l.link_edital].filter(Boolean).join(" ")
  const controle = texto.match(/(\d{14})-\d+-(\d+)\/(\d{4})/)
  if (controle) return ["pncp", controle[1], controle[3], String(Number(controle[2]))].join("-")
  const url = texto.match(/editais\/(\d{14})\/(\d{4})\/(\d+)/)
  if (url) return ["pncp", url[1], url[2], String(Number(url[3]))].join("-")
  return l.id || l.unique_key || ""
}

function valorVazioLicitacao(v) {
  return v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "—"
}

function mergeLicitacaoCompleta(atual, nova) {
  const merged = { ...(atual || {}), ...(nova || {}) }
  const chave = chaveEstavelLicitacao(atual) || chaveEstavelLicitacao(nova)
  if (chave && chave.startsWith("pncp-")) merged.pncp_key = chave
  const keys = new Set([...Object.keys(atual || {}), ...Object.keys(nova || {})])
  keys.forEach(k => {
    if (valorVazioLicitacao(nova?.[k]) && !valorVazioLicitacao(atual?.[k])) merged[k] = atual[k]
  })
  ;[
    "status_triagem", "status_interno", "relevante", "observacoes",
    "motivo_descarte", "motivo_perda", "foi_analisada", "foi_participada",
    "analisada_em", "participou_em", "descartado_em", "perdemos_em",
    "status_historico", "categoria_descarte"
  ].forEach(k => {
    if (!valorVazioLicitacao(atual?.[k])) merged[k] = atual[k]
  })
  if (atual?.raw_data || nova?.raw_data) merged.raw_data = { ...(atual?.raw_data || {}), ...(nova?.raw_data || {}) }
  return merged
}

function pedirMotivoDescarte() {
  const motivosRapidos = {
    3: "Não pode subcontratar",
    4: "Pede índices financeiros",
    5: "Pede patrimônio líquido mínimo",
  }
  const texto = [
    "Escolha o motivo do descarte:",
    "",
    "3. Não pode subcontratar",
    "4. Pede índices financeiros",
    "5. Pede patrimônio líquido mínimo",
    "",
    "Outro: menos de 10 passageiros"
  ].join("\n")
  const resposta = window.prompt(texto, "menos de 10 passageiros")
  if (resposta === null) return null
  const trimmed = resposta.trim()
  const numero = Number(trimmed)
  let motivo = Number.isInteger(numero) && motivosRapidos[numero]
    ? motivosRapidos[numero]
    : trimmed
  return motivo || "Não informado"
}

function ModalMotivoDescarte({ onEscolher, onCancelar }) {
  const opcoes = [
    { titulo: "Não conta etapa", motivo: "Não conta etapa", desc: "Use quando não deve entrar no funil/indicadores principais.", cor: "#64748b" },
    { titulo: "Não pode subcontratar", motivo: "Não pode subcontratar", desc: "Edital exige execução própria e impede agência.", cor: "#dc2626" },
    { titulo: "Índices financeiros", motivo: "Pede índices financeiros", desc: "LG, LC, SG, GE ou exigência financeira difícil.", cor: "#f59e0b" },
    { titulo: "Patrimônio líquido", motivo: "Pede patrimônio líquido mínimo", desc: "Exige PL mínimo/capital/balanço fora do ideal.", cor: "#b45309" },
    { titulo: "Menos de 10 passageiros", motivo: "Menos de 10 passageiros para aéreo", desc: "Volume pequeno demais para passagem aérea.", cor: "#2563eb" },
  ]
  const [selecionado, setSelecionado] = useState(opcoes[4].motivo)
  const [outro, setOutro] = useState("")
  const motivoFinal = outro.trim() || selecionado

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(760px, 96vw)", background: "#fff", borderRadius: 12, boxShadow: "0 24px 70px #0005", overflow: "hidden", border: "1px solid #dbeafe" }}>
        <div style={{ padding: "18px 22px", background: "#1e293b", color: "#fff", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Motivo do descarte</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#cbd5e1" }}>Selecione o motivo para manter o dashboard limpo e comparável.</p>
          </div>
          <button onClick={onCancelar} style={{ border: "1px solid #94a3b8", background: "#334155", color: "#fff", borderRadius: 8, width: 36, height: 36, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            {opcoes.map(op => {
              const ativo = selecionado === op.motivo && !outro.trim()
              return (
                <button
                  key={op.motivo}
                  onClick={() => { setSelecionado(op.motivo); setOutro("") }}
                  style={{
                    textAlign: "left",
                    padding: 14,
                    borderRadius: 10,
                    border: ativo ? `2px solid ${op.cor}` : "1px solid #e5e7eb",
                    background: ativo ? `${op.cor}12` : "#fff",
                    cursor: "pointer",
                    minHeight: 94,
                    boxShadow: ativo ? `0 0 0 3px ${op.cor}18` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: op.cor, fontSize: 13, fontWeight: 900 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: op.cor, display: "inline-block" }} />
                    {op.titulo}
                  </div>
                  <div style={{ marginTop: 8, color: "#64748b", fontSize: 12, lineHeight: 1.35 }}>{op.desc}</div>
                </button>
              )
            })}
          </div>

          <label style={{ display: "block", marginTop: 16, fontSize: 12, fontWeight: 850, color: "#475569", textTransform: "uppercase" }}>Outro motivo</label>
          <input
            value={outro}
            onChange={e => setOutro(e.target.value)}
            placeholder="Ex: fora do escopo, região ruim, preço inviável..."
            style={{ marginTop: 6, width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
            autoFocus
          />

          <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "#f8fafc", color: "#334155", fontSize: 13 }}>
            Vai salvar como: <strong>{motivoFinal}</strong>
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 10, background: "#f8fafc" }}>
          <button onClick={onCancelar} style={btnStyle("#fff", "#334155")}>Cancelar</button>
          <button onClick={() => onEscolher(motivoFinal)} style={btnStyle("#dc2626", "#fff")}>Descartar</button>
        </div>
      </div>
    </div>
  )
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return "—"
  const s = d.split("T")[0].split("-")
  if (s.length === 3) return `${s[2]}/${s[1]}/${s[0]}`
  return d
}

function Badge({ text, color, small }) {
  return (
    <span style={{
      display: "inline-block",
      padding: small ? "2px 7px" : "3px 9px",
      borderRadius: 4,
      fontSize: small ? 11 : 12,
      fontWeight: 600,
      backgroundColor: color + "18",
      color,
      border: `1px solid ${color}40`,
      whiteSpace: "nowrap"
    }}>
      {text}
    </span>
  )
}

function btnStyle(bg, color, full) {
  return {
    padding: full ? "7px 16px" : "5px 8px",
    borderRadius: 5,
    border: `1px solid ${color}30`,
    background: bg,
    color,
    cursor: "pointer",
    fontSize: full ? 13 : 14,
    fontWeight: full ? 600 : 400,
    lineHeight: 1
  }
}

// ─── BANNER DE FONTE DOS DADOS ────────────────────────────────────────────────
function BannerFonte({ source, error, onRefresh, loading }) {
  if (!source) return null

  const configs = {
    supabase:       { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", icon: "🟢", text: "Conectado ao Supabase — dados reais" },
    arquivo:        { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", icon: "🔵", text: "Usando base local com coleta real — clique em Atualizar para buscar PNCP" },
    local:          { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", icon: "🔵", text: "Usando base local — clique em Atualizar para buscar PNCP" },
    local_fallback: { bg: "#fef9c3", border: "#fde68a", color: "#92400e", icon: "⚠️", text: "Falha na conexão com o Supabase — exibindo base local" },
  }

  const cfg = configs[source] || configs.local

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
      background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 6,
      marginBottom: 14, fontSize: 12, color: cfg.color
    }}>
      <span>{cfg.icon}</span>
      <span>{cfg.text}</span>
      {error && <span style={{ fontFamily: "monospace", opacity: 0.7 }}>({error.message})</span>}
      <button onClick={onRefresh} disabled={loading}
        style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, border: `1px solid ${cfg.color}40`, background: "transparent", color: cfg.color, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
        {loading ? "Carregando..." : "↺ Atualizar"}
      </button>
    </div>
  )
}

// ─── MODAL: IMPORTAR LICITAÇÃO ────────────────────────────────────────────────
/** Procura se já existe uma licitação igual (link, código do portal ou processo/edital + órgão). */
function encontrarDuplicada(novo, existentes) {
  if (!Array.isArray(existentes) || existentes.length === 0) return null
  const norm = s => (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
  const normLink = s => norm(s)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
  const codigoPortal = s => {
    const raw = norm(s).replace(/^https?:\/\//, "").replace(/^www\./, "")
    const link = normLink(s)
    if (!link) return ""
    const bll = raw.match(/param1=([^&\s]+)/)
    if (bll) return "bll:" + bll[1]
    const portal = link.match(/portaldecompraspublicas\.com\.br\/processos\/.*?-(\d+)$/)
    if (portal) return "portal:" + portal[1]
    const pncp = link.match(/pncp\.gov\.br\/app\/editais\/(.+)$/)
    if (pncp) return "pncp:" + pncp[1].replace(/\D+/g, "-").replace(/^-|-$/g, "")
    return link
  }

  const linkNovo = normLink(novo.link_licitacao)
  const codigoNovo = codigoPortal(novo.link_licitacao)
  const editalNovo = norm(novo.num_edital || novo.numero_processo)
  const processoNovo = norm(novo.numero_processo || novo.num_edital)
  const orgaoNovo = norm(novo.orgao || novo.municipio)
  const municipioNovo = norm(novo.municipio)

  for (const l of existentes) {
    const linkExistente = normLink(l.link_licitacao)
    const codigoExistente = codigoPortal(l.link_licitacao)
    if (linkNovo && linkExistente === linkNovo) {
      return { tipo: "link", licitacao: l }
    }
    if (codigoNovo && codigoExistente && codigoExistente === codigoNovo) {
      return { tipo: "codigo", licitacao: l }
    }

    const editalExistente = norm(l.num_edital || l.numero_processo)
    const processoExistente = norm(l.numero_processo || l.num_edital)
    const orgaoExistente = norm(l.orgao || l.municipio)
    const municipioExistente = norm(l.municipio)
    const mesmoNumero = (editalNovo && editalExistente === editalNovo) ||
      (processoNovo && processoExistente === processoNovo)
    const mesmoOrgao = (orgaoNovo && orgaoExistente === orgaoNovo) ||
      (municipioNovo && municipioExistente === municipioNovo)

    if (mesmoNumero && mesmoOrgao) {
      return { tipo: "edital+orgao", licitacao: l }
    }
  }
  return null
}

function motivoDuplicada(tipo) {
  if (tipo === "link") return "mesmo link"
  if (tipo === "codigo") return "mesmo código do portal"
  return "mesmo edital/processo e órgão"
}

function ModalImportar({ onClose, onSalvar, licitacoesExistentes = [] }) {
  const STEP_URL   = "url"
  const STEP_FORM  = "form"
  const STEP_DONE  = "done"

  const [step,       setStep]       = useState(STEP_URL)
  const [urlInput,   setUrlInput]   = useState("")
  const [loading,    setLoading]    = useState(false)
  const [erroScrape, setErroScrape] = useState("")
  const [saving,     setSaving]     = useState(false)
  const [savedId,    setSavedId]    = useState(null)
  const [duplicada,  setDuplicada]  = useState(null)   // { tipo, licitacao }
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrErro,    setOcrErro]    = useState("")
  const [ocrTexto,   setOcrTexto]   = useState("")

  // Formulário com todos os 23 campos
  const [form, setForm] = useState({
    portal: "BLL Compras",
    link_licitacao: "",
    orgao: "",
    uf: "",
    municipio: "",
    num_edital: "",
    numero_processo: "",
    modalidade: "",
    tipo_contrato: "",
    fase_atual: "",
    data_publicacao: "",
    data_inicio_propostas: "",
    data_fim_propostas: "",
    data_sessao: "",
    prazo_impugnacao: "",
    prazo_esclarecimentos: "",
    validade_proposta: "",
    tipo_lance: "",
    modo_disputa: "",
    exclusivo_me_epp: "",
    exclusivo_regional: "",
    objeto: "",
    valor_estimado: "",
    palavras_chave: [],
    arquivos: [],
    print_nome: "",
    print_data_url: "",
  })

  function setField(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleKeyword(kw) {
    setForm(f => {
      const atual = f.palavras_chave || []
      return {
        ...f,
        palavras_chave: atual.includes(kw)
          ? atual.filter(k => k !== kw)
          : [...atual, kw]
      }
    })
  }

  async function handleBuscar() {
    const url = urlInput.trim()
    if (!url) { setErroScrape("Cole o link da licitação antes de buscar."); return }
    if (!url.startsWith("http")) { setErroScrape("O link deve começar com http:// ou https://"); return }

    setLoading(true)
    setErroScrape("")

    const result = await scrapeBllUrl(url)
    setLoading(false)

    if (!result.ok) {
      setErroScrape(result.error || "Erro desconhecido ao buscar a página.")
      return
    }

    // Preenche o formulário com os dados extraídos
    const d = result.data
    setForm({
      portal:                d.portal               || "BLL Compras",
      link_licitacao:        d.link_licitacao        || url,
      orgao:                 d.orgao                 || "",
      uf:                    d.uf                    || "",
      municipio:             d.municipio             || "",
      num_edital:            d.num_edital            || "",
      numero_processo:       d.numero_processo       || "",
      modalidade:            d.modalidade            || "",
      tipo_contrato:         d.tipo_contrato         || "",
      fase_atual:            d.fase_atual            || "",
      data_publicacao:       d.data_publicacao       || "",
      data_inicio_propostas: d.data_inicio_propostas || "",
      data_fim_propostas:    d.data_fim_propostas    || "",
      data_sessao:           d.data_sessao           || "",
      prazo_impugnacao:      d.prazo_impugnacao      || "",
      prazo_esclarecimentos: d.prazo_esclarecimentos || "",
      validade_proposta:     d.validade_proposta     || "",
      tipo_lance:            d.tipo_lance            || "",
      modo_disputa:          d.modo_disputa          || "",
      exclusivo_me_epp:      d.exclusivo_me_epp      || "",
      exclusivo_regional:    d.exclusivo_regional    || "",
      objeto:                d.objeto                || "",
      valor_estimado:        d.valor_estimado        || "",
      palavras_chave:        Array.isArray(d.palavras_chave) ? d.palavras_chave : [],
      arquivos:              Array.isArray(d.arquivos) ? d.arquivos : [],
      print_nome:            form.print_nome         || "",
      print_data_url:        form.print_data_url     || "",
    })
    // Verifica se já existe uma igual cadastrada
    const dup = encontrarDuplicada({
      link_licitacao: d.link_licitacao || url,
      num_edital: d.num_edital,
      numero_processo: d.numero_processo,
      orgao: d.orgao,
      municipio: d.municipio,
    }, licitacoesExistentes)
    setDuplicada(dup)
    setStep(STEP_FORM)
  }

  async function handleSalvar() {
    if (!form.portal) { alert("Portal é obrigatório."); return }
    // Re-confere a duplicata no momento do salvar (pode ter mudado o edital/órgão no form)
    const dupAtual = encontrarDuplicada(form, licitacoesExistentes)
    if (dupAtual) {
      const motivoTxt = motivoDuplicada(dupAtual.tipo)
      const ok = window.confirm(
        `⚠️ Já existe uma licitação cadastrada com ${motivoTxt}.\n\n` +
        `Órgão: ${dupAtual.licitacao.orgao || "—"}\n` +
        `Edital: ${dupAtual.licitacao.num_edital || "—"}\n` +
        `Status: ${dupAtual.licitacao.status_triagem || "—"}\n\n` +
        `Deseja salvar mesmo assim (criando uma duplicata)?`
      )
      if (!ok) return
    }
    setSaving(true)
    const { data, error } = await insertLicitacao(form)
    setSaving(false)
    if (error) {
      alert("Erro ao salvar: " + error.message)
      return
    }
    setSavedId(data?.id || "ok")
    onSalvar(data)
    setStep(STEP_DONE)
  }

  // ── Estilos internos ──
  const fieldStyle = {
    display: "flex", flexDirection: "column", gap: 4
  }
  const labelStyle = {
    fontSize: 11, fontWeight: 700, color: "#6b7280",
    textTransform: "uppercase", letterSpacing: 0.4
  }
  const inputStyle = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid #d1d5db",
    fontSize: 13, color: "#111827", background: "#fff",
    fontFamily: "inherit", boxSizing: "border-box", width: "100%"
  }
  const sectionHead = {
    margin: "0 0 10px", fontSize: 12, fontWeight: 700,
    color: "#374151", textTransform: "uppercase", letterSpacing: 0.5,
    paddingBottom: 6, borderBottom: "1px solid #e5e7eb"
  }

  function Campo({ label, fieldKey, placeholder, full, textarea, required }) {
    return (
      <div style={{ ...fieldStyle, gridColumn: full ? "1 / -1" : undefined }}>
        <label style={labelStyle}>{label}{required && " *"}</label>
        {textarea ? (
          <textarea
            value={form[fieldKey] || ""}
            onChange={e => setField(fieldKey, e.target.value)}
            placeholder={placeholder || ""}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 70 }}
          />
        ) : (
          <input
            type="text"
            value={form[fieldKey] || ""}
            onChange={e => setField(fieldKey, e.target.value)}
            placeholder={placeholder || ""}
            style={inputStyle}
          />
        )}
      </div>
    )
  }

  function normOcr(s) {
    return (s || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim()
  }

  function pickOcr(text, regex) {
    const m = normOcr(text).match(regex)
    return m ? (m[1] || "").trim() : ""
  }

  function limparCampoOcr(valor) {
    return (valor || "")
      .replace(/\s+(Gest[aã]o do Processo|Condutor do processo|Homologadores|Equipe de Apoio)\b[\s\S]*$/i, "")
      .replace(/\s+(Invers[aã]o de fases|Garantia de Proposta|Per[ií]odo de recebimento|Crit[eé]rio de julgamento|Objeto|Modo de Disputa|Aquisi[cç][aã]o|Data limite)\b[\s\S]*$/i, "")
      .replace(/\s+/g, " ")
      .replace(/\s*[-–]\s*RR$/i, "")
      .trim()
  }

  function limparObjetoOcr(valor) {
    return (valor || "")
      .replace(/\s+(Modo de Disputa|Aquisi[cç][aã]o|Data limite|Edital\/Anexos)\b[\s\S]*$/i, "")
      .replace(/\s*;\s*(M[áa]rcio de Lima|Paulo Henrique dos Santos|Silvana Patroc[ií]nio|Luis Fernando de Andrade Terra|Tais Maria Hellu Faleiros|MARIA EDUARDA LEITE|GUIRALDELLI)\b.*$/i, "")
      .replace(/\s+Condutor do processo:\s*[^;.\n]+/gi, " ")
      .replace(/\s+Homologadores\s+[^;.\n]+/gi, " ")
      .replace(/\s+Equipe de Apoio\s+[^;.\n]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function titleCaseOcr(valor) {
    return (valor || "").toLowerCase().replace(/\b([\p{L}])/gu, c => c.toUpperCase())
  }

  function aplicarTextoPrint(texto) {
    const t = normOcr(texto)
    const flat = t.replace(/\n+/g, " ")
    const patch = {}

    if (/licitanet/i.test(flat) || /preg[aã]o eletr[oô]nico|invers[aã]o de fases|gest[aã]o do processo/i.test(flat)) {
      patch.portal = "Licitanet"
    }

    const orgaoFundo = flat.match(/(FUNDO SOCIAL DE SOLIDARIEDADE DE\s+([A-ZÃÃ‰ÃÃ“ÃšÃ‚ÃŠÃ”ÃƒÕÇ\s]+?)\/([A-Z]{2}))/i)
    if (orgaoFundo) {
      patch.orgao = titleCaseOcr(orgaoFundo[1])
      patch.municipio = titleCaseOcr(orgaoFundo[2])
      patch.uf = orgaoFundo[3].toUpperCase()
    }

    const status = pickOcr(flat, /Status\s+(.+?)(?=\s+Informa[cç][õo]es|\s+Modalidade|\s+Edital\/Anexos|$)/i)
    if (/recebendo\s+proposta/i.test(status)) {
      patch.fase_atual = "Recebendo Proposta"
    }

    const modalidade = limparCampoOcr(pickOcr(flat, /Modalidade:\s*([^\.]+?)(?=\s+Invers[aã]o|\s+Garantia|\s+Per[ií]odo|$)/i))
    if (modalidade) patch.modalidade = modalidade

    const periodo = flat.match(/Per[ií]odo de recebimento:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)\s*at[eé]\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i)
    if (periodo) {
      patch.data_inicio_propostas = periodo[1]
      patch.data_fim_propostas = periodo[2]
    }

    const disputa = flat.match(/Disputa\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/i)
    if (disputa) patch.data_sessao = `${disputa[1]} ${disputa[2]}`
    else if (periodo) patch.data_sessao = periodo[2]

    const criterio = limparCampoOcr(pickOcr(flat, /Crit[eé]rio de julgamento:\s*([^\.]+?)(?=\s+Objeto|\s+Modo|\s+Aquisi[cç][aã]o|\s+Gest[aã]o do Processo|\s+Condutor do processo|$)/i))
    if (criterio) patch.tipo_lance = criterio

    const objeto = limparObjetoOcr(pickOcr(flat, /Objeto\s+(.+?)(?=\s+Modo de Disputa:|\s+Aquisi[cç][aã]o:|\s+Data limite|\s+Edital\/Anexos|$)/i))
    if (objeto) patch.objeto = objeto

    const modo = limparCampoOcr(pickOcr(flat, /Modo de Disputa:\s*([^\.]+?)(?=\s+Aquisi[cç][aã]o|\s+Data limite|\s+Equipe de Apoio|\s+Homologadores|$)/i))
    if (modo) patch.modo_disputa = modo

    const imp = pickOcr(flat, /Data limite para solicita[cç][aã]o de impugna[cç][aã]o e esclarecimento:\s*(\d{2}\/\d{2}\/\d{4})/i)
    if (imp) {
      patch.prazo_impugnacao = imp
      patch.prazo_esclarecimentos = imp
    }

    const anexo = pickOcr(flat, /Edital\/Anexos\s+([^\s]+?\.(?:zip|pdf|rar|docx?))/i)
    if (anexo) patch.arquivos = [{ nome: anexo, criado_em: "", url: "" }]

    const palavras = detectKeywordsLocal(patch.objeto || flat)
    if (palavras.length) patch.palavras_chave = palavras

    setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== "" && v != null)) }))
  }

  function detectKeywordsLocal(texto) {
    const n = (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    return TODAS_KEYWORDS.filter(kw => {
      const k = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      return n.includes(k) || (k.includes("viagem") && n.includes("viagem")) || (k.includes("transporte") && n.includes("transporte"))
    })
  }

  async function lerPrintComOcr(dataUrl) {
    setOcrLoading(true)
    setOcrErro("")
    setOcrTexto("")
    try {
      const Tesseract = await import("tesseract.js")
      const result = await Tesseract.recognize(dataUrl, "por", {
        logger: () => {},
      })
      const texto = result?.data?.text || ""
      setOcrTexto(texto)
      if (!texto.trim()) {
        setOcrErro("Não consegui ler texto nesse print. Tente recortar mais perto da área de informações.")
      } else {
        aplicarTextoPrint(texto)
      }
    } catch (e) {
      setOcrErro("Não foi possível ler o print automaticamente: " + (e?.message || e))
    } finally {
      setOcrLoading(false)
    }
  }

  function handlePrintUpload(file) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      alert("Selecione uma imagem do print.")
      return
    }
    if (file.size > 2.5 * 1024 * 1024) {
      alert("Esse print está muito grande. Use uma imagem menor que 2,5 MB para não pesar o arquivo local.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || "")
      setForm(f => ({
        ...f,
        print_nome: file.name || "print-colado.png",
        print_data_url: dataUrl,
      }))
      lerPrintComOcr(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  function handlePrintPaste(e) {
    const items = Array.from(e.clipboardData?.items || [])
    const item = items.find(i => i.type && i.type.startsWith("image/"))
    if (!item) return false
    const file = item.getAsFile()
    if (!file) return false
    e.preventDefault()
    handlePrintUpload(file)
    return true
  }

  useEffect(() => {
    if (step !== STEP_FORM) return
    function onPaste(e) {
      handlePrintPaste(e)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [step])

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 200, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16
      }}
    >
      <div style={{
        background: "#fff", borderRadius: 12, width: "min(900px, 100%)",
        maxHeight: "92vh", overflow: "auto",
        boxShadow: "0 25px 80px rgba(0,0,0,0.18)"
      }}>

        {/* ── Cabeçalho ── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 22px", background: "#1e293b", color: "#fff",
          borderRadius: "12px 12px 0 0"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>📥</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Importar Licitação</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>
                {step === STEP_URL  && "Cole o link do processo para buscar automaticamente"}
                {step === STEP_FORM && "Revise e edite os dados extraídos antes de salvar"}
                {step === STEP_DONE && "Licitação importada com sucesso!"}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, color: "#fff", padding: "5px 10px", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "22px 24px" }}>

          {/* ════════ STEP 1: URL ════════ */}
          {step === STEP_URL && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{
                padding: "14px 16px", background: "#eff6ff",
                border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 13, color: "#1e40af"
              }}>
                <strong>Como funciona:</strong> Cole o link interno do processo (ex: bllcompras.com/Process/ProcessView?param1=...) e clique em <strong>Buscar</strong>. O sistema acessa a página e preenche automaticamente todos os campos disponíveis.
              </div>

              <div style={fieldStyle}>
                <label style={{ ...labelStyle, fontSize: 12 }}>LINK DO PROCESSO *</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="url"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !loading && handleBuscar()}
                    placeholder="https://bllcompras.com/Process/ProcessView?param1=..."
                    style={{ ...inputStyle, flex: 1 }}
                    autoFocus
                  />
                  <button
                    onClick={handleBuscar}
                    disabled={loading}
                    style={{
                      padding: "8px 20px", borderRadius: 6, border: "none",
                      background: loading ? "#94a3b8" : "#1d4ed8",
                      color: "#fff", fontWeight: 700, fontSize: 13,
                      cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap"
                    }}
                  >
                    {loading ? "🔍 Buscando..." : "🔍 Buscar"}
                  </button>
                  <button
                    onClick={() => {
                      setForm(f => ({ ...f, link_licitacao: urlInput }))
                      setErroScrape("")
                      setStep(STEP_FORM)
                    }}
                    disabled={loading}
                    style={{
                      padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1",
                      background: "#fff", color: "#334155", fontWeight: 700, fontSize: 13,
                      cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap"
                    }}
                  >
                    ✏️ Preencher manualmente
                  </button>
                </div>
                {loading && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                    ⏳ Acessando a página do processo, aguarde... (pode levar até 1-2 minutos se o portal estiver com rate-limit)
                  </div>
                )}
                {erroScrape && (
                  <div style={{
                    marginTop: 8, padding: "10px 14px", borderRadius: 6,
                    background: "#fef2f2", border: "1px solid #fecaca",
                    color: "#dc2626", fontSize: 13
                  }}>
                    ⚠️ {erroScrape}
                    {/timeout/i.test(erroScrape) && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#7f1d1d", lineHeight: 1.5 }}>
                        <strong>Provavelmente é rate-limit do portal.</strong> Aguarde 1-2 minutos
                        e clique em <strong>🔄 Tentar novamente</strong>. Se importou várias seguidas,
                        o portal bloqueia temporariamente.
                      </div>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        onClick={handleBuscar}
                        style={{
                          padding: "6px 12px", borderRadius: 5, border: "1px solid #1d4ed8",
                          background: "#1d4ed8", color: "#fff", cursor: "pointer",
                          fontSize: 12, fontWeight: 600
                        }}
                      >
                        🔄 Tentar novamente
                      </button>
                      <button
                        onClick={() => { setForm(f => ({ ...f, link_licitacao: urlInput })); setStep(STEP_FORM); setErroScrape("") }}
                        style={{
                          padding: "6px 12px", borderRadius: 5, border: "1px solid #d1d5db",
                          background: "#fff", color: "#374151", cursor: "pointer",
                          fontSize: 12, fontWeight: 600
                        }}
                      >
                        ✏️ Preencher manualmente
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                Portais suportados: BLL Compras, Compras.gov, Portal de Compras Públicas, Licitações-e, Licitanet, ComprasNet e outros.
              </div>
            </div>
          )}

          {/* ════════ STEP 2: FORMULÁRIO ════════ */}
          {step === STEP_FORM && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

              {/* Aviso de duplicata */}
              {duplicada && (
                <div style={{
                  padding: "12px 14px", background: "#fef2f2",
                  border: "1px solid #fca5a5", borderRadius: 8,
                  display: "flex", flexDirection: "column", gap: 6
                }}>
                  <div style={{ fontSize: 13, color: "#991b1b", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    ⚠️ Licitação já cadastrada
                  </div>
                  <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.5 }}>
                    Encontrei outra licitação com {motivoDuplicada(duplicada.tipo)}.
                    <br/>
                    <strong>Órgão:</strong> {duplicada.licitacao.orgao || "—"}{" · "}
                    <strong>Edital:</strong> {duplicada.licitacao.num_edital || "—"}{" · "}
                    <strong>Status:</strong> {duplicada.licitacao.status_triagem || "—"}
                    {duplicada.licitacao.observacoes && (
                      <><br/><strong>Observações:</strong> {duplicada.licitacao.observacoes}</>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 2 }}>
                    Você pode revisar e cancelar, ou continuar e salvar mesmo assim (vai gerar duplicata).
                  </div>
                </div>
              )}

              {/* Aviso de campos automáticos */}
              <div style={{
                padding: "10px 14px", background: "#f0fdf4",
                border: "1px solid #bbf7d0", borderRadius: 8,
                fontSize: 12, color: "#15803d", display: "flex", alignItems: "center", gap: 8
              }}>
                <span>✅</span>
                <span>
                  Dados extraídos automaticamente da página. Revise os campos, edite o que precisar e clique em <strong>Salvar</strong>.
                  Os campos vazios não foram encontrados na página — preencha manualmente se necessário.
                </span>
              </div>

              {/* ── Seção 1: Identificação ── */}
              <div>
                <h3 style={sectionHead}>1 — Identificação do processo</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" }}>
                  {/* Portal */}
                  <div style={fieldStyle}>
                    <label style={labelStyle}>PORTAL DE ORIGEM *</label>
                    <select
                      value={form.portal}
                      onChange={e => setField("portal", e.target.value)}
                      style={{ ...inputStyle }}
                    >
                      {PORTAIS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>

                  <Campo label="Órgão / Promotor" fieldKey="orgao" placeholder="Ex: MUNICIPIO DE SANTO ESTEVÃO" full />

                  {/* UF */}
                  <div style={fieldStyle}>
                    <label style={labelStyle}>ESTADO (UF)</label>
                    <select value={form.uf} onChange={e => setField("uf", e.target.value)} style={inputStyle}>
                      <option value="">—</option>
                      {UFS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>

                  <Campo label="Município"           fieldKey="municipio"     placeholder="Ex: Santo Estevão" />
                  <Campo label="Número do Edital"    fieldKey="num_edital"    placeholder="Ex: 019/2026PERP" />
                  <Campo label="Processo Administrativo" fieldKey="numero_processo" placeholder="Ex: 103/2026" />

                  {/* Link da licitação — span full */}
                  <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>LINK DA LICITAÇÃO</label>
                    <input
                      type="url"
                      value={form.link_licitacao}
                      onChange={e => setField("link_licitacao", e.target.value)}
                      style={{ ...inputStyle, color: "#2563eb" }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Seção 2: Características ── */}
              <div>
                <h3 style={sectionHead}>2 — Características</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" }}>
                  <Campo label="Modalidade"       fieldKey="modalidade"    placeholder="Ex: Pregão Eletrônico" />
                  <Campo label="Tipo de Contrato" fieldKey="tipo_contrato" placeholder="Ex: Registro de Preço" />
                  <Campo label="Fase Atual"       fieldKey="fase_atual"    placeholder="Ex: Recepção de Propostas" />
                  <Campo label="Tipo de Lance"    fieldKey="tipo_lance"    placeholder="Ex: Menor Lance" />
                  <Campo label="Modo de Disputa"  fieldKey="modo_disputa"  placeholder="Ex: Aberto" />

                  {/* Exclusividade ME/EPP */}
                  <div style={fieldStyle}>
                    <label style={labelStyle}>EXCLUSIVIDADE ME/EPP</label>
                    <select value={form.exclusivo_me_epp} onChange={e => setField("exclusivo_me_epp", e.target.value)} style={inputStyle}>
                      <option value="">—</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  {/* Exclusivo Regional */}
                  <div style={fieldStyle}>
                    <label style={labelStyle}>EXCLUSIVO REGIONAL / LOCAL</label>
                    <select value={form.exclusivo_regional} onChange={e => setField("exclusivo_regional", e.target.value)} style={inputStyle}>
                      <option value="">—</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>

                  <Campo label="Validade da Proposta" fieldKey="validade_proposta" placeholder="Ex: 12 meses" />
                </div>
              </div>

              {/* ── Seção 3: Datas ── */}
              <div>
                <h3 style={sectionHead}>3 — Datas e prazos</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 16px" }}>
                  <Campo label="Data de Publicação"               fieldKey="data_publicacao"       placeholder="dd/mm/aaaa hh:mm" />
                  <Campo label="Início Recebimento de Propostas"  fieldKey="data_inicio_propostas" placeholder="dd/mm/aaaa hh:mm" />

                  {/* Data fim propostas — destaque */}
                  <div style={{ ...fieldStyle }}>
                    <label style={{ ...labelStyle, color: "#dc2626" }}>
                      FIM RECEBIMENTO DE PROPOSTAS ⚠️
                    </label>
                    <input
                      type="text"
                      value={form.data_fim_propostas}
                      onChange={e => setField("data_fim_propostas", e.target.value)}
                      placeholder="dd/mm/aaaa hh:mm"
                      style={{ ...inputStyle, borderColor: "#fca5a5", background: "#fff5f5" }}
                    />
                  </div>

                  {/* Data sessão — destaque secundário */}
                  <div style={fieldStyle}>
                    <label style={{ ...labelStyle, color: "#1d4ed8" }}>
                      DATA / HORA DA SESSÃO (DISPUTA) 🔔
                    </label>
                    <input
                      type="text"
                      value={form.data_sessao}
                      onChange={e => setField("data_sessao", e.target.value)}
                      placeholder="dd/mm/aaaa hh:mm"
                      style={{ ...inputStyle, borderColor: "#bfdbfe", background: "#eff6ff" }}
                    />
                  </div>

                  <Campo label="Prazo Final de Impugnação"    fieldKey="prazo_impugnacao"     placeholder="dd/mm/aaaa hh:mm" />
                  <Campo label="Prazo Final de Esclarecimentos" fieldKey="prazo_esclarecimentos" placeholder="dd/mm/aaaa hh:mm" />
                </div>
              </div>

              {/* ── Seção 4: Objeto e valor ── */}
              <div>
                <h3 style={sectionHead}>4 — Objeto e valor estimado</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
                  <Campo label="Objeto da Licitação" fieldKey="objeto" textarea full
                    placeholder="Descrição do objeto da contratação..." />
                  <Campo label="Valor Total Estimado" fieldKey="valor_estimado"
                    placeholder="Ex: R$ 250.000,00 ou não identificado automaticamente" />
                </div>
              </div>

              {/* ── Seção 5: Palavras-chave ── */}
              <div>
                <h3 style={sectionHead}>5 — Palavras-chave encontradas</h3>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>
                  Marque os serviços identificados no objeto desta licitação:
                </p>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 8
                }}>
                  {TODAS_KEYWORDS.map(kw => {
                    const marcado = (form.palavras_chave || []).includes(kw)
                    return (
                      <label key={kw} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                        background: marcado ? "#f0fdf4" : "#f9fafb",
                        border: `1px solid ${marcado ? "#86efac" : "#e5e7eb"}`,
                        fontSize: 13, color: marcado ? "#15803d" : "#374151",
                        fontWeight: marcado ? 600 : 400,
                        transition: "all 0.1s"
                      }}>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggleKeyword(kw)}
                          style={{ margin: 0, accentColor: "#16a34a" }}
                        />
                        {kw}
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* ── Arquivos do Processo ── */}
              {Array.isArray(form.arquivos) && form.arquivos.length > 0 && (
                <div style={{
                  background: "#fffbeb", border: "1px solid #fde68a",
                  borderRadius: 8, padding: 14
                }}>
                  <h3 style={{ margin: "0 0 10px 0", fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                    📎 Arquivos do Processo ({form.arquivos.length})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {form.arquivos.map((arq, i) => (
                      <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 10px", background: "#fff", borderRadius: 6,
                        border: "1px solid #fcd34d", fontSize: 13
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                          <span style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📄 {arq.nome}
                          </span>
                          {arq.criado_em && (
                            <span style={{ fontSize: 11, color: "#6b7280" }}>
                              Criado em {arq.criado_em}
                            </span>
                          )}
                        </div>
                        <a
                          href={downloadArquivoUrl(arq)}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={arq.nome}
                          style={{
                            padding: "6px 12px", background: "#f59e0b", color: "#fff",
                            borderRadius: 6, fontSize: 12, fontWeight: 600,
                            textDecoration: "none", whiteSpace: "nowrap", marginLeft: 10
                          }}
                        >
                          ⬇ Baixar
                        </a>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "10px 0 0 0", fontSize: 11, color: "#92400e" }}>
                    Os arquivos ficam hospedados no portal BLL. Os links são salvos junto com a licitação.
                  </p>
                </div>
              )}

              {/* ── Print / imagem do processo ── */}
              <div style={{
                background: "#f8fafc", border: "1px solid #cbd5e1",
                borderRadius: 8, padding: 14
              }} tabIndex={0} onPaste={handlePrintPaste}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 700, color: "#334155" }}>
                  🖼️ Print da Licitação
                </h3>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b" }}>
                  Use quando o portal não permitir importar pelo link. Cole com <strong>Ctrl+V</strong> ou anexe uma imagem. O print fica salvo junto com a licitação.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <label style={{
                    padding: "8px 14px", borderRadius: 6, border: "1px solid #1d4ed8",
                    background: "#eff6ff", color: "#1d4ed8", cursor: "pointer",
                    fontSize: 13, fontWeight: 700
                  }}>
                    Anexar print
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={e => handlePrintUpload(e.target.files?.[0])}
                    />
                  </label>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    ou copie o print da tela e aperte <strong>Ctrl+V</strong>
                  </span>
                  {form.print_nome && (
                    <>
                      <span style={{ fontSize: 12, color: "#475569" }}>{form.print_nome}</span>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, print_nome: "", print_data_url: "" }))}
                        style={btnStyle("#fee2e2", "#b91c1c", true)}
                      >
                        Remover
                      </button>
                    </>
                  )}
                </div>
                {form.print_data_url && (
                  <img
                    src={form.print_data_url}
                    alt="Print da licitação"
                    style={{ marginTop: 12, maxWidth: "100%", maxHeight: 280, borderRadius: 8, border: "1px solid #cbd5e1", objectFit: "contain" }}
                  />
                )}
                {ocrLoading && (
                  <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 12 }}>
                    🔎 Lendo texto do print e tentando preencher os campos...
                  </div>
                )}
                {ocrErro && (
                  <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 12 }}>
                    ⚠️ {ocrErro}
                  </div>
                )}
                {ocrTexto && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#334155" }}>
                      Texto lido do print
                    </summary>
                    <textarea
                      value={ocrTexto}
                      onChange={e => {
                        setOcrTexto(e.target.value)
                        aplicarTextoPrint(e.target.value)
                      }}
                      rows={5}
                      style={{ marginTop: 8, width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12, fontFamily: "monospace" }}
                    />
                  </details>
                )}
              </div>

              {/* ── Botões ── */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", paddingTop: 12,
                borderTop: "1px solid #e5e7eb", flexWrap: "wrap", gap: 10
              }}>
                <button
                  onClick={() => setStep(STEP_URL)}
                  style={btnStyle("#f3f4f6", "#374151", true)}
                >
                  ← Voltar e buscar outro link
                </button>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={onClose} style={btnStyle("#fef2f2", "#dc2626", true)}>
                    Cancelar
                  </button>
                  <button
                    onClick={handleSalvar}
                    disabled={saving}
                    style={{
                      ...btnStyle("#1d4ed8", "#fff", true),
                      opacity: saving ? 0.6 : 1,
                      cursor: saving ? "not-allowed" : "pointer"
                    }}
                  >
                    {saving ? "⏳ Salvando..." : "✅ Salvar Licitação"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ════════ STEP 3: CONCLUÍDO ════════ */}
          {step === STEP_DONE && (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", gap: 16, padding: "24px 0", textAlign: "center"
            }}>
              <div style={{ fontSize: 52 }}>✅</div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111827" }}>
                Licitação importada com sucesso!
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280", maxWidth: 400 }}>
                A licitação de <strong>{form.orgao || "origem desconhecida"}</strong>{" "}
                foi adicionada ao painel e já aparece na lista.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button
                  onClick={() => {
                    setStep(STEP_URL); setUrlInput(""); setErroScrape("")
                    setForm({ portal: "BLL Compras", link_licitacao: "", orgao: "", uf: "", municipio: "", num_edital: "", numero_processo: "", modalidade: "", tipo_contrato: "", fase_atual: "", data_publicacao: "", data_inicio_propostas: "", data_fim_propostas: "", data_sessao: "", prazo_impugnacao: "", prazo_esclarecimentos: "", validade_proposta: "", tipo_lance: "", modo_disputa: "", exclusivo_me_epp: "", exclusivo_regional: "", objeto: "", valor_estimado: "", palavras_chave: [], arquivos: [], print_nome: "", print_data_url: "" })
                  }}
                  style={btnStyle("#eff6ff", "#1d4ed8", true)}
                >
                  ➕ Importar outra
                </button>
                <button onClick={onClose} style={btnStyle("#1e293b", "#fff", true)}>
                  Fechar
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── PÁGINA: LISTA ─────────────────────────────────────────────────────────────
function PaginaLicitacoes({ licitacoes, onSelect, onToggleRelevante, onObservacao, onStatusChange, onDelete, saving }) {
  const filtrosIniciais = useMemo(() => carregarFiltrosLista(), [])
  const [search,       setSearch]       = useState(filtrosIniciais.search || "")
  const [filtPortal,   setFiltPortal]   = useState(filtrosIniciais.filtPortal || "")
  const [filtCategoria,setFiltCategoria]= useState(filtrosIniciais.filtCategoria || "")
  const [filtModalidade,setFiltModalidade]= useState(filtrosIniciais.filtModalidade ?? "sem_credenciamento")
  const [filtUF,       setFiltUF]       = useState(filtrosIniciais.filtUF || "")
  const [filtSituacao, setFiltSituacao] = useState(filtrosIniciais.filtSituacao || "")
  const [filtRelevante,setFiltRelevante]= useState(filtrosIniciais.filtRelevante || "")
  const [filtStatus,   setFiltStatus]   = useState(filtrosIniciais.filtStatus || "")
  const [filtData,     setFiltData]     = useState(filtrosIniciais.filtData || "")        // preset: hoje, 3d, 7d, 30d, vencidas, range
  const [filtDataDe,   setFiltDataDe]   = useState(filtrosIniciais.filtDataDe || "")        // YYYY-MM-DD (input type=date)
  const [filtDataAte,  setFiltDataAte]  = useState(filtrosIniciais.filtDataAte || "")        // YYYY-MM-DD
  const [filtCampoData,setFiltCampoData]= useState(filtrosIniciais.filtCampoData || "data_fim_propostas") // qual campo de data
  const [filtFinanceiro,setFiltFinanceiro] = useState(filtrosIniciais.filtFinanceiro || "")     // "" | "indices" | "pl" | "qualquer" | "sem" | "nao_analisado"
  const [filtPrazo,    setFiltPrazo]    = useState(filtrosIniciais.filtPrazo || "ativas")
  const [ordenacao,    setOrdenacao]    = useState(filtrosIniciais.ordenacao || { campo: "", direcao: "asc" })
  const [obsModal,     setObsModal]     = useState(null)
  const [obsTexto,     setObsTexto]     = useState("")
  const [savingObs,    setSavingObs]    = useState(false)

  useEffect(() => {
    salvarFiltrosLista({
      search, filtPortal, filtCategoria, filtModalidade, filtUF, filtSituacao,
      filtRelevante, filtStatus, filtData, filtDataDe, filtDataAte,
      filtCampoData, filtFinanceiro, filtPrazo, ordenacao,
    })
  }, [search, filtPortal, filtCategoria, filtModalidade, filtUF, filtSituacao, filtRelevante, filtStatus, filtData, filtDataDe, filtDataAte, filtCampoData, filtFinanceiro, filtPrazo, ordenacao])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(LISTA_SCROLL_KEY)
      const y = raw ? Number(raw) : 0
      if (!Number.isNaN(y) && y > 0) {
        requestAnimationFrame(() => window.scrollTo(0, y))
      }
    } catch {}
  }, [])

  function abrirDetalhePreservandoLista(l) {
    try {
      const y = window.scrollY || document.documentElement.scrollTop || 0
      sessionStorage.setItem(LISTA_SCROLL_KEY, String(y))
    } catch {}
    onSelect(l)
  }

  /** Range [início, fim] em ms para o preset/range customizado, ou null se sem filtro. */
  const rangeData = useMemo(() => {
    if (!filtData) return null
    const agora = new Date()
    const hojeIni = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0)
    const hojeFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59)
    const dia = 24 * 3600 * 1000
    if (filtData === "hoje")     return [hojeIni.getTime(), hojeFim.getTime()]
    if (filtData === "amanha")   return [hojeIni.getTime() + dia, hojeFim.getTime() + dia]
    if (filtData === "3d")       return [hojeIni.getTime(), hojeFim.getTime() + 3 * dia]
    if (filtData === "7d")       return [hojeIni.getTime(), hojeFim.getTime() + 7 * dia]
    if (filtData === "30d")      return [hojeIni.getTime(), hojeFim.getTime() + 30 * dia]
    if (filtData === "vencidas") return [0, hojeIni.getTime() - 1]
    if (filtData === "range") {
      const ini = filtDataDe  ? new Date(filtDataDe  + "T00:00:00").getTime() : 0
      const fim = filtDataAte ? new Date(filtDataAte + "T23:59:59").getTime() : 8.64e15
      return [ini, fim]
    }
    return null
  }, [filtData, filtDataDe, filtDataAte])

  function participandoFixadoAteDiaSeguinte(l, agora = new Date()) {
    if ((l.status_triagem || "") !== "participando") return false
    if (!l.participou_em) return false
    const dataParticipacao = new Date(l.participou_em)
    if (Number.isNaN(dataParticipacao.getTime())) return false
    const inicioParticipacao = new Date(dataParticipacao.getFullYear(), dataParticipacao.getMonth(), dataParticipacao.getDate(), 0, 0, 0)
    const fimDiaSeguinte = new Date(inicioParticipacao.getTime() + 2 * 24 * 3600 * 1000 - 1)
    return agora >= inicioParticipacao && agora <= fimDiaSeguinte
  }

  const filtered = useMemo(() => {
    const agora = new Date()
    return licitacoes.filter(l => {
      if (filtPortal    && l.portal           !== filtPortal)    return false
      if (filtCategoria && !categoriasDaLicitacao(l).includes(filtCategoria)) return false
      const modalidadeFiltro = modalidadeFiltroDaLicitacao(l)
      if (filtModalidade === "sem_credenciamento" && modalidadeFiltro === "credenciamento") return false
      if (filtModalidade && filtModalidade !== "sem_credenciamento" && modalidadeFiltro !== filtModalidade) return false
      if (filtUF        && l.uf               !== filtUF)        return false
      if (filtSituacao  && l.situacao         !== filtSituacao)  return false
      if (filtRelevante === "sim" && !l.relevante)               return false
      if (filtRelevante === "nao" &&  l.relevante)               return false
      if (filtStatus    && l.status_triagem   !== filtStatus)    return false
      const dataLimite = parseBrDateTime(l.data_fim_propostas) || parseBrDateTime(l.data_sessao)
      const passou = !!dataLimite && dataLimite < agora
      const participou = ["participando", "ganhamos", "perdemos"].includes(l.status_triagem || "")
      const fixadoParticipando = participandoFixadoAteDiaSeguinte(l, agora)
      const arquivada = situacaoArquivada(l.situacao || l.fase_atual)
      if (filtPrazo === "ativas" && (passou || arquivada) && !fixadoParticipando) return false
      if (filtPrazo === "passadas" && !passou) return false
      if (filtPrazo === "participadas" && !participou) return false
      if (filtPrazo === "arquivadas" && !arquivada) return false
      if (rangeData) {
        const d = parseBrDateTime(l[filtCampoData])
        if (!d) return fixadoParticipando && filtData === "amanha"
        const t = d.getTime()
        if ((t < rangeData[0] || t > rangeData[1]) && !(fixadoParticipando && filtData === "amanha")) return false
      }
      if (filtFinanceiro) {
        const analisado = !!l.analisado_em || !!l.analises_pdf
        if (filtFinanceiro === "indices"       && !l.tem_indices_financeiros) return false
        if (filtFinanceiro === "pl"            && !l.tem_pl_minimo)           return false
        if (filtFinanceiro === "qualquer"      && !(l.tem_indices_financeiros || l.tem_pl_minimo)) return false
        if (filtFinanceiro === "sem"           && (!analisado || l.tem_indices_financeiros || l.tem_pl_minimo)) return false
        if (filtFinanceiro === "nao_analisado" && analisado)                  return false
      }
      if (search) {
        const s = textoNormalizado(search)
        if (
          !textoNormalizado(l.objeto).includes(s) &&
          !textoNormalizado(l.orgao).includes(s)  &&
          !textoNormalizado(l.numero_processo).includes(s) &&
          !textoNormalizado(l.municipio).includes(s)
        ) return false
      }
      return true
    })
  }, [licitacoes, filtPortal, filtCategoria, filtModalidade, filtUF, filtSituacao, filtRelevante, filtStatus, search, rangeData, filtData, filtCampoData, filtFinanceiro, filtPrazo])

  const temFiltro = filtPortal || filtCategoria || filtModalidade !== "sem_credenciamento" || filtUF || filtSituacao || filtRelevante || filtStatus || search || filtData || filtFinanceiro || filtPrazo !== "ativas"

  function licitacaoPassou(l) {
    const dataLimite = parseBrDateTime(l.data_fim_propostas) || parseBrDateTime(l.data_sessao)
    return !!dataLimite && dataLimite < new Date()
  }

  const colunasOrdenaveis = {
    "Rel.": { campo: "relevante", tipo: "boolean" },
    "Portal": { campo: "portal", tipo: "text" },
    "Órgão / Município": { campo: "orgao", tipo: "text" },
    "UF": { campo: "uf", tipo: "text" },
    "Objeto / Categoria": { campo: "objeto", tipo: "text" },
    "Modalidade": { campo: "modalidade", tipo: "text" },
    "Valor": { campo: "valor_estimado", tipo: "money" },
    "Cronograma": { campo: "data_fim_propostas", tipo: "date" },
    "Situação": { campo: "situacao", tipo: "text" },
    "Financ.": { campo: "financeiro", tipo: "text" },
    "Status": { campo: "status_triagem", tipo: "text" },
  }

  function valorOrdenacao(l, def) {
    if (!def) return ""
    if (def.campo === "financeiro") {
      const analisado = !!l.analisado_em || !!l.analises_pdf
      if (!analisado) return "0-nao-analisado"
      if (l.tem_indices_financeiros && l.tem_pl_minimo) return "3-indices-pl"
      if (l.tem_indices_financeiros) return "2-indices"
      if (l.tem_pl_minimo) return "2-pl"
      return "1-sem-criterio"
    }
    if (def.tipo === "date") {
      const d = parseBrDateTime(l[def.campo])
      return d ? d.getTime() : null
    }
    if (def.tipo === "money") return parseValorBR(l[def.campo]) || 0
    if (def.tipo === "boolean") return l[def.campo] ? 1 : 0
    return (l[def.campo] || "").toString().toLowerCase()
  }

  function alternarOrdenacao(header) {
    const def = colunasOrdenaveis[header]
    if (!def) return
    setOrdenacao(o => ({
      campo: def.campo,
      direcao: o.campo === def.campo && o.direcao === "asc" ? "desc" : "asc",
    }))
  }

  const sorted = useMemo(() => {
    if (!ordenacao?.campo) return filtered
    const header = Object.keys(colunasOrdenaveis).find(h => colunasOrdenaveis[h].campo === ordenacao.campo)
    const def = header ? colunasOrdenaveis[header] : null
    if (!def) return filtered
    const dir = ordenacao.direcao === "desc" ? -1 : 1
    return [...filtered].sort((a, b) => {
      const av = valorOrdenacao(a, def)
      const bv = valorOrdenacao(b, def)
      const vazioA = av === null || av === undefined || av === ""
      const vazioB = bv === null || bv === undefined || bv === ""
      if (vazioA && vazioB) return 0
      if (vazioA) return 1
      if (vazioB) return -1
      if (av > bv) return dir
      if (av < bv) return -dir
      return 0
    })
  }, [filtered, ordenacao])

  function limparFiltros() {
    setFiltPortal(""); setFiltCategoria(""); setFiltModalidade("sem_credenciamento"); setFiltUF(""); setFiltSituacao("")
    setFiltRelevante(""); setFiltStatus(""); setSearch("")
    setFiltData(""); setFiltDataDe(""); setFiltDataAte("")
    setFiltFinanceiro("")
    setFiltPrazo("ativas")
  }

  function abrirObs(l) { setObsModal({ id: l.id }); setObsTexto(l.observacoes || "") }

  async function salvarObs() {
    setSavingObs(true)
    await onObservacao(obsModal.id, obsTexto)
    setSavingObs(false)
    setObsModal(null)
  }

  const selectStyle = {
    padding: "6px 10px", borderRadius: 5, border: "1px solid #d1d5db",
    fontSize: 13, background: "#fff", color: "#374151", cursor: "pointer", minWidth: 120
  }

  function HeaderOrdenavel({ h }) {
    const def = colunasOrdenaveis[h]
    const ativo = def && ordenacao?.campo === def.campo
    const seta = !ativo ? "↕" : (ordenacao.direcao === "asc" ? "↑" : "↓")
    return (
      <th
        key={h}
        onClick={def ? () => alternarOrdenacao(h) : undefined}
        title={def ? "Clique para ordenar" : undefined}
        style={{
          padding: "10px 8px",
          textAlign: "left",
          fontWeight: 600,
          fontSize: 12,
          color: ativo ? "#1d4ed8" : "#374151",
          whiteSpace: "nowrap",
          cursor: def ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {h}
          {def && <span style={{ fontSize: 11, color: ativo ? "#1d4ed8" : "#9ca3af" }}>{seta}</span>}
        </span>
      </th>
    )
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: "14px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="🔍 Buscar por objeto, órgão, processo, município..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 240, padding: "7px 12px", borderRadius: 5, border: "1px solid #d1d5db", fontSize: 13, color: "#374151" }}
          />
          <select value={filtPortal}    onChange={e => setFiltPortal(e.target.value)}    style={selectStyle}><option value="">Todos os portais</option>{PORTAIS.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <select value={filtCategoria} onChange={e => setFiltCategoria(e.target.value)} style={selectStyle}><option value="">Todas categorias</option>{CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</select>
          <select value={filtModalidade} onChange={e => setFiltModalidade(e.target.value)} style={{ ...selectStyle, minWidth: 170 }} title="Filtrar modalidade/tipo">
            {MODALIDADE_FILTROS.map(m => <option key={m.value || "todas"} value={m.value}>{m.label}</option>)}
          </select>
          <select value={filtUF}        onChange={e => setFiltUF(e.target.value)}        style={selectStyle}><option value="">Todas UFs</option>{UFS.map(u => <option key={u} value={u}>{u}</option>)}</select>
          <select value={filtSituacao}  onChange={e => setFiltSituacao(e.target.value)}  style={selectStyle}><option value="">Todas situações</option>{SITUACOES.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select value={filtStatus}    onChange={e => setFiltStatus(e.target.value)}    style={selectStyle}><option value="">Todos os status</option>{STATUS_TRIAGEM.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          <select value={filtRelevante} onChange={e => setFiltRelevante(e.target.value)} style={selectStyle}><option value="">Relevância</option><option value="sim">⭐ Relevantes</option><option value="nao">Não relevantes</option></select>
          <select
            value={filtPrazo}
            onChange={e => setFiltPrazo(e.target.value)}
            style={{ ...selectStyle, minWidth: 130 }}
            title="Separar licitações pelo prazo"
          >
            <option value="ativas">Ativas</option>
            <option value="passadas">Passadas</option>
            <option value="arquivadas">Arquivadas</option>
            <option value="participadas">Participadas</option>
            <option value="todas">Todas</option>
          </select>

          {/* Filtro de data: campo + preset */}
          <select
            value={filtCampoData}
            onChange={e => setFiltCampoData(e.target.value)}
            style={{ ...selectStyle, minWidth: 140 }}
            title="Qual data filtrar"
          >
            <option value="data_fim_propostas">📅 Fim Propostas</option>
            <option value="data_sessao">🎯 Data Sessão</option>
            <option value="data_publicacao">📰 Publicação</option>
            <option value="prazo_impugnacao">🛡️ Impugnação</option>
            <option value="prazo_esclarecimentos">❓ Esclarecimentos</option>
          </select>
          <select
            value={filtData}
            onChange={e => setFiltData(e.target.value)}
            style={{ ...selectStyle, minWidth: 150 }}
          >
            <option value="">Qualquer período</option>
            <option value="hoje">Hoje</option>
            <option value="amanha">Amanhã</option>
            <option value="3d">Próximos 3 dias</option>
            <option value="7d">Próximos 7 dias</option>
            <option value="30d">Próximos 30 dias</option>
            <option value="vencidas">Já vencidas</option>
            <option value="range">📆 Personalizado…</option>
          </select>
          {filtData === "range" && (
            <>
              <input
                type="date"
                value={filtDataDe}
                onChange={e => setFiltDataDe(e.target.value)}
                style={{ ...selectStyle, minWidth: 130 }}
                title="De"
              />
              <input
                type="date"
                value={filtDataAte}
                onChange={e => setFiltDataAte(e.target.value)}
                style={{ ...selectStyle, minWidth: 130 }}
                title="Até"
              />
            </>
          )}

          <select
            value={filtFinanceiro}
            onChange={e => setFiltFinanceiro(e.target.value)}
            style={{ ...selectStyle, minWidth: 170 }}
            title="Filtrar por critérios financeiros"
          >
            <option value="">Critérios financeiros</option>
            <option value="qualquer">⚠️ Com critérios (qualquer)</option>
            <option value="indices">📊 Com índices (LG/LC/SG)</option>
            <option value="pl">💼 Com PL mínimo</option>
            <option value="sem">✅ Sem critérios</option>
            <option value="nao_analisado">⚪ Não analisados</option>
          </select>

          {temFiltro && (
            <button onClick={limparFiltros} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #fca5a5", background: "#fef2f2", color: "#dc2626", fontSize: 13, cursor: "pointer" }}>✕ Limpar</button>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          {filtered.length} licitaç{filtered.length === 1 ? "ão" : "ões"} encontrada{filtered.length === 1 ? "" : "s"}
          {licitacoes.length !== filtered.length && ` (de ${licitacoes.length} no total)`}
          {filtPrazo === "ativas" && " · ocultando prazos já passados e situações arquivadas"}
        </div>
      </div>

      {/* Tabela */}
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "3%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "3%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {["Rel.", "Portal", "Órgão / Município", "UF", "Objeto / Categoria", "Modalidade", "Valor", "Cronograma", "Situação", "Financ.", "Status", "Ações"].map(h => (
                <HeaderOrdenavel key={h} h={h} />
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>Nenhuma licitação encontrada.</td></tr>
            )}
            {sorted.map((l, i) => {
              const passou = licitacaoPassou(l)
              const baseBg = passou ? "#f8fafc" : (i % 2 === 0 ? "#fff" : "#fafafa")
              const linkCorrigido = linkLicitacaoCorrigido(l)
              return (
              <tr key={l.id}
                style={{ borderBottom: "1px solid #f3f4f6", background: baseBg, opacity: passou ? 0.78 : 1 }}
                onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                onMouseLeave={e => e.currentTarget.style.background = baseBg}
                onContextMenu={e => {
                  if (!linkCorrigido) return
                  e.preventDefault()
                  window.open(linkCorrigido, "_blank", "noopener,noreferrer")
                }}
                title={linkCorrigido ? "Botão direito: abrir licitação em nova aba" : undefined}
              >
                {/* Relevante */}
                <td style={{ padding: "10px 8px" }}>
                  <button onClick={() => onToggleRelevante(l.id, l.relevante)} disabled={saving[l.id]}
                    title="Marcar como relevante"
                    style={{ background: "none", border: "none", cursor: saving[l.id] ? "wait" : "pointer", fontSize: 16, lineHeight: 1, opacity: saving[l.id] ? 0.5 : 1 }}>
                    {l.relevante ? "⭐" : "☆"}
                  </button>
                </td>
                {/* Portal */}
                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>{l.portal}</span>
                  {l.importado_manualmente && <span title="Importado manualmente" style={{ marginLeft: 4, fontSize: 10, color: "#7c3aed" }}>📥</span>}
                </td>
                {/* Órgão */}
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.orgao}>{l.orgao}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{l.municipio}</div>
                </td>
                {/* UF */}
                <td style={{ padding: "10px 8px" }}><span style={{ fontWeight: 600, color: "#374151" }}>{l.uf}</span></td>
                {/* Objeto */}
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ overflow: "hidden", color: "#374151", cursor: "pointer", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.35, minHeight: 32 }}
                    title={l.objeto} onClick={() => abrirDetalhePreservandoLista(l)}>
                    {l.objeto}
                  </div>
                  <div style={{ marginTop: 3 }}>
                    {categoriasDaLicitacao(l).slice(0, 3).map(cat => (
                      <span key={cat} style={{ marginRight: 4 }}>
                        <Badge text={CATEGORIA_LABEL[cat] || cat} color="#6366f1" small />
                      </span>
                    ))}
                    {categoriasDaLicitacao(l).length > 3 && <span style={{ fontSize: 11, color: "#64748b" }}>+{categoriasDaLicitacao(l).length - 3}</span>}
                    {l.observacoes && <span style={{ marginLeft: 5, fontSize: 11, color: "#9ca3af" }}>💬</span>}
                  </div>
                </td>
                {/* Modalidade */}
                <td style={{ padding: "10px 8px", fontSize: 12, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.modalidade}>{l.modalidade}</td>
                {/* Valor */}
                <td style={{ padding: "10px 8px", fontSize: 12, color: parseValorBR(l.valor_estimado) ? "#0f766e" : "#9ca3af", fontWeight: parseValorBR(l.valor_estimado) ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.valor_estimado || "Sem valor informado"}>
                  {parseValorBR(l.valor_estimado) ? formatBRL(parseValorBR(l.valor_estimado)) : "—"}
                </td>
                {/* Cronograma */}
                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                  {(() => {
                    const alerta = tempoRestanteLabel(l.data_fim_propostas || l.data_sessao)
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {alerta && !passou && (
                          <span style={{ alignSelf: "flex-start", padding: "2px 6px", borderRadius: 999, background: alerta.bg, color: alerta.color, fontSize: 10, fontWeight: 800 }}>
                            {alerta.text}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: l.data_fim_propostas ? "#dc2626" : "#9ca3af", fontWeight: l.data_fim_propostas ? 700 : 400 }}>
                          Fim: {l.data_fim_propostas || formatDate(l.data_disputa) || "—"}
                        </span>
                        <span style={{ fontSize: 11, color: "#1d4ed8" }}>
                          Sessão: {l.data_sessao || "—"}
                        </span>
                        {passou && <Badge text="Passada" color="#6b7280" small />}
                      </div>
                    )
                  })()}
                </td>
                {/* Situação */}
                <td style={{ padding: "10px 8px" }}>
                  <Badge text={l.situacao || "—"} color={SITUACAO_COLOR[l.situacao] || "#6b7280"} small />
                </td>
                {/* Critérios financeiros */}
                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                  {(() => {
                    const analisado = !!l.analisado_em || !!l.analises_pdf
                    if (!analisado) {
                      return <span title="Não analisado ainda" style={{ fontSize: 11, color: "#9ca3af" }}>⚪</span>
                    }
                    const pieces = []
                    if (l.tem_indices_financeiros) pieces.push(<span key="i" title="Tem índices LG/LC/SG" style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", marginRight: 3 }}>📊</span>)
                    if (l.tem_pl_minimo)            pieces.push(<span key="p" title="Tem PL mínimo"        style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }}>💼</span>)
                    if (l.tem_restricao_subcontratacao_hospedagem) pieces.push(<span key="h" title="Hospedagem com possível restrição a agência/subcontratação" style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "#fef2f2", color: "#991b1b", border: "1px solid #fca5a5", marginLeft: 3 }}>🏨</span>)
                    if (pieces.length === 0) return <span title="Sem critérios financeiros" style={{ fontSize: 11, color: "#15803d" }}>✅</span>
                    return <span style={{ display: "inline-flex" }}>{pieces}</span>
                  })()}
                </td>
                {/* Status triagem */}
                <td style={{ padding: "10px 8px" }}>
                  <select value={l.status_triagem || "novo"} onChange={e => onStatusChange(l.id, e.target.value)}
                    disabled={saving[l.id]}
                    style={{ padding: "3px 7px", borderRadius: 4, fontSize: 11, border: `1px solid ${STATUS_COLOR[l.status_triagem] || "#94a3b8"}60`, background: (STATUS_COLOR[l.status_triagem] || "#94a3b8") + "12", color: STATUS_COLOR[l.status_triagem] || "#94a3b8", cursor: "pointer", fontWeight: 600, opacity: saving[l.id] ? 0.5 : 1 }}>
                    {STATUS_TRIAGEM.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                {/* Ações */}
                <td style={{ padding: "10px 8px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => abrirDetalhePreservandoLista(l)} title="Ver detalhes" style={btnStyle("#e0f2fe", "#0369a1")}>🔍</button>
                    {linkCorrigido && (
                      <a href={linkCorrigido} target="_blank" rel="noreferrer" title="Abrir licitação">
                        <button style={btnStyle("#f0fdf4", "#15803d")}>🔗</button>
                      </a>
                    )}
                    <button onClick={() => abrirObs(l)} title="Observação" style={btnStyle("#fdf4ff", "#7e22ce")}>💬</button>
                    <button onClick={() => onDelete(l)} disabled={saving[l.id]} title="Excluir licitação" style={btnStyle("#fee2e2", "#b91c1c")}>🗑</button>
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Modal observação rápida */}
      {obsModal && (
        <div style={{ position: "fixed", inset: 0, background: "#0006", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 480, boxShadow: "0 20px 60px #0003" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>Observação</h3>
            <textarea value={obsTexto} onChange={e => setObsTexto(e.target.value)} rows={5}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              placeholder="Digite sua observação..." />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setObsModal(null)} style={btnStyle("#f3f4f6", "#374151", true)}>Cancelar</button>
              <button onClick={salvarObs} disabled={savingObs} style={btnStyle("#1d4ed8", "#fff", true)}>
                {savingObs ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PÁGINA: DETALHE ──────────────────────────────────────────────────────────
/** Renderiza painel com resultado da análise de um PDF. */
function PainelAnalisePdf({ analise }) {
  if (!analise) return null
  if (analise.loading) {
    return (
      <div style={{ marginTop: 8, padding: "14px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 13, color: "#1e40af" }}>
        ⏳ Baixando e analisando PDF…
      </div>
    )
  }
  if (!analise.ok) {
    return (
      <div style={{ marginTop: 8, padding: "14px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, color: "#991b1b" }}>
        ⚠️ Não foi possível analisar: {analise.erro || "erro desconhecido"}
      </div>
    )
  }

  const temIndices = analise.indices_financeiros && analise.indices_financeiros.length > 0
  const temPL      = analise.patrimonio_liquido && analise.patrimonio_liquido.length > 0
  const subHosp    = analise.subcontratacao_hospedagem
  const nada       = !temIndices && !temPL

  return (
    <div style={{ marginTop: 8, padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}>

      {/* Caso não detecte nada */}
      {nada && (
        <div style={{ padding: "10px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, color: "#15803d", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <div>
            <strong style={{ fontSize: 12 }}>Nenhuma exigência financeira eliminatória detectada</strong>
            <div style={{ fontSize: 11, color: "#15803d", opacity: 0.85, marginTop: 2 }}>
              Não foram encontrados índices LG/LC/SG nem patrimônio líquido mínimo no texto extraído.
            </div>
          </div>
        </div>
      )}

      {subHosp?.aplicavel && (
        <div style={{
          marginTop: 10,
          padding: 12,
          background: subHosp.nivel === "critico" ? "#fef2f2" : (subHosp.nivel === "ok" ? "#f0fdf4" : "#fffbeb"),
          border: `1px solid ${subHosp.nivel === "critico" ? "#fca5a5" : (subHosp.nivel === "ok" ? "#86efac" : "#fde68a")}`,
          borderRadius: 8,
          color: subHosp.nivel === "critico" ? "#991b1b" : (subHosp.nivel === "ok" ? "#15803d" : "#92400e"),
        }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800 }}>
            🏨 Hospedagem / Subcontratação
          </h4>
          <div style={{ fontSize: 12, lineHeight: 1.5, fontWeight: 650 }}>
            {subHosp.resumo}
          </div>
          {subHosp.sinais?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {subHosp.sinais.map((s, i) => (
                <span key={i} style={{
                  padding: "3px 7px", borderRadius: 999, fontSize: 11, fontWeight: 750,
                  background: "#fff", border: "1px solid currentColor"
                }}>
                  {s.label} ({s.ocorrencias})
                </span>
              ))}
            </div>
          )}
          {subHosp.trechos?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 800 }}>Ver trechos encontrados</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {subHosp.trechos.map((t, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 9px", color: "#374151", fontSize: 11, lineHeight: 1.5 }}>
                    <strong>{t.label}:</strong> {t.texto}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* CRITÉRIOS FINANCEIROS — único bloco mantido */}
      {!nada && (
        <div style={{
          padding: 12,
          background: "linear-gradient(135deg, #fef3c7, #fde68a)",
          border: "2px solid #f59e0b", borderRadius: 8,
        }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: "#78350f", display: "flex", alignItems: "center", gap: 6 }}>
            ⚠️ Critérios Financeiros (Eliminatórios)
          </h4>

          {/* Índices LG / LC / SG / GE */}
          {temIndices && (
            <div style={{ marginBottom: temPL ? 10 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
                📊 Índices exigidos
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                {analise.indices_financeiros.map(ind => (
                  <details key={ind.id} style={{
                    background: "#fff", border: `1px solid ${ind.critico ? "#dc2626" : "#fbbf24"}`,
                    borderRadius: 6, padding: "8px 10px"
                  }}>
                    <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: "#111827" }}>
                        <span style={{ color: ind.critico ? "#dc2626" : "#b45309", fontWeight: 800 }}>
                          {ind.id}
                        </span>{" "}
                        {ind.label}
                      </span>
                      <span style={{
                        padding: "3px 9px", borderRadius: 4, fontSize: 12, fontWeight: 800,
                        background: ind.critico ? "#fee2e2" : "#fef3c7",
                        color: ind.critico ? "#991b1b" : "#92400e",
                        fontFamily: "monospace"
                      }}>
                        ≥ {ind.formatado}
                      </span>
                    </summary>
                    <div style={{ marginTop: 6, fontSize: 11, color: "#4b5563", lineHeight: 1.5, fontStyle: "italic" }}>
                      "{ind.contexto}"
                    </div>
                  </details>
                ))}
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 10, color: "#78350f", fontStyle: "italic" }}>
                Valores em vermelho são acima do usual (&gt;1) e mais difíceis de comprovar.
              </p>
            </div>
          )}

          {/* Patrimônio líquido mínimo */}
          {temPL && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
                💼 Patrimônio Líquido Mínimo Exigido
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {analise.patrimonio_liquido.map((pl, i) => (
                  <div key={i} style={{
                    background: "#fff", border: "1px solid #dc2626", borderRadius: 6,
                    padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
                        Exigência detectada
                      </span>
                      <span style={{
                        padding: "4px 10px", borderRadius: 4, fontSize: 13, fontWeight: 800,
                        background: "#fee2e2", color: "#991b1b", fontFamily: "monospace"
                      }}>
                        {pl.formatado}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#4b5563", lineHeight: 1.5, fontStyle: "italic" }}>
                      "{pl.contexto}"
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rodapé minimalista */}
      <div style={{ marginTop: 8, fontSize: 10, color: "#9ca3af", textAlign: "right" }}>
        {analise.paginas} pág · {(analise.tamanho_bytes / 1024).toFixed(0)} KB · {analise.tamanho_texto.toLocaleString("pt-BR")} chars
      </div>
    </div>
  )
}

function PaginaDetalhe({ licitacao, onVoltar, onToggleRelevante, onObservacao, onStatusChange, onAnaliseSalva, onLicitacaoAtualizada, saving }) {
  const [editando, setEditando] = useState(true)
  const [obsTexto, setObsTexto] = useState(licitacao.observacoes || "")
  const [savingObs, setSavingObs] = useState(false)
  const [buscandoArquivos, setBuscandoArquivos] = useState(false)
  const [enriquecendoDetalhe, setEnriquecendoDetalhe] = useState(false)
  const [erroArquivos, setErroArquivos] = useState("")
  // Inicializa com análises já salvas na licitação (se houver)
  const [analises, setAnalises] = useState(() => licitacao.analises_pdf || {})

  // Reidrata quando a licitação muda
  useEffect(() => {
    setAnalises(licitacao.analises_pdf || {})
  }, [licitacao.id])

  useEffect(() => {
    let cancelado = false
    async function enriquecerDetalhePncp() {
      const ids = pncpIdsDaLicitacao(licitacao)
      const precisa = valorVazioLicitacao(licitacao.valor_estimado)
        || valorVazioLicitacao(licitacao.plataforma || licitacao.fonte_origem)
        || valorVazioLicitacao(licitacao.modo_disputa)
        || valorVazioLicitacao(licitacao.link_sistema_origem || licitacao.raw_data?.linkSistemaOrigem)
      if (!ids.cnpj || !ids.ano || !ids.seq || !precisa) return
      setEnriquecendoDetalhe(true)
      const resp = await buscarDetalhePncp(ids)
      if (!cancelado && resp.ok && resp.patch) {
        const patch = { ...resp.patch, updated_at: new Date().toISOString() }
        await updateLicitacaoPatch(licitacao.id, patch)
        onLicitacaoAtualizada?.({ ...licitacao, ...patch })
      }
      if (!cancelado) setEnriquecendoDetalhe(false)
    }
    enriquecerDetalhePncp()
    return () => { cancelado = true }
  }, [licitacao.id])

  async function rodarAnalise(arq) {
    if (licitacao.status_triagem !== "em_analise") {
      await onStatusChange(licitacao.id, "em_analise")
    }
    setAnalises(a => ({ ...a, [arq.url]: { loading: true } }))
    const result = await analyzePdf(arq.url)
    setAnalises(a => ({ ...a, [arq.url]: result }))
    // Persiste a análise junto com a licitação (auto-marca tem_indices/tem_pl)
    if (result.ok) {
      const atualizada = await salvarAnaliseFinanceira(licitacao.id, arq.url, result)
      if (onAnaliseSalva) onAnaliseSalva(atualizada)
    }
  }

  useEffect(() => { setObsTexto(licitacao.observacoes || "") }, [licitacao.observacoes])

  async function salvar() {
    setSavingObs(true)
    await onObservacao(licitacao.id, obsTexto)
    setSavingObs(false)
    setEditando(true)
  }

  async function buscarArquivosDoPncp() {
    const ids = pncpIdsDaLicitacao(licitacao)
    if (!ids.cnpj || !ids.ano || !ids.seq) {
      setErroArquivos("Não consegui identificar CNPJ/ano/sequencial desta licitação.")
      return
    }
    setBuscandoArquivos(true)
    setErroArquivos("")
    const resp = await buscarArquivosPncp(ids)
    setBuscandoArquivos(false)
    if (!resp.ok) {
      setErroArquivos(resp.error || "Não foi possível buscar os arquivos.")
      return
    }
    const arquivos = resp.arquivos || []
    const patch = {
      arquivos,
      link_edital: arquivos[0]?.url || licitacao.link_edital || "",
      link_licitacao: linkLicitacaoCorrigido(licitacao) || licitacao.link_licitacao || "",
    }
    await updateLicitacaoPatch(licitacao.id, patch)
    onLicitacaoAtualizada?.({ ...licitacao, ...patch })
    if (!arquivos.length) setErroArquivos("O PNCP não retornou arquivos para esta licitação.")
  }

  const Campo = ({ label, value, full, mono, highlight }) => (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: highlight || "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{
        fontSize: 13, color: "#111827",
        background: highlight ? highlight + "10" : "#f9fafb",
        padding: "8px 12px", borderRadius: 6,
        border: highlight ? `1px solid ${highlight}30` : "1px solid #f3f4f6",
        wordBreak: "break-word", fontFamily: mono ? "monospace" : "inherit"
      }}>
        {value || "—"}
      </div>
    </div>
  )

  const Block = ({ title, children }) => (
    <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
      <h3 style={{ margin: "0 0 14px", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</h3>
      {children}
    </div>
  )

  const kws = Array.isArray(licitacao.palavras_chave)
    ? licitacao.palavras_chave
    : (licitacao.palavras_chave ? [licitacao.palavras_chave] : [])
  const historicoStatus = Array.isArray(licitacao.status_historico) ? licitacao.status_historico : []

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={onVoltar} style={{ ...btnStyle("#f3f4f6", "#374151"), padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>← Voltar</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Detalhe da Licitação</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onToggleRelevante(licitacao.id, licitacao.relevante)} disabled={saving[licitacao.id]}
            style={btnStyle(licitacao.relevante ? "#fef9c3" : "#f9fafb", licitacao.relevante ? "#854d0e" : "#6b7280", true)}>
            {licitacao.relevante ? "⭐ Relevante" : "☆ Marcar Relevante"}
          </button>
          {linkLicitacaoCorrigido(licitacao) && (
            <a href={linkLicitacaoCorrigido(licitacao)} target="_blank" rel="noreferrer">
              <button style={btnStyle("#f0fdf4", "#15803d", true)}>🔗 Abrir Licitação</button>
            </a>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Objeto completo */}
        <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Badge text={licitacao.portal} color="#6366f1" />
            {categoriasDaLicitacao(licitacao).map(cat => <Badge key={cat} text={CATEGORIA_LABEL[cat] || cat} color="#0891b2" />)}
            {licitacao.situacao   && <Badge text={licitacao.situacao} color={SITUACAO_COLOR[licitacao.situacao] || "#6b7280"} />}
            <Badge text={STATUS_LABEL[licitacao.status_triagem] || licitacao.status_triagem} color={STATUS_COLOR[licitacao.status_triagem] || "#94a3b8"} />
            {licitacao.relevante  && <Badge text="⭐ Relevante" color="#d97706" />}
            {licitacao.importado_manualmente && <Badge text="📥 Importado manualmente" color="#7c3aed" />}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "#111827", lineHeight: 1.7 }}>{licitacao.objeto || "—"}</p>
        </div>

        {licitacao.print_data_url && (
          <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
              🖼️ Print da Licitação
            </h3>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              {licitacao.print_nome || "Print anexado"}
            </div>
            <img
              src={licitacao.print_data_url}
              alt="Print da licitação"
              style={{ maxWidth: "100%", maxHeight: 520, borderRadius: 8, border: "1px solid #cbd5e1", objectFit: "contain" }}
            />
          </div>
        )}

        {/* Identificação */}
        <Block title="Identificação">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Número do Edital"     value={licitacao.num_edital}      mono />
            <Campo label="Processo Adm."        value={licitacao.numero_processo} mono />
            <Campo label="Modalidade"           value={licitacao.modalidade} />
            <Campo label="Tipo de Contrato"     value={licitacao.tipo_contrato} />
            <Campo label="Fase / Situação"      value={licitacao.fase_atual || licitacao.situacao} />
            <Campo label="Portal"               value={licitacao.portal} />
            <Campo label="Plataforma / Fonte"   value={licitacao.plataforma || licitacao.fonte_origem} />
            <Campo label="Sistema de Origem"    value={licitacao.link_sistema_origem || licitacao.raw_data?.linkSistemaOrigem} />
            <Campo label="Amparo Legal"         value={licitacao.amparo_legal} />
            <Campo label="Tipo de Lance"        value={licitacao.tipo_lance} />
            <Campo label="Modo de Disputa"      value={licitacao.modo_disputa} />
            <Campo label="Registro de Preço"    value={licitacao.registro_preco} />
            <Campo label="Orçamento"            value={licitacao.orcamento_sigilo} />
            <Campo label="Exclusivo ME/EPP"     value={licitacao.exclusivo_me_epp} />
            <Campo label="Exclusivo Regional"   value={licitacao.exclusivo_regional} />
            <Campo label="Validade da Proposta" value={licitacao.validade_proposta} />
            <Campo label="Valor Estimado"       value={licitacao.valor_estimado} />
          </div>
        </Block>

        {/* Localização */}
        <Block title="Localização">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Órgão / Promotor" value={licitacao.orgao} full />
            <Campo label="UF"               value={licitacao.uf} />
            <Campo label="Município"        value={licitacao.municipio} />
          </div>
        </Block>

        {/* Datas */}
        <Block title="Datas e Prazos">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Campo label="Data de Publicação"              value={licitacao.data_publicacao} />
            <Campo label="Início Recebimento Propostas"    value={licitacao.data_inicio_propostas} />
            <Campo label="Fim Recebimento Propostas ⚠️"   value={licitacao.data_fim_propostas || formatDate(licitacao.data_disputa)} highlight="#dc2626" />
            <Campo label="Data / Hora da Sessão 🔔"       value={licitacao.data_sessao}             highlight="#1d4ed8" />
            <Campo label="Prazo Final Impugnação"          value={licitacao.prazo_impugnacao} />
            <Campo label="Prazo Final Esclarecimentos"     value={licitacao.prazo_esclarecimentos} />
          </div>
        </Block>

        {/* Palavras-chave */}
        <Block title="Palavras-chave Identificadas">
          {kws.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {kws.map(kw => (
                <span key={kw} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}>
                  ✓ {kw}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>Nenhuma palavra-chave identificada.</p>
          )}
          {licitacao.trecho_encontrado && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0fdf4", borderRadius: 6, border: "1px solid #bbf7d0", fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
              <strong style={{ display: "block", marginBottom: 4, fontSize: 11, color: "#6b7280" }}>TRECHO ENCONTRADO</strong>
              {licitacao.trecho_encontrado}
            </div>
          )}
        </Block>

        {textoNormalizado(licitacao.portal || licitacao.fonte).includes("pncp") && (
          <Block title="📎 Arquivos PNCP">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={buscarArquivosDoPncp}
                disabled={buscandoArquivos}
                style={btnStyle(buscandoArquivos ? "#e5e7eb" : "#eff6ff", buscandoArquivos ? "#6b7280" : "#1d4ed8", true)}
              >
                {buscandoArquivos ? "Buscando arquivos..." : "🔄 Buscar arquivos PNCP"}
              </button>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                Puxa edital/anexos do PNCP e salva junto com esta licitação.
              </span>
            </div>
            {erroArquivos && (
              <div style={{ marginTop: 10, padding: "9px 12px", borderRadius: 6, background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", fontSize: 12 }}>
                {erroArquivos}
              </div>
            )}
          </Block>
        )}

        {/* Arquivos do Processo */}
        {(() => {
          const arqs = Array.isArray(licitacao.arquivos)
            ? licitacao.arquivos
            : (typeof licitacao.arquivos === "string" && licitacao.arquivos
                ? (() => { try { return JSON.parse(licitacao.arquivos) } catch { return [] } })()
                : [])
          if (!arqs || arqs.length === 0) return null
          return (
            <Block title={`📎 Arquivos do Processo (${arqs.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {arqs.map((arq, i) => {
                  const analise = analises[arq.url]
                  const ehLoading = analise?.loading
                  return (
                    <div key={i} style={{
                      padding: "10px 12px", background: "#fffbeb", borderRadius: 6,
                      border: "1px solid #fde68a", fontSize: 13
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                          <span style={{ fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📄 {arq.nome || "(sem nome)"}
                          </span>
                          {arq.criado_em && (
                            <span style={{ fontSize: 11, color: "#92400e" }}>
                              Criado em {arq.criado_em}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => rodarAnalise(arq)}
                            disabled={ehLoading}
                            style={{
                              padding: "7px 12px",
                              background: ehLoading ? "#9ca3af" : "#3b82f6",
                              color: "#fff", border: "none",
                              borderRadius: 6, fontSize: 12, fontWeight: 600,
                              cursor: ehLoading ? "wait" : "pointer", whiteSpace: "nowrap"
                            }}
                            title="Baixar PDF e analisar conteúdo"
                          >
                            {ehLoading ? "⏳ Analisando…" : (analise?.ok ? "🔄 Reanalisar" : "🔍 Analisar")}
                          </button>
                          <a
                            href={downloadArquivoUrl(arq)}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={arq.nome}
                            style={{
                              padding: "7px 14px", background: "#f59e0b", color: "#fff",
                              borderRadius: 6, fontSize: 12, fontWeight: 600,
                              textDecoration: "none", whiteSpace: "nowrap"
                            }}
                          >
                            ⬇ Baixar
                          </a>
                        </div>
                      </div>
                      <PainelAnalisePdf analise={analise} />
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 11, color: "#92400e" }}>
                <strong>🔍 Analisar</strong> baixa o PDF e busca <strong>índices financeiros (LG, LC, SG, GE)</strong> e <strong>patrimônio líquido mínimo</strong> exigidos para habilitação. Funciona apenas em PDFs com texto (não escaneados).
              </p>
            </Block>
          )
        })()}

        {/* Status de triagem */}
        <Block title="Status de Triagem">
          <select value={licitacao.status_triagem || "novo"} onChange={e => onStatusChange(licitacao.id, e.target.value)}
            disabled={saving[licitacao.id]}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 6, fontSize: 13, border: `2px solid ${STATUS_COLOR[licitacao.status_triagem] || "#94a3b8"}`, background: (STATUS_COLOR[licitacao.status_triagem] || "#94a3b8") + "10", color: STATUS_COLOR[licitacao.status_triagem] || "#94a3b8", cursor: "pointer", fontWeight: 600, opacity: saving[licitacao.id] ? 0.5 : 1 }}>
            {STATUS_TRIAGEM.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {licitacao.status_triagem === "descartado" && licitacao.motivo_descarte && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12, color: "#475569" }}>
              <strong>Motivo do descarte:</strong> {licitacao.motivo_descarte}
            </div>
          )}
          {licitacao.status_triagem === "perdemos" && licitacao.motivo_perda && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#991b1b" }}>
              <strong>Motivo da perda:</strong> {licitacao.motivo_perda}
            </div>
          )}
          {historicoStatus.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase", marginBottom: 6 }}>Histórico</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {historicoStatus.slice().reverse().slice(0, 6).map((h, i) => (
                  <div key={i} style={{ padding: "7px 9px", borderRadius: 6, background: "#f9fafb", border: "1px solid #f1f5f9", fontSize: 12, color: "#334155" }}>
                    <strong>{STATUS_LABEL[h.status] || h.status}</strong>
                    <span style={{ color: "#64748b" }}> em {h.em ? new Date(h.em).toLocaleString("pt-BR") : "—"}</span>
                    {h.automatico && <span style={{ marginLeft: 6, color: "#0f766e" }}>auto</span>}
                    {h.motivo && <div style={{ marginTop: 3, color: "#64748b" }}>{h.motivo}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Block>

        {/* Links */}
        <Block title="Links de Acesso Rápido">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 3 }}>Link da Licitação</div>
              <a href={licitacao.link_licitacao} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontSize: 13, wordBreak: "break-all" }}>
                {licitacao.link_licitacao || "—"}
              </a>
            </div>
          </div>
        </Block>

        {/* Observações */}
        <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Observações</h3>
            {!editando && <button onClick={() => setEditando(true)} style={btnStyle("#ede9fe", "#6d28d9", true)}>✏️ Editar</button>}
          </div>
          {editando ? (
            <>
              <textarea value={obsTexto} onChange={e => setObsTexto(e.target.value)} rows={5}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                placeholder="Digite suas observações..." />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => { setEditando(false); setObsTexto(licitacao.observacoes || "") }} style={btnStyle("#f3f4f6", "#374151", true)}>Cancelar</button>
                <button onClick={salvar} disabled={savingObs} style={btnStyle("#1d4ed8", "#fff", true)}>
                  {savingObs ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: obsTexto ? "#374151" : "#9ca3af", background: "#f9fafb", padding: "10px 14px", borderRadius: 6, border: "1px solid #f3f4f6", minHeight: 60, lineHeight: 1.7 }}>
              {obsTexto || "Nenhuma observação cadastrada."}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── PÁGINA: CONFIGURAÇÕES ────────────────────────────────────────────────────
const PALAVRAS_POSITIVAS = [
  "agenciamento de viagens", "agenciamento de passagens", "passagens aéreas",
  "bilhete aéreo", "emissão de bilhetes", "emissão de passagens",
  "passagens nacionais", "passagens internacionais", "passagens rodoviárias",
  "bilhete rodoviário", "transporte rodoviário de passageiros",
  "passagens marítimas", "passagens de navio", "passagens ferroviárias",
  "viagens fluviais", "seguro viagem"
]
const PALAVRAS_NEGATIVAS = ["shows", "congressos", "feira", "exposição", "festival"]

// ════════════════════════════════════════════════════════════════════════════
// IMPORTAÇÃO EM LOTE (cola N URLs e processa em background com pacing)
// ════════════════════════════════════════════════════════════════════════════

function ModalLote({ onClose, onIniciar, jaExistentes }) {
  const [texto, setTexto] = useState("")
  const textareaRef = useRef(null)
  const urls = useMemo(() => {
    return texto
      .split(/[\r\n,;]+/)
      .map(s => s.trim())
      .filter(s => s.startsWith("http"))
  }, [texto])

  // Detecta duplicatas dentro da própria lista colada e contra as já salvas.
  const duplicadasInfo = useMemo(() => {
    const vistas = []
    const out = []
    for (const url of urls) {
      const dupExistente = encontrarDuplicada({ link_licitacao: url }, jaExistentes)
      if (dupExistente) {
        out.push({ url, tipo: dupExistente.tipo, licitacao: dupExistente.licitacao })
        continue
      }
      const dupNoTexto = encontrarDuplicada({ link_licitacao: url }, vistas)
      if (dupNoTexto) {
        out.push({ url, tipo: "lista", licitacao: dupNoTexto.licitacao })
        continue
      }
      vistas.push({ link_licitacao: url })
    }
    return out
  }, [urls, jaExistentes])

  const duplicadas = duplicadasInfo.map(d => d.url)
  const novas = urls.filter(u => !duplicadas.includes(u))

  function normalizarLinksColados(valor) {
    const linhas = String(valor || "")
      .replace(/\s+(https?:\/\/)/gi, "\n$1")
      .split(/[\r\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
    if (linhas.length === 0) return ""
    return linhas.join("\n") + "\n"
  }

  function handlePaste(e) {
    const colado = e.clipboardData?.getData("text") || ""
    if (!/^https?:\/\//i.test(colado.trim()) && !/\shttps?:\/\//i.test(colado)) return

    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? texto.length
    const end = el.selectionEnd ?? texto.length
    const antes = texto.slice(0, start)
    const depois = texto.slice(end)
    const quebraAntes = antes && !/[\r\n]$/.test(antes) ? "\n" : ""
    const bloco = normalizarLinksColados(colado)
    const proximo = antes + quebraAntes + bloco + depois.replace(/^[ \t]+/, "")
    const cursor = (antes + quebraAntes + bloco).length

    setTexto(proximo)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = cursor
        textareaRef.current.selectionEnd = cursor
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight
      }
    }, 0)
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 20
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 10, maxWidth: 700, width: "100%",
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          background: "#1e293b", color: "#fff", padding: "14px 20px",
          borderTopLeftRadius: 10, borderTopRightRadius: 10,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>📥 Importar em Lote</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.85 }}>
              Cole vários links (um por linha) e o sistema importa em background
            </p>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#1e40af", lineHeight: 1.6 }}>
            <strong>Como funciona:</strong> cole até 50 links de licitação (um por linha — BLL ou PNCP).
            O sistema processa <strong>1 a cada 10 segundos</strong> em background — você pode fechar
            esta janela e continuar trabalhando. As licitações vão aparecendo na lista conforme
            ficam prontas.
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 }}>
              LINKS (um por linha)
            </label>
            <textarea
              ref={textareaRef}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onPaste={handlePaste}
              placeholder={"https://pncp.gov.br/app/editais/..."+"\n"+"https://bllcompras.com/Process/ProcessView?param1=..."+"\n"+"https://pncp.gov.br/app/editais/..."}
              style={{
                width: "100%", minHeight: 200, padding: 12, borderRadius: 6,
                border: "1px solid #d1d5db", fontSize: 12, fontFamily: "monospace",
                resize: "vertical", boxSizing: "border-box"
              }}
            />
          </div>

          {urls.length > 0 && (
            <div style={{
              padding: "10px 14px",
              background: novas.length > 0 ? "#f0fdf4" : "#fffbeb",
              border: `1px solid ${novas.length > 0 ? "#86efac" : "#fde68a"}`,
              borderRadius: 6, fontSize: 12, color: "#374151", lineHeight: 1.5
            }}>
              📋 <strong>{urls.length}</strong> link{urls.length === 1 ? "" : "s"} válido{urls.length === 1 ? "" : "s"} detectado{urls.length === 1 ? "" : "s"}.
              {duplicadas.length > 0 && (
                <span> ⚠️ <strong>{duplicadas.length}</strong> duplicada{duplicadas.length === 1 ? "" : "s"} detectada{duplicadas.length === 1 ? "" : "s"} (vão ser ignoradas).</span>
              )}
              {novas.length > 0 && (
                <span> ✅ <strong>{novas.length}</strong> serão importada{novas.length === 1 ? "" : "s"} — tempo estimado: <strong>~{Math.ceil(novas.length * 10 / 60)} min</strong>.</span>
              )}
            </div>
          )}
          {duplicadasInfo.length > 0 && (
            <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 12, color: "#7f1d1d", lineHeight: 1.5 }}>
              <strong>Duplicadas encontradas:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {duplicadasInfo.slice(0, 5).map((d, idx) => (
                  <li key={idx}>
                    {d.tipo === "lista" ? "link repetido na lista" : motivoDuplicada(d.tipo)}
                    {d.licitacao?.orgao && <> · {d.licitacao.orgao}</>}
                    {d.licitacao?.num_edital && <> · {d.licitacao.num_edital}</>}
                  </li>
                ))}
              </ul>
              {duplicadasInfo.length > 5 && <div style={{ marginTop: 4 }}>+ {duplicadasInfo.length - 5} outra{duplicadasInfo.length - 5 === 1 ? "" : "s"}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Cancelar
          </button>
          <button
            onClick={() => { onIniciar(novas); onClose() }}
            disabled={novas.length === 0}
            style={{
              padding: "8px 16px", borderRadius: 6, border: "none",
              background: novas.length > 0 ? "#1d4ed8" : "#9ca3af",
              color: "#fff", cursor: novas.length > 0 ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 600
            }}
          >
            🚀 Iniciar importação ({novas.length})
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — visão consolidada para tomada de decisão
// ════════════════════════════════════════════════════════════════════════════

/** Converte "dd/mm/aaaa hh:mm" (formato BLL/PNCP) em Date. */
function parseBrDateTime(s) {
  if (!s) return null
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0))
  return isNaN(d.getTime()) ? null : d
}

function deveDescartarAutomaticamente(l, agora = new Date()) {
  const status = l?.status_triagem || "novo"
  if (["participando", "ganhamos", "perdemos", "descartado"].includes(status)) return false
  const dataLimite = parseBrDateTime(l?.data_fim_propostas) || parseBrDateTime(l?.data_sessao)
  return !!dataLimite && dataLimite < agora
}

function historicoComStatus(l, status, extras = {}, agora = new Date()) {
  const hist = Array.isArray(l?.status_historico) ? l.status_historico : []
  const anterior = l?.status_triagem || "novo"
  return [
    ...hist,
    {
      status,
      anterior,
      em: agora.toISOString(),
      motivo: extras.motivo_descarte || extras.auto_descartado_motivo || "",
      automatico: !!extras.automatico,
    },
  ]
}

/** Tenta extrair número de "R$ 1.234.567,89" → 1234567.89 */
function parseValorBR(s) {
  if (!s) return null
  if (typeof s === "number") return s
  const t = String(s).replace(/[^\d,.\-]/g, "")
  if (!t) return null
  // Formato BR: 1.234,56 → 1234.56
  const norm = t.replace(/\./g, "").replace(",", ".")
  const n = parseFloat(norm)
  return isNaN(n) ? null : n
}

function formatBRL(n) {
  if (n == null || isNaN(n)) return "—"
  if (n >= 1_000_000) return "R$ " + (n / 1_000_000).toFixed(2).replace(".", ",") + " mi"
  if (n >= 1_000)     return "R$ " + (n / 1_000).toFixed(1).replace(".", ",") + " mil"
  return "R$ " + n.toFixed(2).replace(".", ",")
}

function portalDeDisputa(l) {
  const raw = l?.raw_data || {}
  const partes = [
    l?.plataforma,
    l?.portal_disputa,
    l?.fonte_origem,
    raw?.usuarioNome,
    raw?.linkSistemaOrigem,
    raw?.linkProcessoEletronico,
    l?.link_sistema_origem,
    l?.link_licitacao,
    l?.link,
    l?.objeto,
    l?.resumo,
  ].filter(Boolean).join(" ").toLowerCase()

  if (partes.includes("licitanet")) return "Licitanet"
  if (partes.includes("bllcompras") || partes.includes("bll compras")) return "BLL Compras"
  if (partes.includes("portaldecompraspublicas") || partes.includes("portal de compras públicas") || partes.includes("portal de compras publicas")) return "Portal de Compras Públicas"
  if (partes.includes("comprasnet") || partes.includes("compras.gov") || partes.includes("cnetmobile")) return "Compras.gov"
  if (partes.includes("comprasbr") || partes.includes("compras br")) return "Compras BR"
  if (partes.includes("licitacoes-e") || partes.includes("licitações-e") || partes.includes("licitacoes e")) return "Licitações-e"
  if (partes.includes("banrisul")) return "Banrisul"
  if (partes.includes("bec.sp") || partes.includes("bolsa eletronica de compras") || partes.includes("bolsa eletrônica de compras")) return "BEC/SP"

  const informado = [l?.plataforma, l?.portal_disputa, l?.fonte_origem, raw?.usuarioNome]
    .map(v => (v || "").toString().trim())
    .find(v => v && !/^pncp$/i.test(v))
  return informado || "Não informado"
}

function diasEntre(d1, d2) {
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
}

function calcularStats(licitacoes) {
  const agora = new Date()
  const em24h  = new Date(agora.getTime() + 24 * 3600 * 1000)
  const em3d   = new Date(agora.getTime() + 3 * 24 * 3600 * 1000)
  const em7d   = new Date(agora.getTime() + 7 * 24 * 3600 * 1000)
  const ha7d   = new Date(agora.getTime() - 7 * 24 * 3600 * 1000)

  const prazos24h = []
  const prazos3d  = []
  const prazos7d  = []
  const novasSemana = []
  const impugnacaoAberta = []

  for (const l of licitacoes) {
    const dataFim = parseBrDateTime(l.data_fim_propostas) || parseBrDateTime(l.data_sessao)
    if (dataFim && dataFim > agora) {
      if (dataFim <= em24h) prazos24h.push(l)
      else if (dataFim <= em3d) prazos3d.push(l)
      else if (dataFim <= em7d) prazos7d.push(l)
    }
    const created = l.created_at ? new Date(l.created_at) : null
    if (created && created >= ha7d) novasSemana.push(l)

    const dImp = parseBrDateTime(l.prazo_impugnacao)
    if (dImp && dImp > agora) impugnacaoAberta.push(l)
  }

  // Funil por status
  const STATUS_ORDEM = ["novo", "amanha", "em_analise", "participando", "ganhamos", "perdemos", "descartado"]
  const porStatus = Object.fromEntries(STATUS_ORDEM.map(s => [s, 0]))
  for (const l of licitacoes) {
    const s = l.status_triagem || "novo"
    if (porStatus[s] != null) porStatus[s]++
  }

  const participouHistorico = l => !!l.foi_participada || !!l.participou || ["participando", "ganhamos", "perdemos"].includes(l.status_triagem || "")
  const analisadaHistorico = l => !!l.foi_analisada || !!l.analisada || !!l.analisado_em || !!l.analises_pdf || ["em_analise", "participando", "ganhamos", "perdemos"].includes(l.status_triagem || "")
  const participei = licitacoes.filter(participouHistorico).length
  const naoParticipei = porStatus.descartado || 0
  const aDecidir = (porStatus.novo || 0) + (porStatus.amanha || 0) + (porStatus.em_analise || 0)
  const fechadas = (porStatus.ganhamos || 0) + (porStatus.perdemos || 0) + (porStatus.descartado || 0)
  const emAberto = licitacoes.length - fechadas
  const analisadasHistoricoTotal = licitacoes.filter(analisadaHistorico).length
  const taxaAnalise = licitacoes.length ? Math.round((analisadasHistoricoTotal / licitacoes.length) * 100) : 0
  const taxaParticipacao = analisadasHistoricoTotal ? Math.round((participei / analisadasHistoricoTotal) * 100) : 0
  const aproveitamento = participei ? Math.round(((porStatus.ganhamos || 0) / participei) * 100) : 0
  const taxaDescarte = licitacoes.length ? Math.round(((porStatus.descartado || 0) / licitacoes.length) * 100) : 0
  const taxaFechamento = licitacoes.length ? Math.round((fechadas / licitacoes.length) * 100) : 0

  // Tops
  function top(campo, n = 5) {
    const cont = {}
    for (const l of licitacoes) {
      const v = (l[campo] || "").toString().trim()
      if (!v) continue
      cont[v] = (cont[v] || 0) + 1
    }
    return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, n)
  }

  const topUF     = top("uf", 7)
  const topOrgao  = top("orgao", 5)
  const topPortalDisputa = Object.entries(licitacoes.reduce((acc, l) => {
    const p = portalDeDisputa(l)
    acc[p] = (acc[p] || 0) + 1
    return acc
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6)

  // Top palavras-chave (são arrays)
  const cKw = {}
  for (const l of licitacoes) {
    const kws = Array.isArray(l.palavras_chave) ? l.palavras_chave : []
    for (const k of kws) cKw[k] = (cKw[k] || 0) + 1
  }
  const topKeywords = Object.entries(cKw).sort((a, b) => b[1] - a[1]).slice(0, 8)

  const cMotivos = {}
  for (const l of licitacoes) {
    if ((l.status_triagem || "") !== "descartado") continue
    const motivo = (l.motivo_descarte || l.auto_descartado_motivo || "Sem motivo").toString().trim()
    cMotivos[motivo] = (cMotivos[motivo] || 0) + 1
  }
  const topMotivosDescarte = Object.entries(cMotivos).sort((a, b) => b[1] - a[1]).slice(0, 6)

  // Critérios financeiros nos editais analisados
  let analisadosTotal  = 0
  let comIndices       = 0
  let comPL            = 0
  let comQualquerFin   = 0
  let comAmbosFin      = 0
  let semCriterioFin   = 0
  for (const l of licitacoes) {
    if (analisadaHistorico(l)) {
      analisadosTotal++
      const ti = !!l.tem_indices_financeiros
      const tp = !!l.tem_pl_minimo
      if (ti) comIndices++
      if (tp) comPL++
      if (ti || tp) comQualquerFin++
      if (ti && tp) comAmbosFin++
      if (!ti && !tp) semCriterioFin++
    }
  }
  const naoAnalisadosFin = licitacoes.length - analisadosTotal

  // Pipeline financeiro: soma de valor estimado em status ativos
  let valorAberto = 0
  let comValor = 0
  let semValorAberto = 0
  let comValorTotal = 0
  let semValorTotal = 0
  let totalValorTodas = 0
  const valorPorStatus = Object.fromEntries(STATUS_ORDEM.map(s => [s, 0]))
  const comValorPorStatus = Object.fromEntries(STATUS_ORDEM.map(s => [s, 0]))
  const semValorPorStatus = Object.fromEntries(STATUS_ORDEM.map(s => [s, 0]))
  for (const l of licitacoes) {
    const status = l.status_triagem || "novo"
    const v = parseValorBR(l.valor_estimado)
    if (v != null) {
      totalValorTodas += v
      comValorTotal++
      if (valorPorStatus[status] != null) valorPorStatus[status] += v
      if (comValorPorStatus[status] != null) comValorPorStatus[status]++
      if (["novo", "amanha", "em_analise", "participando"].includes(status)) {
        valorAberto += v
        comValor++
      }
    } else {
      semValorTotal++
      if (semValorPorStatus[status] != null) semValorPorStatus[status]++
      if (["novo", "amanha", "em_analise", "participando"].includes(status)) semValorAberto++
    }
  }

  // Ordenar prazos urgentes pela data
  const sortByFim = (a, b) =>
    (parseBrDateTime(a.data_fim_propostas) || parseBrDateTime(a.data_sessao) || new Date(0)) -
    (parseBrDateTime(b.data_fim_propostas) || parseBrDateTime(b.data_sessao) || new Date(0))
  prazos24h.sort(sortByFim); prazos3d.sort(sortByFim); prazos7d.sort(sortByFim)

  return {
    total: licitacoes.length,
    prazos24h, prazos3d, prazos7d,
    novasSemana, impugnacaoAberta,
    porStatus,
    participei, naoParticipei, aDecidir, emAberto, fechadas, analisadasHistoricoTotal, taxaAnalise, taxaParticipacao, aproveitamento, taxaDescarte, taxaFechamento,
    topUF, topOrgao, topPortalDisputa, topKeywords, topMotivosDescarte,
    valorAberto, comValor, semValorAberto, comValorTotal, semValorTotal, totalValorTodas, valorPorStatus, comValorPorStatus, semValorPorStatus,
    analisadosTotal, comIndices, comPL, comQualquerFin, comAmbosFin, semCriterioFin, naoAnalisadosFin,
  }
}

function CardKPI({ titulo, valor, sub, cor = "#1d4ed8", emoji, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb",
        padding: 16, display: "flex", flexDirection: "column", gap: 4,
        cursor: onClick ? "pointer" : "default", borderLeft: `4px solid ${cor}`,
        transition: "transform 0.1s",
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {emoji && <span style={{ marginRight: 6 }}>{emoji}</span>}{titulo}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: cor, lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: "#9ca3af" }}>{sub}</div>}
    </div>
  )
}

function ListaPrazo({ titulo, items, cor }) {
  if (!items || items.length === 0) return null
  return (
    <div style={{
      background: "#fff", borderRadius: 8, border: `1px solid ${cor}40`,
      padding: 14, marginBottom: 10
    }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: cor, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {titulo} ({items.length})
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.slice(0, 5).map(l => (
          <div key={l.id} style={{
            display: "flex", justifyContent: "space-between", gap: 12,
            padding: "6px 10px", background: "#f9fafb", borderRadius: 5, fontSize: 12,
          }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              <strong style={{ color: "#111827" }}>{l.orgao || "—"}</strong>
              <span style={{ color: "#6b7280", marginLeft: 6 }}>· {l.num_edital || "s/n"}</span>
            </div>
            <span style={{ color: cor, fontWeight: 600, whiteSpace: "nowrap" }}>
              {l.data_fim_propostas || l.data_sessao || "—"}
            </span>
          </div>
        ))}
        {items.length > 5 && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            + {items.length - 5} outras
          </div>
        )}
      </div>
    </div>
  )
}

function BarraFunil({ label, valor, max, cor }) {
  const pct = max > 0 ? (valor / max) * 100 : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: "#374151", fontWeight: 600 }}>{label}</span>
        <span style={{ color: cor, fontWeight: 700 }}>{valor}</span>
      </div>
      <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: cor, transition: "width 0.3s" }} />
      </div>
    </div>
  )
}

function CardResumo({ titulo, valor, sub, cor, bg = "#fff", borda, onClick, ativo }) {
  return (
    <div onClick={onClick} style={{
      padding: 14,
      background: bg,
      borderRadius: 8,
      border: ativo ? `2px solid ${cor}` : `1px solid ${borda || cor + "35"}`,
      borderLeft: `4px solid ${cor}`,
      cursor: onClick ? "pointer" : "default",
      boxShadow: ativo ? `0 0 0 3px ${cor}20` : "none",
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: cor, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {titulo}
      </div>
      <div style={{ fontSize: 28, fontWeight: 850, color: "#111827", lineHeight: 1.1, marginTop: 4 }}>
        {valor}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function EtapaFunilCRM({ titulo, valor, sub, cor, max }) {
  const pct = max > 0 ? Math.max(4, Math.round((valor / max) * 100)) : 0
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", textTransform: "uppercase" }}>{titulo}</span>
        <span style={{ fontSize: 18, fontWeight: 850, color: cor }}>{valor}</span>
      </div>
      <div style={{ height: 12, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: cor, borderRadius: 999 }} />
      </div>
      {sub && <div style={{ marginTop: 5, fontSize: 11, color: "#64748b" }}>{sub}</div>}
    </div>
  )
}

function TopList({ titulo, emoji, dados, cor = "#1d4ed8" }) {
  const max = dados[0]?.[1] || 1
  return (
    <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#111827" }}>
        {emoji} {titulo}
      </h3>
      {dados.length === 0 && <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>Sem dados ainda.</p>}
      {dados.map(([nome, n]) => (
        <div key={nome} style={{ marginBottom: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
            <span style={{ color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>
              {nome}
            </span>
            <span style={{ color: cor, fontWeight: 700 }}>{n}</span>
          </div>
          <div style={{ height: 5, background: "#f3f4f6", borderRadius: 3 }}>
            <div style={{ width: (n / max * 100) + "%", height: "100%", background: cor, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function PaginaDashboard({ licitacoes, onAbrirLista, onReanalisarTudo, onReanalisarPendentes, reanaliseFila, onCancelarReanalise }) {
  const [modoFunil, setModoFunil] = useState("historico")
  const [dashFiltros, setDashFiltros] = useState({
    periodo: "ativas",
    campoData: "data_fim_propostas",
    categoria: "",
    portal: "",
    uf: "",
    busca: "",
    modalidade: "",
    situacao: "",
    status: "",
    motivo: "",
    financeiro: "",
    valor: "",
    credenciamento: "",
  })
  const [drill, setDrill] = useState(null)

  const setFiltroDash = (campo, valor) => {
    setDashFiltros(f => ({ ...f, [campo]: valor }))
    setDrill(null)
  }

  const participouHistorico = l => !!l.foi_participada || !!l.participou || ["participando", "ganhamos", "perdemos"].includes(l.status_triagem || "")
  const analisadaHistorico = l => !!l.foi_analisada || !!l.analisada || !!l.analisado_em || !!l.analises_pdf || ["em_analise", "participando", "ganhamos", "perdemos"].includes(l.status_triagem || "")
  const emAbertoAtual = l => ["novo", "amanha", "em_analise", "participando"].includes(l.status_triagem || "novo")
  const valorLicitacao = l => parseValorBR(l.valor_estimado)
  const motivoDescarte = l => (l.motivo_descarte || l.auto_descartado_motivo || "Sem motivo").toString().trim()
  const motivoDescarteAgrupado = l => grupoMotivoDescarte(motivoDescarte(l))
  const portalDash = l => portalDeDisputa(l)
  const dataBase = l => parseBrDateTime(l[dashFiltros.campoData]) || parseBrDateTime(l.data_fim_propostas) || parseBrDateTime(l.data_sessao)
  const agendaGrupo = l => {
    const d = parseBrDateTime(l.data_fim_propostas) || parseBrDateTime(l.data_sessao)
    if (!d) return "Sem data identificada"
    const hoje = new Date()
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
    const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59)
    if (d < ini) return "Já ocorreram"
    if (d <= fimHoje) return "Vencem hoje"
    const dias = Math.ceil((d - fimHoje) / 86400000)
    if (dias <= 3) return "Vencem em até 3 dias"
    if (dias <= 7) return "Vencem em até 7 dias"
    return "Vencem em mais de 7 dias"
  }

  const opcoesPortal = useMemo(() => Array.from(new Set(licitacoes.map(portalDash).filter(Boolean))).sort(), [licitacoes])
  const opcoesMotivo = useMemo(() => Array.from(new Set(licitacoes.filter(l => (l.status_triagem || "") === "descartado").map(motivoDescarteAgrupado).filter(Boolean))).sort(), [licitacoes])
  const opcoesSituacao = useMemo(() => Array.from(new Set(licitacoes.map(l => l.situacao || l.fase_atual).filter(Boolean))).sort(), [licitacoes])

  const licitacoesFiltradas = useMemo(() => {
    const agora = new Date()
    const hojeIni = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0)
    const hojeFim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59)
    const periodoOk = l => {
      if (!dashFiltros.periodo) return true
      const d = dataBase(l)
      if (!d) return dashFiltros.periodo === "sem_data" || dashFiltros.periodo === "ativas"
      if (dashFiltros.periodo === "ativas") return d >= hojeIni
      if (dashFiltros.periodo === "hoje") return d >= hojeIni && d <= hojeFim
      if (dashFiltros.periodo === "3d") return d >= hojeIni && d <= new Date(hojeFim.getTime() + 3 * 86400000)
      if (dashFiltros.periodo === "7d") return d >= hojeIni && d <= new Date(hojeFim.getTime() + 7 * 86400000)
      if (dashFiltros.periodo === "30d") return d >= hojeIni && d <= new Date(hojeFim.getTime() + 30 * 86400000)
      if (dashFiltros.periodo === "passadas") return d < hojeIni
      return true
    }
    return licitacoes.filter(l => {
      if (!periodoOk(l)) return false
      if (dashFiltros.categoria && !categoriasDaLicitacao(l).includes(dashFiltros.categoria)) return false
      if (dashFiltros.portal && portalDash(l) !== dashFiltros.portal) return false
      if (dashFiltros.uf && l.uf !== dashFiltros.uf) return false
      if (dashFiltros.busca) {
        const q = textoNormalizado(dashFiltros.busca)
        const texto = textoNormalizado([l.orgao, l.municipio, l.objeto, l.num_edital, l.numero_processo].filter(Boolean).join(" "))
        if (!texto.includes(q)) return false
      }
      if (dashFiltros.modalidade && modalidadeFiltroDaLicitacao(l) !== dashFiltros.modalidade) return false
      if (dashFiltros.situacao && (l.situacao || l.fase_atual || "") !== dashFiltros.situacao) return false
      if (dashFiltros.status && (l.status_triagem || "novo") !== dashFiltros.status) return false
      if (dashFiltros.motivo && motivoDescarteAgrupado(l) !== dashFiltros.motivo) return false
      if (dashFiltros.financeiro === "indices" && !l.tem_indices_financeiros) return false
      if (dashFiltros.financeiro === "pl" && !l.tem_pl_minimo) return false
      if (dashFiltros.financeiro === "criterio" && !l.tem_indices_financeiros && !l.tem_pl_minimo) return false
      if (dashFiltros.financeiro === "sem_criterio" && (l.tem_indices_financeiros || l.tem_pl_minimo)) return false
      if (dashFiltros.valor === "com" && valorLicitacao(l) == null) return false
      if (dashFiltros.valor === "sem" && valorLicitacao(l) != null) return false
      const ehCred = modalidadeFiltroDaLicitacao(l) === "credenciamento"
      if (dashFiltros.credenciamento === "sim" && !ehCred) return false
      if (dashFiltros.credenciamento === "nao" && ehCred) return false
      return true
    })
  }, [licitacoes, dashFiltros])

  const aplicarDrill = (lista) => {
    if (!drill) return lista
    return lista.filter(l => {
      if (drill.tipo === "funil") {
        if (drill.valor === "Total") return true
        if (drill.valor === "Analisadas") return modoFunil === "historico" ? analisadaHistorico(l) : (l.status_triagem || "") === "em_analise"
        if (drill.valor === "Participadas") return modoFunil === "historico" ? participouHistorico(l) : (l.status_triagem || "") === "participando"
        if (drill.valor === "Ganhas") return (l.status_triagem || "") === "ganhamos"
        if (drill.valor === "Perdidas") return (l.status_triagem || "") === "perdemos"
        if (drill.valor === "Descartadas") return (l.status_triagem || "") === "descartado"
        if (drill.valor === "Em aberto") return emAbertoAtual(l)
      }
      if (drill.tipo === "motivo") return (l.status_triagem || "") === "descartado" && motivoDescarteAgrupado(l) === drill.valor
      if (drill.tipo === "categoria") return categoriasDaLicitacao(l).includes(drill.valor)
      if (drill.tipo === "agenda") return agendaGrupo(l) === drill.valor
      if (drill.tipo === "uf") return l.uf === drill.valor
      if (drill.tipo === "portal") return portalDash(l) === drill.valor
      if (drill.tipo === "valor") {
        if (drill.valor === "total") return valorLicitacao(l) != null
        if (drill.valor === "analisado") return analisadaHistorico(l) && valorLicitacao(l) != null
        if (drill.valor === "participado") return participouHistorico(l) && valorLicitacao(l) != null
        if (drill.valor === "descartado") return (l.status_triagem || "") === "descartado" && valorLicitacao(l) != null
        if (drill.valor === "aberto") return emAbertoAtual(l) && valorLicitacao(l) != null
        if (drill.valor === "sem") return valorLicitacao(l) == null
      }
      return true
    })
  }

  const stats = useMemo(() => calcularStats(licitacoesFiltradas), [licitacoesFiltradas])
  const listaDetalhada = useMemo(() => aplicarDrill(licitacoesFiltradas), [licitacoesFiltradas, drill, modoFunil])

  if (licitacoes.length === 0) {
    return (
      <div style={{ background: "#fff", borderRadius: 8, border: "1px dashed #d1d5db", padding: 60, textAlign: "center", color: "#6b7280" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>📊</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "#374151" }}>Sem dados ainda</h2>
        <p style={{ margin: 0, fontSize: 13 }}>Importe licitações pelo botão <strong>📥 Importar Licitação</strong> para ver o dashboard.</p>
      </div>
    )
  }

  const valorTotal = filtro => licitacoesFiltradas.reduce((acc, l) => {
    if (!filtro(l)) return acc
    return acc + (parseValorBR(l.valor_estimado) || 0)
  }, 0)
  const etapasHistorico = [
    { nome: "Total", qtd: stats.total, pct: 100, valor: stats.totalValorTodas, sub: "base importada", cor: "#2563eb" },
    { nome: "Analisadas", qtd: stats.analisadasHistoricoTotal, pct: stats.taxaAnalise, valor: valorTotal(analisadaHistorico), sub: `${stats.taxaAnalise}% do total`, cor: "#7c3aed" },
    { nome: "Participadas", qtd: stats.participei, pct: stats.taxaParticipacao, valor: valorTotal(participouHistorico), sub: `${stats.taxaParticipacao}% das analisadas`, cor: "#16a34a" },
    { nome: "Ganhas", qtd: stats.porStatus.ganhamos || 0, pct: stats.aproveitamento, valor: stats.valorPorStatus.ganhamos || 0, sub: `${stats.aproveitamento}% das participadas`, cor: "#059669" },
    { nome: "Perdidas", qtd: stats.porStatus.perdemos || 0, pct: stats.participei ? Math.round(((stats.porStatus.perdemos || 0) / stats.participei) * 100) : 0, valor: stats.valorPorStatus.perdemos || 0, sub: "das participadas", cor: "#dc2626" },
    { nome: "Descartadas", qtd: stats.porStatus.descartado || 0, pct: stats.taxaDescarte, valor: stats.valorPorStatus.descartado || 0, sub: `${stats.taxaDescarte}% do total`, cor: STATUS_COLOR.descartado },
    { nome: "Em aberto", qtd: stats.emAberto, pct: stats.total ? Math.round((stats.emAberto / stats.total) * 100) : 0, valor: stats.valorAberto, sub: "sem fechamento", cor: "#2563eb" },
  ]
  const etapasAtual = [
    { nome: "Total", qtd: stats.total, pct: 100, valor: stats.totalValorTodas, sub: "base importada", cor: "#2563eb" },
    { nome: "Analisadas", qtd: stats.porStatus.em_analise || 0, pct: stats.total ? Math.round(((stats.porStatus.em_analise || 0) / stats.total) * 100) : 0, valor: stats.valorPorStatus.em_analise || 0, sub: "status atual: Em análise", cor: "#7c3aed" },
    { nome: "Participadas", qtd: stats.porStatus.participando || 0, pct: stats.total ? Math.round(((stats.porStatus.participando || 0) / stats.total) * 100) : 0, valor: stats.valorPorStatus.participando || 0, sub: "status atual: Participando", cor: "#16a34a" },
    { nome: "Ganhas", qtd: stats.porStatus.ganhamos || 0, pct: stats.total ? Math.round(((stats.porStatus.ganhamos || 0) / stats.total) * 100) : 0, valor: stats.valorPorStatus.ganhamos || 0, sub: "status atual", cor: "#059669" },
    { nome: "Perdidas", qtd: stats.porStatus.perdemos || 0, pct: stats.total ? Math.round(((stats.porStatus.perdemos || 0) / stats.total) * 100) : 0, valor: stats.valorPorStatus.perdemos || 0, sub: "status atual", cor: "#dc2626" },
    { nome: "Descartadas", qtd: stats.porStatus.descartado || 0, pct: stats.taxaDescarte, valor: stats.valorPorStatus.descartado || 0, sub: "status atual", cor: STATUS_COLOR.descartado },
    { nome: "Em aberto", qtd: licitacoesFiltradas.filter(emAbertoAtual).length, pct: stats.total ? Math.round((licitacoesFiltradas.filter(emAbertoAtual).length / stats.total) * 100) : 0, valor: stats.valorAberto, sub: "Novo, Amanhã, Em análise e Participando", cor: "#2563eb" },
  ]
  const etapas = modoFunil === "historico" ? etapasHistorico : etapasAtual

  const somaLista = lista => lista.reduce((acc, l) => acc + (valorLicitacao(l) || 0), 0)
  const contarPor = (lista, fn) => {
    const mapa = new Map()
    lista.forEach(l => {
      const chave = fn(l) || "Não informado"
      mapa.set(chave, (mapa.get(chave) || 0) + 1)
    })
    return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1])
  }
  const valorPor = (lista, fn) => {
    const mapa = new Map()
    lista.forEach(l => {
      const chave = fn(l) || "Não informado"
      mapa.set(chave, (mapa.get(chave) || 0) + (valorLicitacao(l) || 0))
    })
    return mapa
  }

  const motivosDescarte = (() => {
    const descartadas = licitacoesFiltradas.filter(l => (l.status_triagem || "") === "descartado")
    const valores = valorPor(descartadas, motivoDescarteAgrupado)
    return contarPor(descartadas, motivoDescarteAgrupado).map(([motivo, qtd]) => ({
      motivo,
      qtd,
      pct: descartadas.length ? Math.round((qtd / descartadas.length) * 100) : 0,
      valor: valores.get(motivo) || 0,
    }))
  })()

  const analiseCategorias = CATEGORIAS.map(cat => {
    const lista = licitacoesFiltradas.filter(l => categoriasDaLicitacao(l).includes(cat))
    const analisadas = lista.filter(analisadaHistorico)
    const participadas = lista.filter(participouHistorico)
    const descartadas = lista.filter(l => (l.status_triagem || "") === "descartado")
    const abertas = lista.filter(emAbertoAtual)
    return {
      cat,
      label: CATEGORIA_LABEL[cat] || cat,
      total: lista.length,
      analisadas: analisadas.length,
      participadas: participadas.length,
      descartadas: descartadas.length,
      abertas: abertas.length,
      taxaParticipacao: analisadas.length ? Math.round((participadas.length / analisadas.length) * 100) : 0,
      taxaDescarte: lista.length ? Math.round((descartadas.length / lista.length) * 100) : 0,
      valorTotal: somaLista(lista),
      valorAberto: somaLista(abertas),
    }
  }).filter(c => c.total > 0)

  const gruposAgenda = [
    "Já ocorreram",
    "Vencem hoje",
    "Vencem em até 3 dias",
    "Vencem em até 7 dias",
    "Vencem em mais de 7 dias",
    "Sem data identificada",
  ].map(nome => {
    const lista = licitacoesFiltradas.filter(l => agendaGrupo(l) === nome)
    return { nome, qtd: lista.length, valor: somaLista(lista) }
  })

  const oportunidadesAbertas = licitacoesFiltradas
    .filter(emAbertoAtual)
    .filter(l => agendaGrupo(l) !== "Já ocorreram")
    .sort((a, b) => {
      const da = parseBrDateTime(a.data_fim_propostas) || parseBrDateTime(a.data_sessao) || new Date(8640000000000000)
      const db = parseBrDateTime(b.data_fim_propostas) || parseBrDateTime(b.data_sessao) || new Date(8640000000000000)
      return da - db
    })

  const valorAnalisado = somaLista(licitacoesFiltradas.filter(analisadaHistorico))
  const valorParticipado = somaLista(licitacoesFiltradas.filter(participouHistorico))
  const valorDescartado = somaLista(licitacoesFiltradas.filter(l => (l.status_triagem || "") === "descartado"))
  const valorAberto = somaLista(licitacoesFiltradas.filter(emAbertoAtual))
  const comValorLista = licitacoesFiltradas.filter(l => valorLicitacao(l) != null)
  const mediaValor = comValorLista.length ? Math.round(somaLista(comValorLista) / comValorLista.length) : 0

  const insights = (() => {
    const lista = []
    const maiorMotivo = motivosDescarte[0]
    const maiorCategoria = analiseCategorias[0]
    const hoje = gruposAgenda.find(g => g.nome === "Vencem hoje")
    if (hoje?.qtd) lista.push(`${hoje.qtd} licitações filtradas vencem hoje; priorize análise antes de qualquer coleta nova.`)
    if (maiorMotivo?.qtd) lista.push(`Principal motivo de descarte: ${maiorMotivo.motivo} (${maiorMotivo.qtd}, ${maiorMotivo.pct}%).`)
    if (maiorCategoria?.total) lista.push(`Categoria com mais volume: ${maiorCategoria.label} (${maiorCategoria.total} licitações).`)
    if (stats.semValorTotal) lista.push(`${stats.semValorTotal} licitações estão sem valor informado e continuam entrando no funil.`)
    if (!lista.length) lista.push("Aplique filtros ou avance triagens para gerar leituras mais úteis.")
    return lista
  })()

  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    fontSize: 13,
    color: "#0f172a",
    background: "#fff",
    fontFamily: "inherit",
    boxSizing: "border-box",
    width: "100%",
  }

  const limparDashboard = () => {
    setDashFiltros({
      periodo: "ativas",
      campoData: "data_fim_propostas",
      categoria: "",
      portal: "",
      uf: "",
      busca: "",
      modalidade: "",
      situacao: "",
      status: "",
      motivo: "",
      financeiro: "",
      valor: "",
      credenciamento: "",
    })
    setDrill(null)
  }

  function BarraDrill({ label, qtd, pct, valor, cor, onClick, ativo }) {
    return (
      <button onClick={onClick} style={{ textAlign: "left", width: "100%", border: ativo ? `2px solid ${cor}` : "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: 10, cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, fontWeight: 850, color: "#0f172a" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          <span style={{ color: cor }}>{qtd}</span>
        </div>
        <div style={{ height: 7, background: "#f1f5f9", borderRadius: 99, overflow: "hidden", marginTop: 7 }}>
          <div style={{ width: `${Math.max(3, pct || 0)}%`, height: "100%", background: cor }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 5 }}>
          <span>{pct || 0}%</span>
          <span>{formatBRL(valor || 0)}</span>
        </div>
      </button>
    )
  }

  function GrupoPrazo({ titulo, items, cor, bg, forte }) {
    return (
      <section style={{ background: bg, borderRadius: 8, padding: 14, border: `1px solid ${cor}33` }}>
        <h3 style={{ margin: "0 0 10px", fontSize: forte ? 16 : 14, fontWeight: 850, color: cor }}>
          {titulo} ({items.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.length === 0 && <div style={{ fontSize: 13, color: "#64748b" }}>Nenhum prazo neste grupo.</div>}
          {items.slice(0, 7).map(l => (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 120px 140px auto", gap: 10, alignItems: "center", padding: "9px 10px", background: "#fff", borderRadius: 6, border: "1px solid #e5e7eb" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.orgao || "—"}</div>
                <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.municipio || "—"} · {l.uf || "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "#334155", fontWeight: 700 }}>{l.num_edital || "s/n"}</div>
              <div style={{ fontSize: 12, color: cor, fontWeight: 800 }}>{l.data_fim_propostas || l.data_sessao || "—"}</div>
              <button onClick={onAbrirLista} style={{ padding: "7px 10px", borderRadius: 6, border: `1px solid ${cor}55`, background: "#fff", color: cor, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Analisar</button>
            </div>
          ))}
          {items.length > 7 && <div style={{ fontSize: 12, color: "#64748b" }}>+ {items.length - 7} outras licitações neste grupo</div>}
        </div>
      </section>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Dashboard CRM</h2>
            <p style={{ margin: "3px 0 0", color: "#64748b", fontSize: 12 }}>
              {licitacoesFiltradas.length} licitações filtradas de {licitacoes.length} no total
              {drill && ` · detalhe: ${drill.valor}`}
            </p>
          </div>
          <button onClick={limparDashboard} style={btnStyle("#f8fafc", "#334155")}>Limpar filtros</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <input value={dashFiltros.busca} onChange={e => setFiltroDash("busca", e.target.value)} placeholder="Buscar órgão, município, objeto..." style={inputStyle} />
          <select value={dashFiltros.periodo} onChange={e => setFiltroDash("periodo", e.target.value)} style={inputStyle}>
            <option value="ativas">Ativas / não ocorreram</option>
            <option value="">Todas, incluindo passadas</option>
            <option value="hoje">Vencem hoje</option>
            <option value="3d">Até 3 dias</option>
            <option value="7d">Até 7 dias</option>
            <option value="30d">Até 30 dias</option>
            <option value="passadas">Já ocorreram</option>
            <option value="sem_data">Sem data</option>
          </select>
          <select value={dashFiltros.campoData} onChange={e => setFiltroDash("campoData", e.target.value)} style={inputStyle}>
            <option value="data_fim_propostas">Data base: fim propostas</option>
            <option value="data_sessao">Data base: sessão</option>
            <option value="data_publicacao">Data base: publicação</option>
          </select>
          <select value={dashFiltros.categoria} onChange={e => setFiltroDash("categoria", e.target.value)} style={inputStyle}>
            <option value="">Todas categorias</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c] || c}</option>)}
          </select>
          <select value={dashFiltros.portal} onChange={e => setFiltroDash("portal", e.target.value)} style={inputStyle}>
            <option value="">Todos portais de participação</option>
            {opcoesPortal.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={dashFiltros.uf} onChange={e => setFiltroDash("uf", e.target.value)} style={inputStyle}>
            <option value="">Todas UFs</option>
            {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <select value={dashFiltros.modalidade} onChange={e => setFiltroDash("modalidade", e.target.value)} style={inputStyle}>
            <option value="">Todas modalidades</option>
            {MODALIDADE_FILTROS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select value={dashFiltros.situacao} onChange={e => setFiltroDash("situacao", e.target.value)} style={inputStyle}>
            <option value="">Todas situações</option>
            {opcoesSituacao.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={dashFiltros.status} onChange={e => setFiltroDash("status", e.target.value)} style={inputStyle}>
            <option value="">Todos status</option>
            {STATUS_TRIAGEM.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </select>
          <select value={dashFiltros.motivo} onChange={e => setFiltroDash("motivo", e.target.value)} style={inputStyle}>
            <option value="">Todos motivos de descarte</option>
            {opcoesMotivo.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={dashFiltros.financeiro} onChange={e => setFiltroDash("financeiro", e.target.value)} style={inputStyle}>
            <option value="">Critérios financeiros</option>
            <option value="criterio">Com critério financeiro</option>
            <option value="indices">Com índices</option>
            <option value="pl">Com PL mínimo</option>
            <option value="sem_criterio">Sem critério financeiro</option>
          </select>
          <select value={dashFiltros.valor} onChange={e => setFiltroDash("valor", e.target.value)} style={inputStyle}>
            <option value="">Com ou sem valor</option>
            <option value="com">Com valor informado</option>
            <option value="sem">Sem valor informado</option>
          </select>
          <select value={dashFiltros.credenciamento} onChange={e => setFiltroDash("credenciamento", e.target.value)} style={inputStyle}>
            <option value="">Credenciamento: todos</option>
            <option value="nao">Ocultar credenciamento</option>
            <option value="sim">Somente credenciamento</option>
          </select>
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#0f172a" }}>Pipeline / funil</h2>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
              {modoFunil === "historico"
                ? "Histórico mostra se a licitação já passou pela etapa em algum momento."
                : "Status atual mostra onde cada licitação está agora."}
            </p>
          </div>
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 3 }}>
            {[
              ["historico", "Histórico"],
              ["atual", "Status atual"],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setModoFunil(key)} style={{ padding: "7px 12px", borderRadius: 6, border: "none", background: modoFunil === key ? "#fff" : "transparent", color: modoFunil === key ? "#0f172a" : "#64748b", fontSize: 12, fontWeight: 850, cursor: "pointer", boxShadow: modoFunil === key ? "0 1px 2px #0001" : "none" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {etapas.map(etapa => (
            <div
              key={etapa.nome}
              onClick={() => setDrill({ tipo: "funil", valor: etapa.nome })}
              style={{
                padding: 12,
                borderRadius: 8,
                background: "#f8fafc",
                border: drill?.tipo === "funil" && drill?.valor === etapa.nome ? `2px solid ${etapa.cor}` : "1px solid transparent",
                borderTop: `4px solid ${etapa.cor}`,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 850, color: "#334155", textTransform: "uppercase" }}>{etapa.nome}</div>
              <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 900, color: "#0f172a" }}>{etapa.qtd}</span>
                <span style={{ fontSize: 12, color: etapa.cor, fontWeight: 850 }}>{etapa.pct}%</span>
              </div>
              <div style={{ fontSize: 12, color: "#475569", fontWeight: 750, marginTop: 2 }}>{formatBRL(etapa.valor)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{etapa.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Valor do pipeline</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <CardResumo titulo="Valor total" valor={formatBRL(stats.totalValorTodas)} sub={`${stats.comValorTotal} com valor informado`} cor="#0f766e" bg="#f0fdfa" onClick={() => setDrill({ tipo: "valor", valor: "total" })} ativo={drill?.tipo === "valor" && drill?.valor === "total"} />
          <CardResumo titulo="Valor analisado" valor={formatBRL(valorAnalisado)} sub="passou por análise" cor="#7c3aed" bg="#f5f3ff" onClick={() => setDrill({ tipo: "valor", valor: "analisado" })} ativo={drill?.tipo === "valor" && drill?.valor === "analisado"} />
          <CardResumo titulo="Valor participado" valor={formatBRL(valorParticipado)} sub="licitações participadas" cor="#16a34a" bg="#f0fdf4" onClick={() => setDrill({ tipo: "valor", valor: "participado" })} ativo={drill?.tipo === "valor" && drill?.valor === "participado"} />
          <CardResumo titulo="Valor descartado" valor={formatBRL(valorDescartado)} sub="status descartado" cor="#dc2626" bg="#fef2f2" onClick={() => setDrill({ tipo: "valor", valor: "descartado" })} ativo={drill?.tipo === "valor" && drill?.valor === "descartado"} />
          <CardResumo titulo="Pipeline em aberto" valor={formatBRL(valorAberto)} sub={`${stats.comValor} com valor · ${stats.semValorAberto} sem valor`} cor="#2563eb" bg="#eff6ff" onClick={() => setDrill({ tipo: "valor", valor: "aberto" })} ativo={drill?.tipo === "valor" && drill?.valor === "aberto"} />
          <CardResumo titulo="Sem valor informado" valor={stats.semValorTotal} sub="não sai das contagens" cor="#64748b" bg="#f8fafc" onClick={() => setDrill({ tipo: "valor", valor: "sem" })} ativo={drill?.tipo === "valor" && drill?.valor === "sem"} />
          <CardResumo titulo="Média com valor" valor={formatBRL(mediaValor)} sub={`${comValorLista.length} licitações com valor`} cor="#0f172a" bg="#fff" />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Insights automáticos</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {insights.map((txt, idx) => (
              <div key={idx} style={{ padding: 10, background: "#f8fafc", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, color: "#334155" }}>{txt}</div>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Agenda resumida</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {gruposAgenda.map(g => (
              <BarraDrill
                key={g.nome}
                label={g.nome}
                qtd={g.qtd}
                pct={licitacoesFiltradas.length ? Math.round((g.qtd / licitacoesFiltradas.length) * 100) : 0}
                valor={g.valor}
                cor={g.nome === "Vencem hoje" ? "#dc2626" : g.nome === "Já ocorreram" ? "#64748b" : "#2563eb"}
                onClick={() => setDrill({ tipo: "agenda", valor: g.nome })}
                ativo={drill?.tipo === "agenda" && drill?.valor === g.nome}
              />
            ))}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Análise por categoria</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {analiseCategorias.map(c => (
              <button key={c.cat} onClick={() => setDrill({ tipo: "categoria", valor: c.cat })} style={{ textAlign: "left", border: drill?.tipo === "categoria" && drill?.valor === c.cat ? "2px solid #2563eb" : "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: 11, cursor: "pointer" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                  <strong style={{ color: "#0f172a", fontSize: 13 }}>{c.label}</strong>
                  <span style={{ color: "#2563eb", fontSize: 13, fontWeight: 900 }}>{c.total}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8, fontSize: 11, color: "#475569" }}>
                  <span>Analisadas: <b>{c.analisadas}</b></span>
                  <span>Participadas: <b>{c.participadas}</b></span>
                  <span>Descartadas: <b>{c.descartadas}</b></span>
                  <span>Abertas: <b>{c.abertas}</b></span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, fontSize: 11, color: "#64748b" }}>
                  <span>Participação: <b>{c.taxaParticipacao}%</b></span>
                  <span>Descarte: <b>{c.taxaDescarte}%</b></span>
                  <span>Valor total: <b>{formatBRL(c.valorTotal)}</b></span>
                  <span>Aberto: <b>{formatBRL(c.valorAberto)}</b></span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Motivos de descarte</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {motivosDescarte.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhum descarte nos filtros atuais.</div>}
            {motivosDescarte.map(m => (
              <BarraDrill
                key={m.motivo}
                label={m.motivo}
                qtd={m.qtd}
                pct={m.pct}
                valor={m.valor}
                cor="#dc2626"
                onClick={() => setDrill({ tipo: "motivo", valor: m.motivo })}
                ativo={drill?.tipo === "motivo" && drill?.valor === m.motivo}
              />
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Oportunidades em aberto</h2>
          <span style={{ color: "#2563eb", fontSize: 13, fontWeight: 850 }}>{oportunidadesAbertas.length} abertas nos filtros atuais</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {oportunidadesAbertas.slice(0, 6).map(l => (
            <button key={l.id} onClick={() => setDrill({ tipo: "funil", valor: "Em aberto" })} style={{ textAlign: "left", border: "1px solid #e5e7eb", background: "#f8fafc", borderRadius: 8, padding: 11, cursor: "pointer" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.orgao || "—"}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{l.uf || "—"} · {CATEGORIA_LABEL[categoriasDaLicitacao(l)[0]] || "Sem categoria"}</div>
              <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 850, marginTop: 7 }}>Fim: {l.data_fim_propostas || "—"}</div>
              <div style={{ color: "#0f766e", fontSize: 11, fontWeight: 800, marginTop: 2 }}>{formatBRL(valorLicitacao(l) || 0)}</div>
            </button>
          ))}
          {oportunidadesAbertas.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhuma oportunidade aberta neste recorte.</div>}
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#0f172a" }}>Lista detalhada</h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748b" }}>
              {listaDetalhada.length} resultados após filtros{drill ? ` e detalhe "${drill.valor}"` : ""}
            </p>
          </div>
          {drill && <button onClick={() => setDrill(null)} style={btnStyle("#eff6ff", "#1d4ed8")}>Limpar detalhe</button>}
        </div>
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8, width: "100%", maxWidth: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 12 }}>
            <thead style={{ background: "#f8fafc", color: "#334155" }}>
              <tr>
                {["Órgão / Município", "UF", "Objeto / Categorias", "Portal participação", "Modalidade", "Valor", "Cronograma", "Situação", "Status", "Motivo", "Financ."].map(h => (
                  <th key={h} style={{ padding: "10px 9px", textAlign: "left", borderBottom: "1px solid #e5e7eb", fontWeight: 850 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaDetalhada.slice(0, 100).map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: 9, maxWidth: 210 }}>
                    <div style={{ fontWeight: 850, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.orgao || "—"}</div>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>{l.municipio || "—"} · {l.num_edital || "s/n"}</div>
                  </td>
                  <td style={{ padding: 9, fontWeight: 800 }}>{l.uf || "—"}</td>
                  <td style={{ padding: 9, maxWidth: 300 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.objeto || "—"}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {categoriasDaLicitacao(l).slice(0, 3).map(c => <span key={c} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 5, padding: "1px 5px", fontSize: 10, fontWeight: 800 }}>{CATEGORIA_LABEL[c] || c}</span>)}
                    </div>
                  </td>
                  <td style={{ padding: 9 }}>{portalDash(l)}</td>
                  <td style={{ padding: 9 }}>{l.modalidade || "—"}</td>
                  <td style={{ padding: 9, fontWeight: 850 }}>{valorLicitacao(l) == null ? "—" : formatBRL(valorLicitacao(l))}</td>
                  <td style={{ padding: 9 }}>
                    <div style={{ color: "#dc2626", fontWeight: 850 }}>Fim: {l.data_fim_propostas || "—"}</div>
                    <div style={{ color: "#2563eb" }}>Sessão: {l.data_sessao || "—"}</div>
                  </td>
                  <td style={{ padding: 9 }}>{l.situacao || l.fase_atual || "—"}</td>
                  <td style={{ padding: 9, color: STATUS_COLOR[l.status_triagem || "novo"], fontWeight: 850 }}>{STATUS_LABEL[l.status_triagem || "novo"] || l.status_triagem || "Novo"}</td>
                  <td style={{ padding: 9 }}>
                    {(l.status_triagem || "") === "descartado" ? (
                      <>
                        <div style={{ fontWeight: 850, color: "#991b1b" }}>{motivoDescarteAgrupado(l)}</div>
                        {motivoDescarte(l) !== motivoDescarteAgrupado(l) && (
                          <div style={{ marginTop: 2, color: "#94a3b8", fontSize: 10 }}>{motivoDescarte(l)}</div>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td style={{ padding: 9 }}>{l.tem_indices_financeiros || l.tem_pl_minimo ? "Sim" : "—"}</td>
                </tr>
              ))}
              {listaDetalhada.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}>Nenhuma licitação neste recorte.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <details style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 900, color: "#0f172a" }}>Análise de editais e critérios financeiros</summary>
          <div style={{ marginTop: 14 }}>
            {(reanaliseFila?.ativa || (reanaliseFila?.processados > 0 && !reanaliseFila?.ativa)) && (
              <div style={{ marginBottom: 12, padding: 10, background: reanaliseFila.ativa ? "#eff6ff" : "#f0fdf4", border: `1px solid ${reanaliseFila.ativa ? "#bfdbfe" : "#86efac"}`, borderRadius: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: reanaliseFila.ativa ? "#1e40af" : "#15803d" }}>
                  {reanaliseFila.ativa ? "Reanalisando..." : "Reanálise concluída"} · {reanaliseFila.processados} de {reanaliseFila.total}
                </div>
                <div style={{ height: 4, background: "#dbeafe", borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
                  <div style={{ width: ((reanaliseFila.processados / Math.max(reanaliseFila.total, 1)) * 100) + "%", height: "100%", background: reanaliseFila.ativa ? "#2563eb" : "#16a34a" }} />
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {!reanaliseFila?.ativa && <>
                <button onClick={() => onReanalisarPendentes?.()} style={btnStyle("#fffbeb", "#b45309")}>Reanalisar pendentes</button>
                <button onClick={() => onReanalisarTudo?.()} style={btnStyle("#eff6ff", "#1d4ed8")}>Reanalisar tudo</button>
              </>}
              {reanaliseFila?.ativa && <button onClick={() => onCancelarReanalise?.()} style={btnStyle("#fef2f2", "#dc2626")}>Cancelar</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <CardResumo titulo="Analisados" valor={stats.analisadosTotal} sub={`de ${stats.total} no total`} cor="#64748b" bg="#f8fafc" />
              <CardResumo titulo="Com critérios" valor={stats.comQualquerFin} sub="índices ou PL mínimo" cor="#f59e0b" bg="#fffbeb" />
              <CardResumo titulo="Com índices" valor={stats.comIndices} sub="LG, LC, SG, GE" cor="#b45309" bg="#fef3c7" />
              <CardResumo titulo="Com PL mínimo" valor={stats.comPL} sub="patrimônio líquido" cor="#dc2626" bg="#fef2f2" />
              <CardResumo titulo="Sem critério" valor={stats.semCriterioFin} sub="analisadas sem índices/PL" cor="#16a34a" bg="#f0fdf4" />
              <CardResumo titulo="Não analisadas" valor={stats.naoAnalisadosFin} sub="faltam conferir edital/PDF" cor="#64748b" bg="#f8fafc" />
            </div>
          </div>
        </details>

        <details style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 900, color: "#0f172a" }}>Motivos de descarte e distribuição</summary>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <TopList titulo="Motivos de descarte" emoji="🧾" dados={stats.topMotivosDescarte} cor="#64748b" />
            <TopList titulo="Top UFs" emoji="Mapa" dados={stats.topUF} cor="#2563eb" />
            <TopList titulo="Top órgãos" emoji="🏛️" dados={stats.topOrgao} cor="#7c3aed" />
            <TopList titulo="Top palavras-chave" emoji="🏷️" dados={stats.topKeywords} cor="#f59e0b" />
            <TopList titulo="Portal de disputa" emoji="🌐" dados={stats.topPortalDisputa} cor="#0f766e" />
          </div>
        </details>
      </section>

      <details style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 900, color: "#0f172a" }}>
          Prazos críticos ({stats.prazos24h.length + stats.prazos3d.length + stats.prazos7d.length})
        </summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, marginTop: 14 }}>
          <GrupoPrazo titulo="Vencem em 24h" items={stats.prazos24h} cor="#dc2626" bg="#fff7f7" forte />
          <GrupoPrazo titulo="Vencem em 3 dias" items={stats.prazos3d} cor="#f59e0b" bg="#fffaf0" />
          <GrupoPrazo titulo="Vencem em 7 dias" items={stats.prazos7d} cor="#2563eb" bg="#f8fbff" />
        </div>
      </details>
    </div>
  )
}

function PainelBackups({ onRestaurar }) {
  const [backups, setBackups] = useState([])
  const [diag, setDiag] = useState(null)
  const [todasChaves, setTodasChaves] = useState([])

  function recarregar() {
    setBackups(listarBackups())
    setDiag(diagnosticarStorage())
    setTodasChaves(listarTudoFibratur())
  }

  useEffect(() => { recarregar() }, [])

  // Calcula a melhor chave (com mais licitações)
  const melhorChave = todasChaves.find(c => c.tipo === 'array' && c.qtd > 0)
  const totalAtual = diag?.principal || 0
  const podeRecuperar = melhorChave && melhorChave.qtd > totalAtual

  return (
    <div style={{ background: "#fff", borderRadius: 8, border: "2px solid #fbbf24", padding: 20, gridColumn: "1 / -1" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
        🛟 Backups & Recuperação
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#78350f" }}>
        O sistema mantém backups diários das suas licitações por <strong>14 dias</strong> no navegador (chaves separadas, blindadas contra corrupção).
      </p>

      {/* Auto-recuperação destacada */}
      {podeRecuperar && (
        <div style={{
          padding: 14, marginBottom: 14, borderRadius: 8,
          background: "linear-gradient(135deg, #dc2626, #ef4444)", color: "#fff"
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
            🚨 Recuperação automática disponível!
          </div>
          <div style={{ fontSize: 12, marginBottom: 10, opacity: 0.95 }}>
            Encontrei <strong>{melhorChave.qtd} licitação{melhorChave.qtd === 1 ? "" : "ões"}</strong> em {melhorChave.chave}.
            Atualmente sua lista tem só <strong>{totalAtual}</strong>. Clique abaixo para recuperar tudo.
          </div>
          <button
            onClick={() => {
              if (window.confirm(`Recuperar ${melhorChave.qtd} licitações da chave "${melhorChave.chave}"?\n\nIsso vai substituir sua lista atual de ${totalAtual} licitação(ões).`)) {
                const r = autoRecover()
                if (r.ok) {
                  alert(`✅ Recuperadas ${r.qtd} licitações de ${r.fonte}!\n\nA página vai recarregar.`)
                  window.location.reload()
                } else {
                  alert("❌ Erro: " + r.erro)
                }
              }
            }}
            style={{
              padding: "10px 20px", borderRadius: 6, border: "none",
              background: "#fff", color: "#dc2626", cursor: "pointer",
              fontSize: 14, fontWeight: 700
            }}
          >
            🔧 Auto-recuperar agora ({melhorChave.qtd} registros)
          </button>
        </div>
      )}

      {/* Lista TODAS as chaves fibratur:* — pra debug/transparência */}
      {todasChaves.length > 0 && (
        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#78350f" }}>
            🔍 Diagnóstico completo do localStorage ({todasChaves.length} chave{todasChaves.length === 1 ? "" : "s"} encontrada{todasChaves.length === 1 ? "" : "s"})
          </summary>
          <div style={{ marginTop: 8, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 10 }}>
            <table style={{ width: "100%", fontSize: 11, fontFamily: "monospace", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #fde68a", textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>Chave</th>
                  <th style={{ padding: "4px 6px" }}>Tipo</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Registros</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Tamanho</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {todasChaves.map(c => (
                  <tr key={c.chave} style={{ borderBottom: "1px solid #fef3c7" }}>
                    <td style={{ padding: "4px 6px", color: "#78350f" }}>{c.chave}</td>
                    <td style={{ padding: "4px 6px", color: c.tipo === "corrompido" ? "#dc2626" : "#374151" }}>{c.tipo}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: c.qtd > 0 ? 700 : 400, color: c.qtd > 0 ? "#15803d" : "#9ca3af" }}>{c.qtd}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", color: "#6b7280" }}>{(c.tamanho_bytes / 1024).toFixed(1)} KB</td>
                    <td style={{ padding: "4px 6px", textAlign: "right" }}>
                      {c.tipo === 'array' && c.qtd > 0 && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Restaurar ${c.qtd} licitações desta chave?`)) {
                              const r = restaurarBackup(c.chave)
                              if (r.ok) {
                                alert(`✅ Restauradas ${r.qtd}!`)
                                window.location.reload()
                              } else { alert("❌ " + r.erro) }
                            }
                          }}
                          style={{ padding: "2px 8px", fontSize: 10, background: "#f59e0b", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
                        >↩️ usar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Diagnóstico atual */}
      {diag && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
          <div style={{ padding: 10, background: diag.principal > 0 ? "#f0fdf4" : "#fef2f2", borderRadius: 6, border: `1px solid ${diag.principal > 0 ? "#86efac" : "#fca5a5"}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase" }}>Chave principal</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: diag.principal > 0 ? "#15803d" : "#dc2626" }}>{diag.principal}</div>
          </div>
          <div style={{ padding: 10, background: diag.shadow > 0 ? "#f0fdf4" : "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase" }}>Shadow (espelho)</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: diag.shadow > 0 ? "#15803d" : "#9ca3af" }}>{diag.shadow}</div>
          </div>
          <div style={{ padding: 10, background: backups.length > 0 ? "#fffbeb" : "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase" }}>Backups diários</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: backups.length > 0 ? "#b45309" : "#9ca3af" }}>{backups.length}</div>
          </div>
        </div>
      )}

      {/* Lista de backups */}
      {backups.length > 0 ? (
        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Backups disponíveis
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {backups.map(b => (
              <div key={b.chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 13 }}>
                <div>
                  <strong style={{ color: "#111827" }}>📅 {b.data}</strong>
                  <span style={{ marginLeft: 10, color: "#92400e", fontSize: 12 }}>{b.qtd} licitação{b.qtd === 1 ? "" : "ões"}</span>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`Restaurar backup do dia ${b.data} (${b.qtd} licitações)?\n\nIsso vai sobrescrever a lista atual.`)) {
                      const r = restaurarBackup(b.chave)
                      if (r.ok) {
                        alert(`✅ Restauradas ${r.qtd} licitações do backup ${b.data}.\n\nA página vai recarregar.`)
                        if (onRestaurar) onRestaurar()
                        else window.location.reload()
                      } else {
                        alert("❌ Erro: " + r.erro)
                      }
                    }
                  }}
                  style={{ padding: "5px 12px", background: "#f59e0b", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  ↩️ Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>
          Sem backups disponíveis ainda. Eles são criados automaticamente toda vez que você importa ou edita uma licitação.
        </p>
      )}

      <div style={{ marginTop: 14, padding: 10, background: "#eff6ff", borderRadius: 6, fontSize: 11, color: "#1e40af", lineHeight: 1.5 }}>
        💡 <strong>Recomendação adicional:</strong> exporte CSV pelo botão <strong>📊 Exportar Excel</strong> a cada 1-2 dias —
        é seu backup à prova de tudo (sobrevive até a perda total do navegador).
      </div>
    </div>
  )
}

function PaginaConfiguracoes() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <PainelBackups />
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: "#111827" }}>Categorias Ativas</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CATEGORIAS.map(c => (
            <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f9fafb", borderRadius: 6, border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{CATEGORIA_LABEL[c]}</span>
              <Badge text="Ativa" color="#16a34a" small />
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: "#111827" }}>Portais Monitorados</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PORTAIS.map(p => (
            <div key={p} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#f9fafb", borderRadius: 6, border: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{p}</span>
              <Badge text="Monitorado" color="#6366f1" small />
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Palavras-chave Positivas</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>Licitações com estes termos entram na base</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PALAVRAS_POSITIVAS.map(p => <span key={p} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>{p}</span>)}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Palavras-chave Negativas</h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#9ca3af" }}>Licitações com estes termos são excluídas</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PALAVRAS_NEGATIVAS.map(p => <span key={p} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>{p}</span>)}
        </div>
      </div>

      <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", padding: 20 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>Integrações</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: "#9ca3af" }}>
          Configure as variáveis abaixo no arquivo <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 3 }}>.env</code> na raiz do projeto
        </p>
        <div style={{ padding: "12px 16px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
          <p style={{ margin: 0, fontSize: 12, color: "#1e40af", lineHeight: 1.7 }}>
            <strong>Fluxo automático:</strong> n8n coleta licitações nos portais → insere no Supabase → painel exibe em tempo real.<br />
            <strong>Fluxo manual:</strong> Cole um link BLL → clique Buscar → o servidor local raspa a página → preenche o formulário → salva no Supabase.<br />
            <strong>Para ativar:</strong> preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code>.
          </p>
        </div>
      </div>
    </div>
  )
}

function PaginaDocumentos() {
  const vazio = { nome: "", tipo: "", numero: "", emissor: "", emissao: "", vencimento: "", arquivo: "", arquivo_url: "", arquivo_nome: "", arquivo_tamanho: "", observacoes: "" }
  const [docs, setDocs] = useState(() => carregarDocumentos())
  const [form, setForm] = useState(vazio)
  const [editandoId, setEditandoId] = useState(null)
  const [arquivoSelecionado, setArquivoSelecionado] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [analisandoArquivo, setAnalisandoArquivo] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelado = false
    carregarDocumentosServidor().then(lista => {
      if (!cancelado) setDocs(lista)
    })
    return () => { cancelado = true }
  }, [])

  const ordenados = useMemo(() => [...docs].sort((a, b) => {
    const da = statusDocumento(a).dias
    const db = statusDocumento(b).dias
    if (da === null && db === null) return (a.nome || "").localeCompare(b.nome || "")
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }), [docs])

  const alertas = docs.filter(d => {
    const dias = statusDocumento(d).dias
    return dias !== null && dias <= 30
  })
  const totalArquivos = docs.filter(d => d.arquivo_url).length

  async function persistir(proximos) {
    setDocs(proximos)
    await salvarDocumentos(proximos)
  }

  async function selecionarArquivoDocumento(file) {
    if (!file) return
    setArquivoSelecionado(file)
    setAnalisandoArquivo(true)
    try {
      const upload = await uploadDocumentoArquivo(file)
      const a = upload.analise || {}
      setForm(f => ({
        ...f,
        nome: f.nome || a.nome || upload.filename,
        tipo: f.tipo || a.tipo || "",
        numero: f.numero || a.numero || "",
        emissor: f.emissor || a.emissor || "",
        emissao: f.emissao || a.emissao || "",
        vencimento: f.vencimento || a.vencimento || "",
        arquivo: upload.filename,
        arquivo_url: upload.url,
        arquivo_nome: upload.filename,
        arquivo_tamanho: upload.size,
        observacoes: f.observacoes || a.observacoes || "",
      }))
      setArquivoSelecionado(null)
      if (!a.ok) alert(a.observacoes || "Arquivo anexado, mas não foi possível ler os dados automaticamente.")
    } catch (err) {
      alert(err.message || "Erro ao enviar arquivo.")
    } finally {
      setAnalisandoArquivo(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function salvarDoc(e) {
    e.preventDefault()
    if (!form.nome.trim()) { alert("Informe o nome do documento."); return }
    setEnviando(true)
    try {
      const agora = new Date().toISOString()
      const anterior = docs.find(d => d.id === editandoId)
      let anexo = {}
      if (arquivoSelecionado && !form.arquivo_url) {
        const upload = await uploadDocumentoArquivo(arquivoSelecionado)
        anexo = {
          arquivo: upload.filename,
          arquivo_url: upload.url,
          arquivo_nome: upload.filename,
          arquivo_tamanho: upload.size,
        }
      }
      const doc = {
        ...form,
        ...anexo,
        id: editandoId || ("doc-" + Date.now()),
        nome: form.nome.trim(),
        created_at: anterior?.created_at || agora,
        updated_at: agora,
      }
      await persistir(editandoId ? docs.map(d => d.id === editandoId ? doc : d) : [doc, ...docs])
      setForm(vazio)
      setEditandoId(null)
      setArquivoSelecionado(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      alert(err.message || "Erro ao salvar documento.")
    } finally {
      setEnviando(false)
    }
  }

  function editarDoc(doc) {
    setForm({
      nome: doc.nome || "",
      tipo: doc.tipo || "",
      numero: doc.numero || "",
      emissor: doc.emissor || "",
      emissao: doc.emissao || "",
      vencimento: doc.vencimento || "",
      arquivo: doc.arquivo || "",
      arquivo_url: doc.arquivo_url || "",
      arquivo_nome: doc.arquivo_nome || "",
      arquivo_tamanho: doc.arquivo_tamanho || "",
      observacoes: doc.observacoes || "",
    })
    setEditandoId(doc.id)
    setArquivoSelecionado(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function excluirDoc(doc) {
    if (!window.confirm(`Excluir o documento "${doc.nome}"?`)) return
    await persistir(docs.filter(d => d.id !== doc.id))
    if (editandoId === doc.id) { setForm(vazio); setEditandoId(null); setArquivoSelecionado(null) }
  }

  const input = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1",
    fontSize: 13, color: "#0f172a", background: "#fff", boxSizing: "border-box", width: "100%",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Documentos</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Controle certidões, documentos e vencimentos usados nas licitações.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a
            href="/api/documentos/baixar-tudo"
            download
            onClick={e => { if (!totalArquivos) e.preventDefault() }}
            style={{
              padding: "8px 12px", borderRadius: 6,
              border: "1px solid " + (totalArquivos ? "#86efac" : "#cbd5e1"),
              background: totalArquivos ? "#dcfce7" : "#f8fafc",
              color: totalArquivos ? "#15803d" : "#94a3b8",
              fontSize: 13, fontWeight: 800, textDecoration: "none",
              pointerEvents: totalArquivos ? "auto" : "none"
            }}
            title={totalArquivos ? `Baixar ${totalArquivos} arquivo${totalArquivos === 1 ? "" : "s"} em ZIP` : "Nenhum arquivo anexado"}
          >
            ⬇ Baixar tudo
          </a>
          <div style={{ padding: "8px 12px", borderRadius: 6, background: alertas.length ? "#fef2f2" : "#f0fdf4", border: `1px solid ${alertas.length ? "#fca5a5" : "#86efac"}`, color: alertas.length ? "#991b1b" : "#15803d", fontSize: 13, fontWeight: 700 }}>
            {alertas.length ? `${alertas.length} alerta${alertas.length === 1 ? "" : "s"} de vencimento` : "Sem documentos vencendo"}
          </div>
        </div>
      </div>

      <form onSubmit={salvarDoc} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1.2fr 1fr 1fr", gap: 10 }}>
          <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Nome do documento *" style={input} />
          <input value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} placeholder="Tipo / categoria" style={input} />
          <input value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="Número" style={input} />
          <input value={form.emissor} onChange={e => setForm(f => ({ ...f, emissor: e.target.value }))} placeholder="Emissor" style={input} />
          <input type="date" value={form.emissao} onChange={e => setForm(f => ({ ...f, emissao: e.target.value }))} title="Emissão" style={input} />
          <input type="date" value={form.vencimento} onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))} title="Vencimento" style={input} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr auto 1.6fr auto auto", gap: 10, marginTop: 10, alignItems: "center" }}>
          <input value={form.arquivo} onChange={e => setForm(f => ({ ...f, arquivo: e.target.value }))} placeholder="Link, caminho do arquivo ou onde está salvo" style={input} />
          <label style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #bfdbfe", background: analisandoArquivo ? "#f1f5f9" : "#eff6ff", color: analisandoArquivo ? "#64748b" : "#1d4ed8", fontWeight: 700, cursor: analisandoArquivo ? "wait" : "pointer", whiteSpace: "nowrap", textAlign: "center" }}>
            {analisandoArquivo ? "Lendo..." : "📎 Upload"}
            <input ref={fileInputRef} type="file" disabled={analisandoArquivo} onChange={e => selecionarArquivoDocumento(e.target.files?.[0] || null)} style={{ display: "none" }} />
          </label>
          <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Observações" style={input} />
          <button type="submit" disabled={enviando || analisandoArquivo} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: (enviando || analisandoArquivo) ? "#94a3b8" : "#1d4ed8", color: "#fff", fontWeight: 700, cursor: (enviando || analisandoArquivo) ? "wait" : "pointer" }}>{enviando ? "Salvando..." : editandoId ? "Salvar edição" : "Adicionar"}</button>
          {editandoId && <button type="button" onClick={() => { setForm(vazio); setEditandoId(null); setArquivoSelecionado(null); if (fileInputRef.current) fileInputRef.current.value = "" }} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>}
        </div>
        {(arquivoSelecionado || form.arquivo_nome) && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
            Arquivo: <strong>{arquivoSelecionado?.name || form.arquivo_nome}</strong>{analisandoArquivo ? " — lendo dados..." : ""}
          </div>
        )}
      </form>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {["Documento", "Tipo", "Número", "Emissor", "Emissão", "Vencimento", "Status", "Arquivo / Obs.", "Ações"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ordenados.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhum documento cadastrado ainda.</td></tr>}
            {ordenados.map(doc => {
              const st = statusDocumento(doc)
              return (
                <tr key={doc.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0f172a" }}>{doc.nome}</td>
                  <td style={{ padding: "10px 12px", color: "#475569" }}>{doc.tipo || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#475569" }}>{doc.numero || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#475569" }}>{doc.emissor || "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap" }}>{doc.emissao ? formatDate(doc.emissao) : "—"}</td>
                  <td style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap" }}>{doc.vencimento ? formatDate(doc.vencimento) : "—"}</td>
                  <td style={{ padding: "10px 12px" }}><Badge text={st.label} color={st.color} small /></td>
                  <td style={{ padding: "10px 12px", color: "#475569", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={[doc.arquivo, doc.observacoes].filter(Boolean).join(" · ")}>
                    {doc.arquivo_url ? (
                      <a href={doc.arquivo_url} target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}>{doc.arquivo_nome || doc.arquivo || "Abrir arquivo"}</a>
                    ) : (doc.arquivo || doc.observacoes || "—")}
                    {doc.observacoes && <span style={{ color: "#64748b" }}> {doc.arquivo_url || doc.arquivo ? "· " : ""}{doc.observacoes}</span>}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {doc.arquivo_url && <a href={downloadDocumentoUrl(doc)} download={doc.arquivo_nome || doc.arquivo || true} style={{ ...btnStyle("#dcfce7", "#15803d"), textDecoration: "none", display: "inline-block", marginRight: 6 }}>Baixar</a>}
                    <button onClick={() => editarDoc(doc)} style={btnStyle("#dbeafe", "#1d4ed8")}>Editar</button>
                    <button onClick={() => excluirDoc(doc)} style={{ ...btnStyle("#fee2e2", "#b91c1c"), marginLeft: 6 }}>Excluir</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PaginaSenhas() {
  const vazio = { plataforma: "", login: "", senha: "", observacoes: "" }
  const [senhas, setSenhas] = useState(() => carregarSenhas())
  const [form, setForm] = useState(vazio)
  const [editandoId, setEditandoId] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [visiveis, setVisiveis] = useState({})

  useEffect(() => {
    let cancelado = false
    carregarSenhasServidor().then(lista => {
      if (!cancelado) setSenhas(lista)
    })
    return () => { cancelado = true }
  }, [])

  const ordenadas = useMemo(() => [...senhas].sort((a, b) => (a.plataforma || "").localeCompare(b.plataforma || "")), [senhas])

  async function persistir(proximas) {
    setSenhas(proximas)
    await salvarSenhas(proximas)
  }

  async function salvar(e) {
    e.preventDefault()
    if (!form.plataforma.trim()) { alert("Informe a plataforma."); return }
    if (!form.login.trim()) { alert("Informe o login."); return }
    setSalvando(true)
    try {
      const agora = new Date().toISOString()
      const anterior = senhas.find(s => s.id === editandoId)
      const item = {
        ...form,
        id: editandoId || ("senha-" + Date.now()),
        plataforma: form.plataforma.trim(),
        login: form.login.trim(),
        senha: form.senha,
        created_at: anterior?.created_at || agora,
        updated_at: agora,
      }
      await persistir(editandoId ? senhas.map(s => s.id === editandoId ? item : s) : [item, ...senhas])
      setForm(vazio)
      setEditandoId(null)
    } catch (err) {
      alert(err.message || "Erro ao salvar senha.")
    } finally {
      setSalvando(false)
    }
  }

  function editar(item) {
    setForm({
      plataforma: item.plataforma || "",
      login: item.login || "",
      senha: item.senha || "",
      observacoes: item.observacoes || "",
    })
    setEditandoId(item.id)
  }

  async function excluir(item) {
    if (!window.confirm(`Excluir acesso de "${item.plataforma}"?`)) return
    await persistir(senhas.filter(s => s.id !== item.id))
    if (editandoId === item.id) { setForm(vazio); setEditandoId(null) }
  }

  async function copiar(texto, label) {
    try {
      await navigator.clipboard.writeText(texto || "")
      alert(`${label} copiado.`)
    } catch {
      alert("Não foi possível copiar automaticamente.")
    }
  }

  const input = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1",
    fontSize: 13, color: "#0f172a", background: "#fff", boxSizing: "border-box", width: "100%",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Senhas</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Acessos dos portais de licitação usados pela equipe.</p>
      </div>

      <form onSubmit={salvar} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.2fr 1.8fr auto auto", gap: 10, alignItems: "center" }}>
          <input value={form.plataforma} onChange={e => setForm(f => ({ ...f, plataforma: e.target.value }))} placeholder="Plataforma *" style={input} />
          <input value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="Login *" style={input} />
          <input type="password" value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} placeholder="Senha" style={input} />
          <input value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Observações" style={input} />
          <button type="submit" disabled={salvando} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: salvando ? "#94a3b8" : "#1d4ed8", color: "#fff", fontWeight: 800, cursor: salvando ? "wait" : "pointer", whiteSpace: "nowrap" }}>
            {salvando ? "Salvando..." : editandoId ? "Salvar" : "Adicionar"}
          </button>
          {editandoId && <button type="button" onClick={() => { setForm(vazio); setEditandoId(null) }} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>}
        </div>
      </form>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              {["Plataforma", "Login", "Senha", "Observações", "Ações"].map(h => <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#334155", whiteSpace: "nowrap" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 && <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Nenhum acesso cadastrado ainda.</td></tr>}
            {ordenadas.map(item => {
              const visivel = !!visiveis[item.id]
              return (
                <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 800, color: "#0f172a" }}>{item.plataforma}</td>
                  <td style={{ padding: "10px 12px", color: "#334155" }}>{item.login}</td>
                  <td style={{ padding: "10px 12px", color: "#334155", fontFamily: "monospace" }}>{visivel ? (item.senha || "—") : (item.senha ? "••••••••" : "—")}</td>
                  <td style={{ padding: "10px 12px", color: "#64748b" }}>{item.observacoes || "—"}</td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button onClick={() => setVisiveis(v => ({ ...v, [item.id]: !v[item.id] }))} style={btnStyle("#f1f5f9", "#334155")}>{visivel ? "Ocultar" : "Mostrar"}</button>
                    <button onClick={() => copiar(item.login, "Login")} style={{ ...btnStyle("#dbeafe", "#1d4ed8"), marginLeft: 6 }}>Copiar login</button>
                    <button onClick={() => copiar(item.senha, "Senha")} style={{ ...btnStyle("#dcfce7", "#15803d"), marginLeft: 6 }}>Copiar senha</button>
                    <button onClick={() => editar(item)} style={{ ...btnStyle("#ede9fe", "#7c3aed"), marginLeft: 6 }}>Editar</button>
                    <button onClick={() => excluir(item)} style={{ ...btnStyle("#fee2e2", "#b91c1c"), marginLeft: 6 }}>Excluir</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── APP PRINCIPAL ─────────────────────────────────────────────────────────────
export default function App() {
  const [pagina,      setPagina]      = useState("lista")
  const [licitacoes,  setLicitacoes]  = useState([])
  const [selecionada, setSelecionada] = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [source,      setSource]      = useState(null)
  const [fetchError,  setFetchError]  = useState(null)
  const [saving,      setSaving]      = useState({})
  const [modalImportar, setModalImportar] = useState(false)
  const [modalLote,     setModalLote]     = useState(false)
  const [modalMotivoDescarte, setModalMotivoDescarte] = useState(false)
  const motivoDescarteResolver = useRef(null)
  // Fila de importação em background: { pendentes: [url], total, sucessos, erros, atual, ativa, log: [{url, tipo, detalhes}] }
  const [fila, setFila] = useState({ pendentes: [], total: 0, sucessos: 0, duplicadas: 0, erros: 0, atual: null, ativa: false, log: [] })
  const [logAberto, setLogAberto] = useState(false)
  const [coletando, setColetando] = useState(false)

  const carregarDados = useCallback(async () => {
    setLoading(true)
    const { data, source: src, error } = await fetchLicitacoes()
    const agora = new Date()
    const alteradas = []
    const normalizadas = data.map(l => {
      if (!deveDescartarAutomaticamente(l, agora)) return l
      const patch = {
        status_triagem: "descartado",
        auto_descartado_em: l.auto_descartado_em || agora.toISOString(),
        auto_descartado_motivo: "Prazo da licitação expirado sem participação marcada",
        motivo_descarte: l.motivo_descarte || "Prazo expirado sem participação",
        status_historico: historicoComStatus(l, "descartado", {
          automatico: true,
          auto_descartado_motivo: "Prazo expirado sem participação",
        }, agora),
      }
      alteradas.push({ id: l.id, patch })
      return { ...l, ...patch }
    })
    setLicitacoes(normalizadas)
    setSource(src)
    setFetchError(error)
    setLoading(false)
    if (alteradas.length) {
      Promise.all(alteradas.map(({ id, patch }) => updateStatusTriagem(id, "descartado", {
        auto_descartado_em: patch.auto_descartado_em,
        auto_descartado_motivo: patch.auto_descartado_motivo,
        motivo_descarte: patch.motivo_descarte,
        status_historico: patch.status_historico,
      }))).catch(e => console.warn("[auto-descarte]", e))
    }
  }, [])

  const atualizarDadosReais = useCallback(async () => {
    setColetando(true)
    setLoading(true)
    try {
      const coleta = await coletarLicitacoesReais({ dias: 14, paginas: 1 })
      if (!coleta.ok) {
        setFetchError(new Error(coleta.error || "Erro ao coletar licitações reais"))
      }
      const { data, source: src, error } = await fetchLicitacoes()
      const agora = new Date()
      const alteradas = []
      const normalizadas = data.map(l => {
        if (!deveDescartarAutomaticamente(l, agora)) return l
        const patch = {
          status_triagem: "descartado",
          auto_descartado_em: l.auto_descartado_em || agora.toISOString(),
          auto_descartado_motivo: "Prazo da licitação expirado sem participação marcada",
          motivo_descarte: l.motivo_descarte || "Prazo expirado sem participação",
          status_historico: historicoComStatus(l, "descartado", {
            automatico: true,
            auto_descartado_motivo: "Prazo expirado sem participação",
          }, agora),
        }
        alteradas.push({ id: l.id, patch })
        return { ...l, ...patch }
      })
      setLicitacoes(normalizadas)
      setSource(src)
      setFetchError(error || (coleta.ok ? null : new Error(coleta.error)))
      if (alteradas.length) {
        await Promise.all(alteradas.map(({ id, patch }) => updateStatusTriagem(id, "descartado", {
          auto_descartado_em: patch.auto_descartado_em,
          auto_descartado_motivo: patch.auto_descartado_motivo,
          motivo_descarte: patch.motivo_descarte,
          status_historico: patch.status_historico,
        })))
      }
      if (coleta.ok) {
        alert(`Atualização real concluída: ${coleta.total || 0} licitação(ões) aderente(s) encontradas/atualizadas no PNCP.`)
      }
    } finally {
      setLoading(false)
      setColetando(false)
    }
  }, [])

  useEffect(() => { carregarDados() }, [carregarDados])

  // ─── PROCESSADOR DA FILA DE IMPORTAÇÃO EM LOTE ───────────────────────────
  // Usa ref para sinalizar cancelamento sem re-disparar o effect
  const cancelarRef = useRef(false)

  async function processarFilaLote(urls) {
    cancelarRef.current = false
    let sucessos = 0
    let erros = 0
    let duplicadasLote = 0
    const jaConhecidas = licitacoes.slice()
    const total = urls.length
    const restantes = urls.slice()

    while (restantes.length > 0 && !cancelarRef.current) {
      const url = restantes.shift()
      setFila(f => ({ ...f, atual: url, pendentes: restantes.slice() }))

      try {
        const result = await scrapeBllUrl(url)
        if (cancelarRef.current) break

        if (result.ok && result.data) {
          const d = result.data
          const form = {
            portal: d.portal || "PNCP",
            link_licitacao: d.link_licitacao || url,
            orgao: d.orgao || "",
            uf: d.uf || "",
            municipio: d.municipio || "",
            num_edital: d.num_edital || "",
            numero_processo: d.numero_processo || "",
            modalidade: d.modalidade || "",
            tipo_contrato: d.tipo_contrato || "",
            fase_atual: d.fase_atual || "",
            data_publicacao: d.data_publicacao || "",
            data_inicio_propostas: d.data_inicio_propostas || "",
            data_fim_propostas: d.data_fim_propostas || "",
            data_sessao: d.data_sessao || "",
            prazo_impugnacao: d.prazo_impugnacao || "",
            prazo_esclarecimentos: d.prazo_esclarecimentos || "",
            validade_proposta: d.validade_proposta || "",
            tipo_lance: d.tipo_lance || "",
            modo_disputa: d.modo_disputa || "",
            exclusivo_me_epp: d.exclusivo_me_epp || "",
            exclusivo_regional: d.exclusivo_regional || "",
            objeto: d.objeto || "",
            valor_estimado: d.valor_estimado || "",
            palavras_chave: Array.isArray(d.palavras_chave) ? d.palavras_chave : [],
            arquivos: Array.isArray(d.arquivos) ? d.arquivos : [],
          }
          const dup = encontrarDuplicada(form, jaConhecidas)
          if (dup) {
            duplicadasLote++
            console.warn("[lote] duplicada ignorada", url, motivoDuplicada(dup.tipo))
            setFila(f => ({
              ...f,
              atual: null,
              duplicadas: duplicadasLote,
              log: [...(f.log || []), { url, tipo: "duplicada", detalhes: motivoDuplicada(dup.tipo) }],
            }))
            continue
          }
          const ins = await insertLicitacao(form)
          if (ins.error) {
            erros++
            console.warn("[lote] erro ao salvar", url, ins.error.message)
          } else {
            sucessos++
            jaConhecidas.push(ins.data)
            handleLicitacaoImportada(ins.data)
          }
        } else {
          erros++
          console.warn("[lote] erro ao buscar", url, result.error)
        }
      } catch (e) {
        erros++
        console.error("[lote] exceção em", url, e)
      }

      setFila(f => ({ ...f, sucessos, erros, duplicadas: duplicadasLote, atual: null }))

      // Pacing: espera 10s antes do próximo (evita rate-limit)
      if (restantes.length > 0 && !cancelarRef.current) {
        await new Promise(r => setTimeout(r, 10000))
      }
    }

    // Finaliza
    setFila(f => ({
      ...f,
      atual: null,
      pendentes: [],
      ativa: false,
      sucessos,
      duplicadas: duplicadasLote,
      erros,
    }))
  }

  function iniciarImportacaoLote(urls) {
    if (!urls || urls.length === 0) return
    cancelarRef.current = false
    setFila({
      pendentes: urls.slice(),
      total: urls.length,
      sucessos: 0,
      duplicadas: 0,
      erros: 0,
      atual: null,
      ativa: true,
      log: [],
    })
    // Dispara o processamento (não bloqueia o setFila)
    processarFilaLote(urls.slice())
  }

  function cancelarFila() {
    cancelarRef.current = true
    setFila(f => ({ ...f, pendentes: [], ativa: false }))
  }

  // Reanalisa em lote todos os editais que já têm arquivo (para reprocessar com regex melhorado)
  const [reanaliseFila, setReanaliseFila] = useState({ ativa: false, atual: null, total: 0, processados: 0, atualizados: 0 })
  const cancelarReRef = useRef(false)

  async function reanalisarTudo(somentePendentes = false) {
    const candidatos = licitacoes.filter(l => {
      const arqs = Array.isArray(l.arquivos) ? l.arquivos : []
      if (arqs.length === 0) return false
      if (somentePendentes) {
        // Só os que ainda não foram analisados, ou que foram analisados mas sem critério encontrado
        const analisado = !!l.analisado_em || !!l.analises_pdf
        const semCriterio = !l.tem_indices_financeiros && !l.tem_pl_minimo
        return !analisado || semCriterio
      }
      return true
    })

    if (candidatos.length === 0) {
      alert("Nenhum edital com arquivo PDF para reanalisar.")
      return
    }
    if (!window.confirm(`Reanalisar ${candidatos.length} edital${candidatos.length === 1 ? "" : "s"}?\n\nVai levar uns ${Math.ceil(candidatos.length * 8 / 60)} minuto(s). Você pode continuar usando o painel.`)) {
      return
    }

    cancelarReRef.current = false
    setReanaliseFila({ ativa: true, atual: null, total: candidatos.length, processados: 0, atualizados: 0 })
    let processados = 0, atualizados = 0

    for (const lic of candidatos) {
      if (cancelarReRef.current) break
      const arqs = Array.isArray(lic.arquivos) ? lic.arquivos : []
      const arq = arqs[0]
      if (!arq?.url) { processados++; continue }

      setReanaliseFila(f => ({ ...f, atual: lic.orgao || lic.num_edital || lic.id }))

      try {
        const result = await analyzePdf(arq.url)
        if (result?.ok) {
          const tinhaAntes = !!lic.tem_indices_financeiros || !!lic.tem_pl_minimo
          const temAgora = (result.indices_financeiros?.length || 0) > 0 || (result.patrimonio_liquido?.length || 0) > 0
          if (tinhaAntes !== temAgora || temAgora) atualizados++
          const atualizada = await salvarAnaliseFinanceira(lic.id, arq.url, result)
          setLicitacoes(ls => ls.map(l => l.id === atualizada.id ? { ...l, ...atualizada } : l))
        }
      } catch (e) {
        console.warn("[reanalise] falhou em", lic.id, e.message)
      }

      processados++
      setReanaliseFila(f => ({ ...f, processados, atualizados }))

      // Pacing: 6s entre cada (PDFs grandes podem ativar rate-limit)
      if (processados < candidatos.length && !cancelarReRef.current) {
        await new Promise(r => setTimeout(r, 6000))
      }
    }

    setReanaliseFila({ ativa: false, atual: null, total: candidatos.length, processados, atualizados })
  }

  function cancelarReanalise() {
    cancelarReRef.current = true
    setReanaliseFila(f => ({ ...f, ativa: false }))
  }

  useEffect(() => {
    if (selecionada) {
      const atualizado = licitacoes.find(l => l.id === selecionada.id)
      if (atualizado) setSelecionada(atualizado)
    }
  }, [licitacoes])

  function setSavingId(id, val) {
    setSaving(s => ({ ...s, [id]: val || undefined }))
  }

  function pedirMotivoDescarteVisual() {
    setModalMotivoDescarte(true)
    return new Promise(resolve => {
      motivoDescarteResolver.current = resolve
    })
  }

  function resolverMotivoDescarte(motivo) {
    const resolve = motivoDescarteResolver.current
    motivoDescarteResolver.current = null
    setModalMotivoDescarte(false)
    if (resolve) resolve(motivo)
  }

  async function handleToggleRelevante(id, atual) {
    setSavingId(id, true)
    const novoValor = !atual
    setLicitacoes(ls => ls.map(l => l.id === id ? { ...l, relevante: novoValor } : l))
    const { error } = await updateRelevante(id, novoValor)
    if (error) setLicitacoes(ls => ls.map(l => l.id === id ? { ...l, relevante: atual } : l))
    setSavingId(id, false)
  }

  async function handleObservacao(id, observacoes) {
    setLicitacoes(ls => ls.map(l => l.id === id ? { ...l, observacoes } : l))
    await updateObservacoes(id, observacoes)
  }

  async function handleStatusChange(id, status_triagem) {
    setSavingId(id, true)
    const licAnterior = licitacoes.find(l => l.id === id)
    const patchHistorico = {}
    if (status_triagem === "descartado" && licAnterior?.status_triagem !== "descartado" && !licAnterior?.motivo_descarte) {
      const motivo = await pedirMotivoDescarteVisual()
      if (motivo === null) { setSavingId(id, false); return }
      patchHistorico.motivo_descarte = motivo
      patchHistorico.categoria_descarte = motivo
      patchHistorico.descartado_em = new Date().toISOString()
    }
    if (status_triagem === "perdemos" && licAnterior?.status_triagem !== "perdemos" && !licAnterior?.motivo_perda) {
      const motivo = window.prompt(
        "Motivo da perda? Ex: concorrente abaixo do custo, documentação, lance, preço, desclassificação.",
        ""
      )
      if (motivo === null) { setSavingId(id, false); return }
      patchHistorico.motivo_perda = motivo.trim() || "Não informado"
      patchHistorico.perdemos_em = new Date().toISOString()
    }
    if (["em_analise", "participando", "ganhamos", "perdemos"].includes(status_triagem) && !licAnterior?.foi_analisada) {
      patchHistorico.foi_analisada = true
      patchHistorico.analisada_em = licAnterior?.analisada_em || new Date().toISOString()
    }
    if (["participando", "ganhamos", "perdemos"].includes(status_triagem) && !licAnterior?.foi_participada) {
      patchHistorico.foi_participada = true
      patchHistorico.participou_em = licAnterior?.participou_em || new Date().toISOString()
    }
    if (licAnterior?.status_triagem !== status_triagem) {
      patchHistorico.status_historico = historicoComStatus(licAnterior, status_triagem, patchHistorico)
    }
    setLicitacoes(ls => ls.map(l => l.id === id ? { ...l, status_triagem, ...patchHistorico } : l))
    const { error } = await updateStatusTriagem(id, status_triagem, patchHistorico)
    if (error) setLicitacoes(ls => ls.map(l => l.id === id ? licAnterior || l : l))
    setSavingId(id, false)
  }

  async function handleDeleteLicitacao(licitacao) {
    if (!licitacao?.id) return
    const nome = licitacao.orgao || licitacao.num_edital || licitacao.numero_processo || "esta licitação"
    if (!window.confirm(`Excluir ${nome}?\n\nEssa ação remove a licitação da lista e salva a alteração no arquivo local.`)) return

    setSavingId(licitacao.id, true)
    const anterior = licitacoes
    setLicitacoes(ls => ls.filter(l => l.id !== licitacao.id))
    if (selecionada?.id === licitacao.id) {
      setSelecionada(null)
      setPagina("lista")
    }

    const { error } = await deleteLicitacao(licitacao.id)
    if (error) {
      alert("Não foi possível excluir a licitação. Tente novamente.")
      setLicitacoes(anterior)
    }
    setSavingId(licitacao.id, false)
  }

  function abrirDetalhe(l) { setSelecionada(l); setPagina("detalhe") }

  // Chamado quando o modal de importar salva com sucesso
  function handleLicitacaoImportada(novaLicitacao) {
    if (novaLicitacao) {
      setLicitacoes(ls => [novaLicitacao, ...ls])
    }
  }

  const totalRelevantes = licitacoes.filter(l => l.relevante).length
  const totalNovos      = licitacoes.filter(l => l.status_triagem === "novo").length
  const totalParticipando = licitacoes.filter(l => l.status_triagem === "participando").length
  const totalGanhos     = licitacoes.filter(l => l.status_triagem === "ganhamos").length
  const docsCriticos = documentosCriticos(carregarDocumentos(), 5)

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <header style={{ background: "#1e293b", color: "#fff", padding: "0 24px", display: "flex", alignItems: "center", height: 54, position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 3px #0003" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
          <span style={{ fontSize: 18 }}>✈️</span>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>Fibratur</span>
          <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>Licitações</span>
        </div>

        <nav style={{ display: "flex", gap: 2 }}>
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "lista",     label: "Licitações" },
            { key: "documentos", label: "Documentos" },
            { key: "senhas", label: "Senhas" },
            { key: "config",    label: "Configurações" }
          ].map(n => (
            <button key={n.key} onClick={() => setPagina(n.key)} style={{
              padding: "7px 16px", borderRadius: 5, border: "none", cursor: "pointer",
              fontWeight: pagina === n.key ? 600 : 400, fontSize: 13,
              background: pagina === n.key ? "#334155" : "transparent",
              color: pagina === n.key ? "#f1f5f9" : "#94a3b8", transition: "all 0.15s"
            }}>{n.label}</button>
          ))}
        </nav>

        {/* Botão Importar */}
        <button
          onClick={() => setModalImportar(true)}
          style={{
            marginLeft: 16, padding: "6px 14px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(29,78,216,0.8)", color: "#fff",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6
          }}
        >
          📥 Importar Licitação
        </button>

        <button
          onClick={() => setModalLote(true)}
          title="Cole vários links e o sistema importa em background"
          style={{
            marginLeft: 8, padding: "6px 12px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(99,102,241,0.7)", color: "#fff",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6
          }}
        >
          📦 Lote
        </button>

        <button
          onClick={() => exportarCSV(licitacoes)}
          title="Baixar todas as licitações em CSV (abre no Excel)"
          style={{
            marginLeft: 8, padding: "6px 12px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(34,197,94,0.7)", color: "#fff",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6
          }}
        >
          📊 Exportar Excel
        </button>

        <label
          title="Importar licitações de um CSV exportado anteriormente"
          style={{
            marginLeft: 6, padding: "6px 12px", borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(168,85,247,0.7)", color: "#fff",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6
          }}
        >
          📤 Importar CSV
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const novas = await importarCSV(file)
                if (novas.length === 0) { alert("Nenhuma licitação válida encontrada no arquivo."); return }
                bulkUpsertLocal(novas)
                setLicitacoes(ls => mesclarPorId([...novas, ...ls]))
                alert(`${novas.length} licitação(ões) importada(s) com sucesso.`)
              } catch (err) {
                alert("Erro ao ler o arquivo: " + err.message)
              }
              e.target.value = ""
            }}
          />
        </label>

        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {loading && <span style={{ fontSize: 12, color: "#94a3b8" }}>Carregando...</span>}
          {!loading && (
            <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 14 }}>
              <span>📋 <strong style={{ color: "#f1f5f9" }}>{licitacoes.length}</strong></span>
              <span>⭐ <strong style={{ color: "#fbbf24" }}>{totalRelevantes}</strong></span>
              {docsCriticos.length > 0 && (
                <button
                  onClick={() => setPagina("documentos")}
                  title={docsCriticos.map(d => `${d.nome}: ${statusDocumento(d).label}`).join("\n")}
                  style={{ border: "1px solid #fecaca", background: "#7f1d1d", color: "#fecaca", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}
                >
                  ⚠️ {docsCriticos.length} doc
                </button>
              )}
              {totalNovos        > 0 && <span>🆕 <strong style={{ color: "#60a5fa" }}>{totalNovos}</strong> novos</span>}
              {totalParticipando > 0 && <span>✅ <strong style={{ color: "#86efac" }}>{totalParticipando}</strong> particip.</span>}
              {totalGanhos       > 0 && <span>🏆 <strong style={{ color: "#fbbf24" }}>{totalGanhos}</strong> ganhos</span>}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#475569", background: "#0f172a", padding: "3px 8px", borderRadius: 4 }}>
            {isSupabaseConfigured ? "🟢 Supabase" : "🔵 Local + PNCP"}
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main style={{ width: "calc(100% - 32px)", maxWidth: "none", margin: "0 auto", padding: "20px 16px" }}>
        {/* Banner de progresso da fila de importação em lote */}
        {(fila.ativa || fila.atual || fila.total > 0) && (
          <div style={{
            background: fila.ativa ? "linear-gradient(135deg, #1e40af, #3b82f6)" : "#f0fdf4",
            color: fila.ativa ? "#fff" : "#15803d",
            padding: "12px 16px", borderRadius: 8, marginBottom: 14,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            border: fila.ativa ? "none" : "1px solid #86efac"
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                {fila.ativa ? "📦 Importando em background…" : "✅ Importação concluída"}
                <span style={{ fontWeight: 600, opacity: 0.85 }}>
                  {fila.sucessos + fila.erros + (fila.duplicadas || 0)} de {fila.total}
                </span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                ✅ {fila.sucessos} importada{fila.sucessos === 1 ? "" : "s"}
                {(fila.duplicadas || 0) > 0 && <> · ⚠️ {fila.duplicadas} duplicada{fila.duplicadas === 1 ? "" : "s"}</>}
                {fila.erros > 0 && <> · ❌ {fila.erros} com erro</>}
                {fila.atual && <> · ⏳ atual: <span style={{ fontFamily: "monospace" }}>{fila.atual.slice(0, 70)}…</span></>}
                {!fila.atual && fila.pendentes.length > 0 && <> · aguardando próxima ({fila.pendentes.length} restante{fila.pendentes.length === 1 ? "" : "s"})</>}
              </div>
              {/* Barra de progresso */}
              <div style={{ height: 4, background: fila.ativa ? "rgba(255,255,255,0.25)" : "#bbf7d0", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                <div style={{
                  width: ((fila.sucessos + fila.erros + (fila.duplicadas || 0)) / fila.total * 100) + "%",
                  height: "100%",
                  background: fila.ativa ? "#fff" : "#16a34a",
                  transition: "width 0.3s"
                }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {fila.ativa && (
                <button onClick={cancelarFila} style={{
                  padding: "6px 12px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.4)",
                  background: "rgba(255,255,255,0.15)", color: "#fff",
                  cursor: "pointer", fontSize: 12, fontWeight: 600
                }}>✕ Cancelar</button>
              )}
              {!fila.ativa && fila.total > 0 && (
                <button onClick={() => setFila({ pendentes: [], total: 0, sucessos: 0, duplicadas: 0, erros: 0, atual: null, ativa: false, log: [] })} style={{
                  padding: "6px 12px", borderRadius: 5, border: "1px solid #86efac",
                  background: "#fff", color: "#15803d",
                  cursor: "pointer", fontSize: 12, fontWeight: 600
                }}>✕ Fechar</button>
              )}
            </div>
          </div>
        )}

        {(pagina === "lista" || pagina === "detalhe") && (
          <BannerFonte source={source} error={fetchError} onRefresh={atualizarDadosReais} loading={loading || coletando} />
        )}

        {docsCriticos.length > 0 && pagina !== "documentos" && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              ⚠️ {docsCriticos.length} documento{docsCriticos.length === 1 ? "" : "s"} crítico{docsCriticos.length === 1 ? "" : "s"}: {docsCriticos.slice(0, 3).map(d => d.nome).join(", ")}
            </div>
            <button onClick={() => setPagina("documentos")} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              Ver documentos
            </button>
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80, color: "#9ca3af", fontSize: 14 }}>
            Carregando licitações...
          </div>
        )}

        {!loading && pagina === "lista" && (
          <PaginaLicitacoes
            licitacoes={licitacoes}
            onSelect={abrirDetalhe}
            onToggleRelevante={handleToggleRelevante}
            onObservacao={handleObservacao}
            onStatusChange={handleStatusChange}
            onDelete={handleDeleteLicitacao}
            saving={saving}
          />
        )}

        {!loading && pagina === "detalhe" && selecionada && (
          <PaginaDetalhe
            licitacao={licitacoes.find(l => l.id === selecionada.id) || selecionada}
            onVoltar={() => setPagina("lista")}
            onToggleRelevante={handleToggleRelevante}
            onObservacao={handleObservacao}
            onStatusChange={handleStatusChange}
            onAnaliseSalva={(atualizada) => setLicitacoes(ls => ls.map(l => l.id === atualizada.id ? { ...l, ...atualizada } : l))}
            onLicitacaoAtualizada={(atualizada) => setLicitacoes(ls => ls.map(l => l.id === atualizada.id ? { ...l, ...atualizada } : l))}
            saving={saving}
          />
        )}

        {pagina === "dashboard" && (
          <PaginaDashboard
            licitacoes={licitacoes}
            onAbrirLista={() => setPagina("lista")}
            onReanalisarTudo={() => reanalisarTudo(false)}
            onReanalisarPendentes={() => reanalisarTudo(true)}
            reanaliseFila={reanaliseFila}
            onCancelarReanalise={cancelarReanalise}
          />
        )}

        {pagina === "documentos" && <PaginaDocumentos />}

        {pagina === "senhas" && <PaginaSenhas />}

        {pagina === "config" && <PaginaConfiguracoes />}
      </main>

      {/* Modal de importação */}
      {modalImportar && (
        <ModalImportar
          licitacoesExistentes={licitacoes}
          onClose={() => setModalImportar(false)}
          onSalvar={(novaLicitacao) => {
            handleLicitacaoImportada(novaLicitacao)
          }}
        />
      )}

      {modalLote && (
        <ModalLote
          jaExistentes={licitacoes}
          onClose={() => setModalLote(false)}
          onIniciar={iniciarImportacaoLote}
        />
      )}

      {modalMotivoDescarte && (
        <ModalMotivoDescarte
          onCancelar={() => resolverMotivoDescarte(null)}
          onEscolher={(motivo) => resolverMotivoDescarte(motivo)}
        />
      )}
    </div>
  )
}
