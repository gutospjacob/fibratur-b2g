const KEYWORDS_POSITIVE = [
  'agenciamento de viagens',
  'agencia de viagens',
  'agencia de turismo',
  'agenciamento de passagens',
  'passagem aerea',
  'passagens aereas',
  'passagens nacionais',
  'passagens internacionais',
  'passagem nacional',
  'passagem internacional',
  'emissao de bilhetes',
  'emissao de passagens',
  'bilhetes aereos',
  'bilhete aereo',
  'reserva de passagens',
  'remarcacao de passagens',
  'cancelamento de passagens',
  'passagem rodoviaria',
  'passagens rodoviarias',
  'bilhete rodoviario',
  'bilhetes rodoviarios',
  'transporte rodoviario de passageiros',
  'seguro viagem',
  'fornecimento de passagens',
  'servicos de viagens',
  'viagem',
]

const https = require('https')

const PNCP_SEARCH_TERMS = [
  'agenciamento de viagens',
  'agenciamento de passagens',
  'passagens aereas',
  'passagem aerea',
  'passagens nacionais',
  'passagens internacionais',
  'emissao de bilhetes',
  'emissao de passagens',
  'bilhetes aereos',
  'bilhete aereo',
  'reserva de passagens',
  'remarcacao de passagens',
  'cancelamento de passagens',
  'fornecimento de passagens',
  'passagens rodoviarias',
  'passagem rodoviaria',
  'bilhete rodoviario',
  'seguro viagem',
]

const KEYWORDS_NEGATIVE = [
  'maior desconto',
  'desconto sobre passagem',
  'desconto sobre tarifa',
  'desconto sobre o valor da passagem',
  'taxa negativa',
  'taxa de administracao negativa',
  'menor preco global',
  'menor valor global',
  'preco por item',
  'balanco patrimonial',
  'indices contabeis',
  'liquidez geral',
  'liquidez corrente',
  'solvencia geral',
  'patrimonio liquido minimo',
  'posto de atendimento presencial',
  'atendimento presencial obrigatorio',
  'sede no municipio',
  'preferencia regional',
  'consorcio obrigatorio',
  'hospedagem de site',
  'hospedagem de sitios',
  'hospedagem de portal',
  'hospedagem de sistema',
  'hospedagem em nuvem',
  'cloud',
  'datacenter',
  'data center',
  'servidor dedicado',
  'servidor dedicado',
  'servidor web',
  'servidor em nuvem',
  'dominio',
  'website',
  'software',
  'sistema web',
]

// PNCP: 1 = Leilão. Não entra no escopo da Fibratur, então fica fora da coleta.
const MODALIDADES_PNCP = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function ymdCompact(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function ymdDashed(date) {
  return date.toISOString().slice(0, 10)
}

function brDateTime(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '')
}

function brMoney(v) {
  if (v === null || v === undefined || v === '') return ''
  var n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function normalizePncpApiUrl(url) {
  if (!url) return ''
  return String(url).replace(/https:\/\/pncp\.gov\.br:\d+\//i, 'https://pncp.gov.br/')
}

function foundTerms(text, terms) {
  var n = norm(text)
  return terms.filter(function(t) { return n.indexOf(norm(t)) >= 0 })
}

function isHospedagemTiText(n) {
  return /hospedagem (de )?(site|sitios|portal|sistema|pagina|website|web|aplicacao|software)|hospedagem em nuvem|cloud|datacenter|data center|servidor\s+(?:dedicado|web|em nuvem|virtual|de aplicacao|de banco)|dominio|cpanel|ssl|vps/.test(n)
}

function isSoftwareTiText(n) {
  return /sistema informatizado|gestao tributaria|licenca de uso|ambiente web|software|solucoes de software|saas|implantacao de sistema|migracao de dados|customizacao|parametrizacao|suporte tecnico|manutencao corretiva|manutencao evolutiva|hospedagem em infraestrutura|computacao em nuvem|datacenter|data center/.test(n)
}

function deveIgnorarPorTi(text) {
  var n = norm(text)
  return isHospedagemTiText(n) || isSoftwareTiText(n)
}

function deveIgnorarPorModalidade(text) {
  var n = norm(text)
  return /leilao|alienacao de bens|bens moveis inserviveis|bens imoveis|sucatas?|maior lance/.test(n)
}

function deveIgnorarPorEscopo(text) {
  var n = norm(text)
  return /construcao|obra(s)? de engenharia|servicos? de engenharia|engenharia civil|reforma|ampliacao|retrofit|pavimentacao|passarela|passagem molhada|passagem de concreto|passagem elevada|passagem inferior|passagem superior|quadra|ginasio|creche|pre-escola|escola|posto de saude|residencial|modulos? padronizados|equipamentos urbanisticos/.test(n)
}

function isHospedagemTurismoText(n) {
  if (!/hospedagem|hotel|diarias?/.test(n)) return false
  if (isHospedagemTiText(n)) return false
  return /passagens?|viagens?|turismo|agenciamento|agencia|hotelaria|hotel|diarias?|acomodacao|deslocamento|evento|seminario|congresso|participantes|servidores publicos|colaboradores/.test(n)
}

function categoriaPorTexto(text) {
  var n = norm(text)
  var cats = []
  if (/passagens? aere|bilhetes? aere|passagens? nacionais|passagens? internacionais/.test(n)) cats.push('passagens aéreas')
  if (/passagens? rodovi|bilhetes? rodovi|transporte rodoviario de passageiros/.test(n)) cats.push('passagens rodoviárias')
  if (/agenciamento|agencia de viagens|servicos de viagens|agencia de turismo/.test(n)) cats.push('agenciamento de viagens')
  if (isHospedagemTurismoText(n)) cats.push('hospedagem')
  if (/seguro viagem/.test(n)) cats.push('seguro viagem')
  if (/locacao de veiculos|aluguel de veiculos/.test(n)) cats.push('locação de veículos')
  if (/transporte terrestre|passagens? rodovi/.test(n)) cats.push('transporte terrestre')
  if (cats.length > 1) return 'mista'
  return cats[0] || 'não relacionada'
}

function categoriaPorTextoCompat(text) {
  var n = norm(text)
  if (/passagens? aere|bilhetes? aere|passagens? nacionais|passagens? internacionais|passagens? rodovi|bilhetes? rodovi|reserva de passagens|fornecimento de passagens|emissao de passagens|emissao de bilhetes|transporte rodoviario de passageiros/.test(n)) return 'passagens'
  if (/seguro viagem/.test(n)) return 'seguro_viagem'
  if (/locacao de veiculos|aluguel de veiculos/.test(n)) return 'locacao_veiculos'
  if (/viagem fluvial|passagem fluvial|transporte fluvial/.test(n)) return 'viagens_fluviais'
  if (isHospedagemTurismoText(n)) return 'hospedagem'
  if (/agenciamento|agencia de viagens|servicos de viagens|agencia de turismo/.test(n)) return 'agenciamento'
  return 'nao relacionada'
}

function uniqueKeyFromPncp(item) {
  var stable = stableKeyFromPncp(item)
  if (stable) return stable
  return [
    'pncp',
    item.orgaoEntidade && item.orgaoEntidade.cnpj,
    item.anoCompra,
    item.sequencialCompra,
    item.numeroCompra,
    item.processo,
    item.modalidadeId,
  ].filter(Boolean).join('-').replace(/\s+/g, '_')
}

function stableKeyFromPncp(item) {
  var cnpj = item.orgaoEntidade && item.orgaoEntidade.cnpj
  var ano = item.anoCompra
  var seq = item.sequencialCompra
  if (cnpj && ano && seq) return ['pncp', cnpj, ano, seq].join('-').replace(/\s+/g, '_')
  var controle = item.numeroControlePNCP || item.processo
  if (controle && /\d{14}-\d+-\d+\/\d{4}/.test(String(controle))) {
    return 'pncp-' + String(controle).replace(/[^\d]+/g, '-').replace(/-+$/g, '')
  }
  return ''
}

function classifySimple(item) {
  var text = [
    item.objetoCompra,
    item.informacaoComplementar,
    item.modalidadeNome,
    item.modoDisputaNome,
    item.tipoInstrumentoConvocatorioNome,
  ].filter(Boolean).join(' ')
  var ignorarTi = deveIgnorarPorTi(text)
  var pos = foundTerms(text, KEYWORDS_POSITIVE)
  var neg = foundTerms(text, KEYWORDS_NEGATIVE)
  var categoria = categoriaPorTextoCompat(text)
  var categoriaNaoRelacionada = categoria === 'nao relacionada' || norm(categoria).indexOf('nao relacionada') >= 0
  if (ignorarTi) neg.push('TI/sistema/cloud')
  var ignorarModalidade = deveIgnorarPorModalidade(text)
  if (ignorarModalidade) neg.push('leilao/alienacao')
  var ignorarEscopo = deveIgnorarPorEscopo(text)
  if (ignorarEscopo) neg.push('obra/engenharia/fora do turismo')
  var score = 20
  score += Math.min(pos.length * 16, 55)
  var nText = norm(text)
  if (/agenciamento de viagens|agencia de viagens|agenciamento de passagens|passagens? aere|bilhetes? aere|passagens? nacionais|passagens? internacionais/.test(nText)) score += 20
  if (/passagens? rodovi|bilhetes? rodovi|transporte rodoviario de passageiros/.test(nText)) score += 15
  if (item.valorTotalEstimado || item.valorTotalHomologado) score += 5
  if (item.dataEncerramentoProposta && new Date(item.dataEncerramentoProposta) > new Date()) score += 10
  score -= Math.min(neg.length * 12, 45)
  if (categoriaNaoRelacionada) score -= 35
  score = Math.max(0, Math.min(100, score))

  var classification = 'ANALISAR'
  if (categoriaNaoRelacionada || score < 40 || neg.some(function(t) { return /maior desconto|taxa negativa|desconto sobre/.test(norm(t)) })) classification = 'DESCARTAR'
  else if (score >= 85 && neg.length === 0) classification = 'PARTICIPAR'

  var financial = 'OK'
  if (neg.length) financial = neg.some(function(t) { return /maior desconto|taxa negativa|desconto sobre/.test(norm(t)) }) ? 'CRITICO' : 'ATENCAO'

  return {
    categoria: categoria,
    palavras: pos,
    negativos: neg,
    score: score,
    classification: classification,
    financial: financial,
    reason: pos.length ? ('Termos aderentes: ' + pos.join(', ')) : 'Sem termo positivo forte no objeto.',
    attention: neg,
    ignore: ignorarTi || ignorarModalidade || ignorarEscopo || categoriaNaoRelacionada,
  }
}

async function fetchJson(url) {
  return new Promise(function(resolve, reject) {
    var req = https.get(url, {
      rejectUnauthorized: false,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        referer: 'https://pncp.gov.br/app/editais',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      },
      timeout: 25000,
    }, function(res) {
      var chunks = []
      res.on('data', function(c) { chunks.push(c) })
      res.on('end', function() {
        var body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('HTTP ' + res.statusCode + ' em ' + url))
        }
        if (/^\s*</.test(body) || /Request Rejected/i.test(body)) {
          return reject(new Error('Resposta bloqueada pelo portal em ' + url))
        }
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('JSON invalido em ' + url + ': ' + e.message))
        }
      })
    })
    req.on('timeout', function() {
      req.destroy(new Error('timeout em ' + url))
    })
    req.on('error', reject)
  })
}

async function fetchJsonRetry(url, tries) {
  tries = typeof tries === 'number' ? tries : (tries && tries.retries) || 3
  var last
  for (var i = 0; i < tries; i++) {
    try {
      return await fetchJson(url)
    } catch (e) {
      last = e
      if (i < tries - 1) {
        await new Promise(function(resolve) { setTimeout(resolve, 350 + i * 450) })
      }
    }
  }
  throw last
}

async function fetchPncpDocuments(item) {
  var cnpj = item.orgaoEntidade && item.orgaoEntidade.cnpj
  if (!cnpj || !item.anoCompra || !item.sequencialCompra) return []
  var url = 'https://pncp.gov.br/pncp-api/v1/orgaos/' + encodeURIComponent(cnpj) + '/compras/' + encodeURIComponent(item.anoCompra) + '/' + encodeURIComponent(item.sequencialCompra) + '/arquivos'
  try {
    var data = await fetchJson(url)
    var arr = Array.isArray(data) ? data : (data.data || [])
    return arr.map(function(a, idx) {
      return {
        nome: a.titulo || a.nome || a.descricao || ('Arquivo ' + (idx + 1)),
        criado_em: brDateTime(a.dataPublicacao || a.dataInclusao || a.createdAt),
        url: normalizePncpApiUrl(a.url || a.uri || (url + '/' + (a.sequencialDocumento || a.id || idx + 1))),
        tipo: a.tipoDocumento || a.tipo || '',
      }
    }).filter(function(a) { return a.url })
  } catch (e) {
    return []
  }
}

async function fetchPncpItens(item) {
  var cnpj = item.orgaoEntidade && item.orgaoEntidade.cnpj
  if (!cnpj || !item.anoCompra || !item.sequencialCompra) return []
  var url = 'https://pncp.gov.br/pncp-api/v1/orgaos/' + encodeURIComponent(cnpj) + '/compras/' + encodeURIComponent(item.anoCompra) + '/' + encodeURIComponent(item.sequencialCompra) + '/itens'
  try {
    var data = await fetchJsonRetry(url, 2)
    return Array.isArray(data) ? data : (data.data || [])
  } catch (e) {
    return []
  }
}

async function fetchPncpCompraDetalhe(item) {
  var cnpj = item.orgaoEntidade && item.orgaoEntidade.cnpj
  if (!cnpj || !item.anoCompra || !item.sequencialCompra) return null
  var url = 'https://pncp.gov.br/api/consulta/v1/orgaos/' + encodeURIComponent(cnpj) + '/compras/' + encodeURIComponent(item.anoCompra) + '/' + encodeURIComponent(item.sequencialCompra)
  try {
    return await fetchJsonRetry(url, 2)
  } catch (e) {
    return null
  }
}

function mergePncpDetalhe(item, detail) {
  if (!detail || typeof detail !== 'object') return item
  var merged = Object.assign({}, item, detail)
  merged.rawSearch = item.rawSearch || detail.rawSearch
  if (!merged.linkSistemaOrigem && item.linkSistemaOrigem) merged.linkSistemaOrigem = item.linkSistemaOrigem
  if (!merged.linkProcessoEletronico && item.linkProcessoEletronico) merged.linkProcessoEletronico = item.linkProcessoEletronico
  return merged
}

function resumoItensPncp(itens) {
  var arr = Array.isArray(itens) ? itens : []
  var total = arr.reduce(function(acc, it) { return acc + (Number(it.valorTotal) || 0) }, 0)
  var criterio = arr.map(function(it) { return it.criterioJulgamentoNome }).filter(Boolean)[0] || ''
  return {
    total: total,
    criterio: criterio,
    quantidade: arr.length,
    resumo: arr.slice(0, 12).map(function(it) {
      return {
        numero: it.numeroItem,
        descricao: it.descricao,
        quantidade: it.quantidade,
        unidade: it.unidadeMedida,
        valor_unitario: brMoney(it.valorUnitarioEstimado),
        valor_total: brMoney(it.valorTotal),
        criterio_julgamento: it.criterioJulgamentoNome || '',
        situacao: it.situacaoCompraItemNome || '',
      }
    }),
  }
}

function pncpSearchItemToConsultaShape(item) {
  var publicLink = item.orgao_cnpj && item.ano && item.numero_sequencial
    ? ('https://pncp.gov.br/app/editais/' + item.orgao_cnpj + '/' + item.ano + '/' + item.numero_sequencial)
    : (item.item_url ? ('https://pncp.gov.br/app' + item.item_url) : '')
  return {
    orgaoEntidade: {
      cnpj: item.orgao_cnpj,
      razaoSocial: item.orgao_nome,
    },
    unidadeOrgao: {
      ufSigla: item.uf,
      municipioNome: item.municipio_nome,
      nomeUnidade: item.unidade_nome,
    },
    anoCompra: item.ano,
    sequencialCompra: item.numero_sequencial,
    numeroCompra: item.title || item.numero || '',
    processo: item.numero_controle_pncp || '',
    objetoCompra: item.description || '',
    linkSistemaOrigem: publicLink,
    linkProcessoEletronico: publicLink,
    valorTotalEstimado: item.valor_global,
    numeroControlePNCP: item.numero_controle_pncp,
    modalidadeId: item.modalidade_licitacao_id,
    modalidadeNome: item.modalidade_licitacao_nome,
    tipoInstrumentoConvocatorioNome: item.tipo_nome || item.document_type,
    situacaoCompraNome: item.situacao_nome,
    modoDisputaNome: '',
    dataInclusao: item.createdAt,
    dataPublicacaoPncp: item.data_publicacao_pncp || item.createdAt,
    dataAtualizacao: item.data_atualizacao_pncp,
    dataAberturaProposta: item.data_inicio_vigencia,
    dataEncerramentoProposta: item.data_fim_vigencia,
    rawSearch: item,
  }
}

function pncpRecordFromItem(item, arquivos, sourceName) {
  var cls = classifySimple(item)
  var key = uniqueKeyFromPncp(item)
  var itensInfo = resumoItensPncp(item.itens_pncp || item.itens || [])
  var link = item.linkProcessoEletronico || item.linkSistemaOrigem || ('https://pncp.gov.br/app/editais/' + (item.orgaoEntidade && item.orgaoEntidade.cnpj) + '/' + item.anoCompra + '/' + item.sequencialCompra)
  return {
    id: key,
    unique_key: key,
    pncp_key: stableKeyFromPncp(item) || key,
    fonte: 'PNCP',
    source_name: sourceName || 'PNCP',
    portal: 'PNCP',
    orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || (item.unidadeOrgao && item.unidadeOrgao.nomeUnidade) || '',
    cnpj_orgao: item.orgaoEntidade && item.orgaoEntidade.cnpj || '',
    uf: item.unidadeOrgao && item.unidadeOrgao.ufSigla || '',
    municipio: item.unidadeOrgao && item.unidadeOrgao.municipioNome || '',
    modalidade: item.modalidadeNome || '',
    num_edital: item.numeroCompra || '',
    numero_processo: item.processo || item.numeroControlePNCP || '',
    objeto: item.objetoCompra || '',
    categoria: cls.categoria,
    data_publicacao: brDateTime(item.dataPublicacaoPncp || item.dataInclusao),
    data_atualizacao: brDateTime(item.dataAtualizacaoGlobal || item.dataAtualizacao),
    data_inicio_propostas: brDateTime(item.dataAberturaProposta),
    data_fim_propostas: brDateTime(item.dataEncerramentoProposta),
    data_sessao: brDateTime(item.dataAberturaProposta),
    valor_estimado: brMoney(item.valorTotalEstimado || itensInfo.total || item.valorTotalHomologado),
    valor_homologado: brMoney(item.valorTotalHomologado),
    plataforma: item.usuarioNome || item.plataforma || item.fonte_origem || '',
    fonte_origem: item.usuarioNome || item.plataforma || item.fonte_origem || '',
    amparo_legal: item.amparoLegal && (item.amparoLegal.nome || item.amparoLegal.descricao) || item.amparoLegal || '',
    registro_preco: typeof item.srp === 'boolean' ? (item.srp ? 'Sim' : 'N\u00e3o') : (item.srp || ''),
    orcamento_sigilo: item.orcamentoSigilosoDescricao || '',
    informacao_complementar: item.informacaoComplementar || '',
    criterio_julgamento: item.criterioJulgamentoNome || itensInfo.criterio || item.modoDisputaNome || '',
    modo_disputa: item.modoDisputaNome || '',
    tipo_contrato: item.tipoInstrumentoConvocatorioNome || '',
    link_licitacao: link,
    link_edital: arquivos[0] && arquivos[0].url || '',
    situacao: item.situacaoCompraNome || 'Divulgada no PNCP',
    fase_atual: item.situacaoCompraNome || '',
    status_licitacao: item.situacaoCompraNome || '',
    status_triagem: cls.classification === 'PARTICIPAR' ? 'em_analise' : (cls.classification === 'DESCARTAR' ? 'descartado' : 'novo'),
    status_interno: cls.classification === 'PARTICIPAR' ? 'Participar' : (cls.classification === 'DESCARTAR' ? 'Descartada' : 'Nova'),
    relevante: cls.score >= 70,
    relevancia: cls.score,
    classificacao_ia: cls.classification,
    classificacao_financeira: cls.financial,
    resumo: (item.objetoCompra || '').slice(0, 500),
    motivo_classificacao: cls.reason,
    pontos_atencao: cls.attention,
    documentos_exigidos: [],
    palavras_chave: cls.palavras,
    trecho_encontrado: cls.reason,
    tem_indices_financeiros: cls.attention.some(function(t) { return /liquidez|indices|balanco|solvencia/.test(norm(t)) }),
    tem_pl_minimo: cls.attention.some(function(t) { return /patrimonio liquido/.test(norm(t)) }),
    arquivos: arquivos,
    itens_pncp: itensInfo.resumo,
    total_itens_pncp: itensInfo.quantidade,
    raw_data: item,
    last_checked_at: new Date().toISOString(),
    data_coleta: ymdDashed(new Date()),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

async function collectPncpSearch(options) {
  options = options || {}
  var docs = options.docs !== false
  var maxPages = Number(options.searchPages || options.maxPages || 2)
  var terms = options.terms || PNCP_SEARCH_TERMS
  var enrich = options.enrich === true
  var enrichLimit = Number(options.enrichLimit || 0)
  var enriched = 0
  var out = []
  var logs = []

  for (var ti = 0; ti < terms.length; ti++) {
    var term = terms[ti]
    for (var pagina = 1; pagina <= maxPages; pagina++) {
      var url = 'https://pncp.gov.br/api/search?pagina=' + pagina
        + '&q=' + encodeURIComponent(term)
        + '&tipos_documento=edital'
        + '&status=recebendo_proposta'
        + '&tam_pagina=100'
        + '&ordenacao=-data'
      try {
        var json = await fetchJsonRetry(url)
        var items = Array.isArray(json.items) ? json.items : []
        logs.push({ fonte: 'PNCP Search', termo: term, pagina: pagina, encontrados: items.length, total: json.total })
        if (!items.length) break
        for (var i = 0; i < items.length; i++) {
          var item = pncpSearchItemToConsultaShape(items[i])
          var cls = classifySimple(item)
          if (cls.ignore) continue
          if (cls.score < 40 && cls.palavras.length === 0) continue
          if (enrich && (!enrichLimit || enriched < enrichLimit)) {
            var detail = await fetchPncpCompraDetalhe(item)
            if (detail) {
              item = mergePncpDetalhe(item, detail)
              cls = classifySimple(item)
              if (cls.ignore) continue
            }
            var itens = await fetchPncpItens(item)
            if (itens.length) item.itens_pncp = itens
            enriched++
          }
          var arquivos = (docs && enrich) ? await fetchPncpDocuments(item) : []
          out.push(pncpRecordFromItem(item, arquivos, 'PNCP Search'))
        }
        if (json.total && pagina * 100 >= Number(json.total)) break
      } catch (e) {
        logs.push({ fonte: 'PNCP Search', termo: term, pagina: pagina, erro: e.message })
        break
      }
    }
  }

  return { fonte: 'PNCP Search', registros: out, logs: logs }
}

async function collectPncp(options) {
  options = options || {}
  var dias = Number(options.dias ?? 14)
  var maxPages = Number(options.maxPages ?? 2)
  var docs = options.docs !== false
  var end = new Date()
  var start = new Date(end.getTime() - dias * 24 * 60 * 60 * 1000)
  var dataInicial = ymdCompact(start)
  var dataFinal = ymdCompact(end)
  var out = []
  var logs = []

  for (var mi = 0; mi < MODALIDADES_PNCP.length; mi++) {
    var modalidade = MODALIDADES_PNCP[mi]
    for (var pagina = 1; pagina <= maxPages; pagina++) {
      var url = 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=' + dataInicial + '&dataFinal=' + dataFinal + '&codigoModalidadeContratacao=' + modalidade + '&pagina=' + pagina
      try {
        var json = await fetchJson(url)
        var items = Array.isArray(json.data) ? json.data : []
        logs.push({ fonte: 'PNCP', modalidade: modalidade, pagina: pagina, encontrados: items.length })
        if (!items.length) break
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          var cls = classifySimple(item)
          if (cls.ignore) continue
          if (norm(cls.categoria).indexOf('nao relacionada') >= 0) continue
          if (cls.score < 40 && cls.palavras.length === 0) continue
          var detail = await fetchPncpCompraDetalhe(item)
          if (detail) {
            item = mergePncpDetalhe(item, detail)
            cls = classifySimple(item)
            if (cls.ignore) continue
          }
          var itens = await fetchPncpItens(item)
          if (itens.length) item.itens_pncp = itens
          var key = uniqueKeyFromPncp(item)
          var arquivos = docs ? await fetchPncpDocuments(item) : []
          var link = item.linkProcessoEletronico || item.linkSistemaOrigem || ('https://pncp.gov.br/app/editais/' + (item.orgaoEntidade && item.orgaoEntidade.cnpj) + '/' + item.anoCompra + '/' + item.sequencialCompra)
          out.push({
            id: key,
            unique_key: key,
            pncp_key: stableKeyFromPncp(item) || key,
            fonte: 'PNCP',
            source_name: 'PNCP',
            portal: 'PNCP',
            orgao: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || (item.unidadeOrgao && item.unidadeOrgao.nomeUnidade) || '',
            cnpj_orgao: item.orgaoEntidade && item.orgaoEntidade.cnpj || '',
            uf: item.unidadeOrgao && item.unidadeOrgao.ufSigla || '',
            municipio: item.unidadeOrgao && item.unidadeOrgao.municipioNome || '',
            modalidade: item.modalidadeNome || '',
            num_edital: item.numeroCompra || '',
            numero_processo: item.processo || '',
            objeto: item.objetoCompra || '',
            categoria: cls.categoria,
            data_publicacao: brDateTime(item.dataPublicacaoPncp || item.dataInclusao),
            data_atualizacao: brDateTime(item.dataAtualizacaoGlobal || item.dataAtualizacao),
            data_inicio_propostas: brDateTime(item.dataAberturaProposta),
            data_fim_propostas: brDateTime(item.dataEncerramentoProposta),
            data_sessao: brDateTime(item.dataAberturaProposta),
            valor_estimado: brMoney(item.valorTotalEstimado || item.valorTotalHomologado),
            criterio_julgamento: item.modoDisputaNome || '',
            modo_disputa: item.modoDisputaNome || '',
            tipo_contrato: item.tipoInstrumentoConvocatorioNome || '',
            link_licitacao: link,
            link_edital: arquivos[0] && arquivos[0].url || '',
            situacao: item.situacaoCompraNome || 'Divulgada no PNCP',
            fase_atual: item.situacaoCompraNome || '',
            status_licitacao: item.situacaoCompraNome || '',
            status_triagem: cls.classification === 'PARTICIPAR' ? 'em_analise' : (cls.classification === 'DESCARTAR' ? 'descartado' : 'novo'),
            status_interno: cls.classification === 'PARTICIPAR' ? 'Participar' : (cls.classification === 'DESCARTAR' ? 'Descartada' : 'Nova'),
            relevante: cls.score >= 70,
            relevancia: cls.score,
            classificacao_ia: cls.classification,
            classificacao_financeira: cls.financial,
            resumo: (item.objetoCompra || '').slice(0, 500),
            motivo_classificacao: cls.reason,
            pontos_atencao: cls.attention,
            documentos_exigidos: [],
            palavras_chave: cls.palavras,
            trecho_encontrado: cls.reason,
            tem_indices_financeiros: cls.attention.some(function(t) { return /liquidez|indices|balanco|solvencia/.test(norm(t)) }),
            tem_pl_minimo: cls.attention.some(function(t) { return /patrimonio liquido/.test(norm(t)) }),
            arquivos: arquivos,
            raw_data: item,
            last_checked_at: new Date().toISOString(),
            data_coleta: ymdDashed(new Date()),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }
      } catch (e) {
        logs.push({ fonte: 'PNCP', modalidade: modalidade, pagina: pagina, erro: e.message })
        break
      }
    }
  }
  return { fonte: 'PNCP', registros: out, logs: logs }
}

async function collectComprasGov(options) {
  options = options || {}
  return { fonte: 'Compras.gov', registros: [], logs: [{ fonte: 'Compras.gov', aviso: 'Coletor estruturado; endpoint novo exige calibragem de modalidades/parametros. PNCP ativo no MVP.' }] }
}

async function collectAll(options) {
  options = options || {}
  var pncpSearch = await collectPncpSearch(options)
  if (options.fast !== false) {
    var bySearchId = {}
    pncpSearch.registros.forEach(function(r) { bySearchId[r.id || r.unique_key || r.link_licitacao] = r })
    pncpSearch.registros = Object.values(bySearchId)
    return {
      ok: true,
      registros: pncpSearch.registros,
      fontes: [pncpSearch],
      total: pncpSearch.registros.length,
    }
  }
  var pncp = await collectPncp(options)
  var compras = await collectComprasGov(options)
  var byId = {}
  pncpSearch.registros.concat(pncp.registros, compras.registros).forEach(function(r) { byId[r.id] = r })
  return {
    ok: true,
    registros: Object.values(byId),
    fontes: [pncpSearch, pncp, compras],
    total: Object.keys(byId).length,
  }
}

module.exports = {
  collectAll,
  collectPncp,
  collectPncpSearch,
  collectComprasGov,
  fetchPncpDocuments,
  fetchPncpItens,
  fetchPncpCompraDetalhe,
  mergePncpDetalhe,
  pncpRecordFromItem,
  pncpSearchItemToConsultaShape,
  KEYWORDS_POSITIVE,
  KEYWORDS_NEGATIVE,
  PNCP_SEARCH_TERMS,
}
