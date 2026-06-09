/**
 * analyzer.cjs — Download + extração de texto de PDFs + análise por regex.
 * Usado pelo endpoint /api/analyze-pdf (server.cjs e vite.config.js).
 */

const http  = require('http')
const https = require('https')
const AdmZip = require('adm-zip')

// pdf-parse v2 exporta classe `PDFParse`; v1 exporta função.
let _pdfApi = null
function getPdfApi() {
  if (_pdfApi) return _pdfApi
  const m = require('pdf-parse')
  if (m.PDFParse) {
    _pdfApi = { type: 'class', PDFParse: m.PDFParse }
  } else if (typeof m === 'function') {
    _pdfApi = { type: 'fn', fn: m }
  } else if (m.default && typeof m.default === 'function') {
    _pdfApi = { type: 'fn', fn: m.default }
  } else {
    throw new Error('Não foi possível carregar pdf-parse')
  }
  return _pdfApi
}

// ─── DOWNLOAD BINÁRIO ────────────────────────────────────────────────────────

function fetchBinaryOnce(targetUrl, redirects) {
  redirects = redirects || 0
  if (redirects > 5) return Promise.reject(new Error('Muitos redirecionamentos'))
  return new Promise(function (resolve, reject) {
    var parsed
    try { parsed = new URL(targetUrl) } catch (e) { return reject(new Error('URL inválida')) }
    var transport = parsed.protocol === 'https:' ? https : http
    var opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      rejectUnauthorized: false,
      headers: {
        // UA detalhado que sabemos passar pela proteção do PNCP
        'User-Agent':      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/pdf,application/octet-stream,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    }
    var req = transport.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var next = res.headers.location.startsWith('http')
          ? res.headers.location
          : parsed.origin + res.headers.location
        return resolve(fetchBinaryOnce(next, redirects + 1))
      }
      var chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end',  function () {
        if (res.statusCode !== 200) {
          var err = new Error('HTTP ' + res.statusCode + ' ao baixar arquivo')
          err.statusCode = res.statusCode
          err.body = Buffer.concat(chunks).toString('utf8').slice(0, 1000)
          return reject(err)
        }
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || '',
          contentDisposition: res.headers['content-disposition'] || '',
        })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60000, function () { req.destroy(); reject(new Error('Timeout ao baixar arquivo')) })
    req.end()
  })
}

function parsePncpArquivoUrl(targetUrl) {
  try {
    var u = new URL(targetUrl)
    if (!/pncp\.gov\.br$/i.test(u.hostname)) return null
    var m = u.pathname.match(/\/pncp-api\/v1\/orgaos\/(\d+)\/compras\/(\d+)\/(\d+)\/arquivos\/(\d+)/i)
    if (!m) return null
    return { cnpj: m[1], ano: m[2], sequencial: m[3], arquivo: Number(m[4]) }
  } catch {
    return null
  }
}

function fetchJson(targetUrl) {
  return fetchBinaryOnce(targetUrl).then(function (bin) {
    return JSON.parse(bin.buffer.toString('utf8'))
  })
}

function resolvePncpArquivoAtivo(targetUrl) {
  var ids = parsePncpArquivoUrl(targetUrl)
  if (!ids) return Promise.resolve(targetUrl)
  var listaUrl = 'https://pncp.gov.br/api/pncp/v1/orgaos/' + ids.cnpj +
    '/compras/' + ids.ano + '/' + ids.sequencial + '/arquivos'
  return fetchJson(listaUrl).then(function (docs) {
    if (!Array.isArray(docs) || docs.length === 0) return targetUrl
    var ativoMesmoTipo = docs.find(function (d) {
      return d && d.statusAtivo !== false && Number(d.sequencialDocumento) !== ids.arquivo &&
        /edital/i.test((d.tipoDocumentoNome || '') + ' ' + (d.titulo || ''))
    })
    var ativo = ativoMesmoTipo || docs.find(function (d) { return d && d.statusAtivo !== false })
    return (ativo && (ativo.url || ativo.uri)) || targetUrl
  }).catch(function () {
    return targetUrl
  })
}

/** fetchBinary com retry automático em caso de timeout (rate-limit do PNCP). */
function fetchBinary(targetUrl, redirects) {
  var DELAYS = [8000, 15000, 25000]   // 3 retries
  function tryFetch(attempt) {
    return fetchBinaryOnce(targetUrl, redirects).catch(function (err) {
      if ((err.statusCode === 422 || err.statusCode === 404) && parsePncpArquivoUrl(targetUrl)) {
        return resolvePncpArquivoAtivo(targetUrl).then(function (novoUrl) {
          if (novoUrl && novoUrl !== targetUrl) {
            console.log('[analyzer] arquivo PNCP antigo indisponível; usando arquivo ativo:', novoUrl)
            return fetchBinaryOnce(novoUrl, redirects)
          }
          throw err
        })
      }
      if (attempt < DELAYS.length && /timeout/i.test(err.message)) {
        var wait = DELAYS[attempt]
        console.log('[analyzer] timeout — aguardando ' + (wait / 1000) + 's antes da tentativa ' + (attempt + 2))
        return new Promise(function (r) { setTimeout(r, wait) }).then(function () { return tryFetch(attempt + 1) })
      }
      throw err
    })
  }
  return tryFetch(0)
}

// ─── EXTRAÇÃO DE TEXTO ───────────────────────────────────────────────────────

async function extractPdfText(buffer) {
  const api = getPdfApi()
  if (api.type === 'class') {
    const inst = new api.PDFParse({ data: buffer })
    const r = await inst.getText()
    // v2: r.text é string consolidada; r.pages é array de objetos com text
    let text = r.text || ''
    if (!text && Array.isArray(r.pages)) {
      text = r.pages.map(p => p.text || '').join('\n')
    }
    const numPaginas = Array.isArray(r.pages) ? r.pages.length : (r.numpages || r.numPages || 0)
    return { text, pages: numPaginas }
  }
  // v1
  const r = await api.fn(buffer)
  return { text: r.text || '', pages: r.numpages || 0 }
}

// ─── ANÁLISE POR REGEX ───────────────────────────────────────────────────────

function _norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function uniqArr(arr) {
  var seen = {}
  return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true })
}

/**
 * Detecta ocorrências de palavras-chave de viagens no texto INTEIRO do edital,
 * com tolerância a plural e conector. Retorna { keyword: count }.
 */
const KEYWORDS_VIAGEM = [
  'agenciamento de viagens',
  'agenciamento de passagens',
  'passagens aéreas',
  'bilhete aéreo',
  'bilhetes aéreos',
  'emissão de bilhetes',
  'emissão de passagens',
  'passagens rodoviárias',
  'bilhete rodoviário',
  'bilhetes rodoviários',
  'transporte rodoviário de passageiros',
  'passagens marítimas',
  'passagens fluviais',
  'passagens ferroviárias',
  'passagens nacionais',
  'passagens internacionais',
  'hospedagem',
  'seguro viagem',
  'locação de veículos',
  'eventos',
  'traslado',
  'transporte',
  'turismo',
  'hotelaria',
  'diária',
  'reserva de hotel',
]

function _wordVariants(w) {
  var s = {}
  s[w] = true
  if (/m$/.test(w))   s[w.slice(0, -1) + 'ns'] = true
  if (/ns$/.test(w))  s[w.slice(0, -2) + 'm']  = true
  if (/l$/.test(w))   s[w.slice(0, -1) + 'is'] = true
  if (/is$/.test(w))  s[w.slice(0, -2) + 'l']  = true
  if (/ao$/.test(w))  s[w.slice(0, -2) + 'oes'] = true
  if (/oes$/.test(w)) s[w.slice(0, -3) + 'ao']  = true
  if (/s$/.test(w))   s[w.slice(0, -1)] = true
  else                s[w + 's']        = true
  return Object.keys(s)
}

function _buildKwRegex(kw) {
  var n = _norm(kw)
  var words = n.split(/\s+/).filter(Boolean)
  var parts = words.map(function (w) {
    if (/^(de|da|do|das|dos|e|a|o)$/.test(w)) return w
    return '(?:' + _wordVariants(w).join('|') + ')'
  })
  var joined = parts.join('\\s+(?:de\\s+|da\\s+|do\\s+|das\\s+|dos\\s+)?')
  return new RegExp('\\b' + joined + '\\b', 'gi')
}

function detectarKeywords(textoNorm) {
  var hits = {}
  for (var i = 0; i < KEYWORDS_VIAGEM.length; i++) {
    var kw = KEYWORDS_VIAGEM[i]
    var re = _buildKwRegex(kw)
    var m  = textoNorm.match(re)
    if (m && m.length > 0) hits[kw] = m.length
  }
  return hits
}

/**
 * Sinais positivos/negativos pra Fibratur (agência de viagens com CADASTUR).
 */
const REQUISITOS_HABILITACAO = [
  { id: 'cadastur',         label: 'CADASTUR',           re: /\b(cadastur|cadastr[oa]\s+(?:de\s+prestadores\s+de\s+servi[çc]os\s+tur[ií]sticos)?)\b/gi },
  { id: 'iata',             label: 'IATA',               re: /\b(IATA|International Air Transport)\b/g },
  { id: 'abav',             label: 'ABAV',               re: /\bABAV\b/g },
  { id: 'snea',             label: 'SNEA',               re: /\bSNEA\b/g },
  { id: 'minist_turismo',   label: 'Min. do Turismo',     re: /minist[ée]rio\s+do\s+turismo/gi },
  { id: 'iso',              label: 'Certificação ISO',    re: /\bISO\s*\d{4,5}\b/gi },
  { id: 'cnpj_atividade',   label: 'CNAE específico',     re: /\bCNAE\b|c[oó]digo\s+de\s+atividade/gi },
  { id: 'capital_social',   label: 'Capital social mínimo', re: /capital\s+social\s+m[ií]nimo|capital\s+integralizado/gi },
  { id: 'patrimonio_liquido', label: 'Patrimônio líquido', re: /patrim[oô]nio\s+l[ií]quido/gi },
  { id: 'atestado_capacidade', label: 'Atestado de capacidade técnica', re: /atestad[oa]s?\s+de\s+capacidade\s+t[ée]cnica/gi },
  { id: 'visita_tecnica',   label: 'Visita técnica obrigatória', re: /visita\s+t[ée]cnica\s+(?:obrigat[óo]ria|preliminar)/gi },
  { id: 'me_epp_exclusivo', label: 'EXCLUSIVO ME/EPP',    re: /exclusiv[ao]\s+(?:para\s+)?(?:m[ie]croempresas?|empresas?\s+de\s+pequeno\s+porte|me\/epp|me\s+e\s+epp)/gi },
  { id: 'cota_me_epp',      label: 'Cota ME/EPP',         re: /cota\s+(?:reservada\s+)?(?:para\s+)?(?:m[ie]croempresas?|me\/epp|me\s+e\s+epp)/gi },
  { id: 'regional',         label: 'Restrição regional/local', re: /\b(?:exclusiv[ao]\s+)?(?:[âa]mbito\s+local|regional|sediadas?\s+(?:no\s+munic[ií]pio|na\s+regi[ãa]o))/gi },
  { id: 'subcontratacao',   label: 'Subcontratação',      re: /subcontrata[çc][ãa]o/gi },
  { id: 'consorcio',        label: 'Consórcio',           re: /\bcons[óo]rcio\b/gi },
]

function detectarRequisitos(texto) {
  var hits = []
  for (var i = 0; i < REQUISITOS_HABILITACAO.length; i++) {
    var r = REQUISITOS_HABILITACAO[i]
    var m = texto.match(r.re)
    if (m && m.length > 0) hits.push({ id: r.id, label: r.label, ocorrencias: m.length, exemplo: m[0] })
  }
  return hits
}

/**
 * Extrai datas no texto (formato dd/mm/aaaa ou dd/mm/aaaa hh:mm).
 */
function extrairDatas(texto) {
  var re = /\b(\d{1,2}\/\d{1,2}\/\d{4}(?:\s+(?:às|as)?\s*\d{1,2}[:hH]\d{2})?)\b/g
  var m  = texto.match(re) || []
  return uniqArr(m.map(function (s) { return s.trim() })).slice(0, 30)
}

/**
 * Extrai valores em R$ no texto.
 */
function extrairValores(texto) {
  var re = /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g
  var m  = texto.match(re) || []
  // Ordena do maior para o menor
  function valorNum(s) {
    var t = s.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.')
    return parseFloat(t) || 0
  }
  return uniqArr(m).sort(function (a, b) { return valorNum(b) - valorNum(a) }).slice(0, 15)
}

/**
 * Devolve o trecho do texto que contém uma palavra (até N caracteres ao redor).
 */
function trechoContexto(texto, regex, raio) {
  raio = raio || 200
  var m = regex.exec(texto)
  if (!m) return ''
  var ini = Math.max(0, m.index - raio)
  var fim = Math.min(texto.length, m.index + m[0].length + raio)
  return (ini > 0 ? '…' : '') + texto.slice(ini, fim).replace(/\s+/g, ' ').trim() + (fim < texto.length ? '…' : '')
}

// ─── CRITÉRIOS FINANCEIROS (eliminatórios) ────────────────────────────────────
/**
 * Extrai exigências de índices financeiros e patrimônio líquido — campos
 * tipicamente eliminatórios na fase de habilitação econômico-financeira.
 *
 * Para cada índice (LG, LC, SG, ISG, GE), procura ocorrências do nome e busca
 * o limite numérico próximo (≥, >, maior que, igual ou superior a, etc.).
 */
const INDICES_FIN = [
  { id: 'LG',  label: 'Liquidez Geral',     re: /\b(?:[ÍI]ndice\s+de\s+)?[Ll]iquidez\s+[Gg]eral\b|\bILG\b|\bLG\b/g },
  { id: 'LC',  label: 'Liquidez Corrente',  re: /\b(?:[ÍI]ndice\s+de\s+)?[Ll]iquidez\s+[Cc]orrente\b|\bILC\b|\bLC\b/g },
  { id: 'SG',  label: 'Solvência Geral',    re: /\b(?:[ÍI]ndice\s+de\s+)?[Ss]olv[êe]ncia\s+[Gg]eral\b|\bISG\b|\bSG\b/g },
  { id: 'GE',  label: 'Grau de Endividamento', re: /\b(?:[ÍI]ndice\s+de\s+)?[Gg]rau\s+de\s+[Ee]ndividamento\b|\bIGE\b/g },
  { id: 'EG',  label: 'Endividamento Geral',   re: /\b[Ee]ndividamento\s+[Gg]eral\b/g },
]

/**
 * Procura o "limite" próximo a um match (até `raio` chars depois).
 * Exemplos que casa:
 *   "≥ 1,0"   ">= 1"   "maior ou igual a 1,5"   "superior a 1,00"
 *   "não inferior a 1"   "= 1,0 (um)"
 */
function _extrairLimite(trecho) {
  // procura: comparador + número (com vírgula ou ponto)
  // Aceita variações em português (singular/plural):
  //   "maior(es) ou igual(is) a/que", "igual(is) ou superior(es) a",
  //   "superior(es) a", "não inferior(es) a", "≥", ">=", ">", "="
  var re = /(?:≥|>=|>|=|maior(?:es)?\s+(?:ou\s+igua(?:l|is)\s+)?(?:a|que)|igua(?:l|is)\s+(?:ou\s+superior(?:es)?\s+)?a|superior(?:es)?(?:\s+ou\s+igua(?:l|is))?\s+a|n[ãa]o\s+inferior(?:es)?\s+a)\s*(?:(?:a|que)\s+)?(\d+(?:[.,]\d+)?)/i
  var m = trecho.match(re)
  if (!m) return null
  var n = parseFloat(m[1].replace(',', '.'))
  return isNaN(n) ? null : { numero: n, formatado: m[1].replace('.', ',') }
}

function detectarIndicesFinanceiros(texto) {
  var resultado = []
  var jaVistos = {}

  for (var i = 0; i < INDICES_FIN.length; i++) {
    var ind = INDICES_FIN[i]
    if (jaVistos[ind.id]) continue

    var re = new RegExp(ind.re.source, 'gi')
    var m
    while ((m = re.exec(texto)) !== null) {
      // Olha 250 chars depois do match em busca do limite
      var trecho = texto.slice(m.index, m.index + 250)
      var limite = _extrairLimite(trecho)
      // Trecho mais amplo para contexto (50 chars antes + 250 depois)
      var contextoIni = Math.max(0, m.index - 50)
      var contextoFim = Math.min(texto.length, m.index + 250)
      var contexto = texto.slice(contextoIni, contextoFim).replace(/\s+/g, ' ').trim()

      if (limite) {
        resultado.push({
          id:        ind.id,
          label:     ind.label,
          minimo:    limite.numero,
          formatado: limite.formatado,
          contexto:  contexto,
          critico:   limite.numero > 1,  // > 1 é mais raro/restritivo
        })
        jaVistos[ind.id] = true
        break
      }
    }
  }

  return resultado
}

/**
 * Patrimônio líquido mínimo: pode ser absoluto (R$ X) ou percentual do valor estimado.
 * Casa frases como:
 *   "patrimônio líquido mínimo de R$ 50.000,00"
 *   "patrimônio líquido não inferior a 10% (dez por cento) do valor estimado"
 *   "patrimônio líquido igual ou superior a R$ 100.000,00"
 */
function detectarPatrimonioLiquido(texto) {
  var resultados = []
  // Procura cada ocorrência e pega 300 chars seguintes (sem cortar em pontos
  // de separador de milhar como em "R$ 50.000,00")
  var rePL = /patrim[oô]nio\s+l[ií]quido[\s\S]{0,300}/gi
  var matches = texto.match(rePL) || []

  for (var i = 0; i < matches.length; i++) {
    var trecho = matches[i].replace(/\s+/g, ' ').trim()
    // Trunca em ponto-final + espaço + maiúscula (fim de frase)
    var fim = trecho.search(/\.\s+[A-Z]/)
    if (fim > 30) trecho = trecho.slice(0, fim + 1)

    // Tenta extrair valor em R$ no trecho
    var reBRL = /R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/
    var mBRL = trecho.match(reBRL)

    // Tenta extrair percentual
    var rePct = /(\d{1,2}(?:[.,]\d+)?)\s*%/
    var mPct = trecho.match(rePct)

    if (mBRL || mPct) {
      // Verifica se está num contexto de exigência (mínimo, não inferior, igual ou superior)
      if (/(m[ií]nimo|n[ãa]o\s+inferior\s+a|igual\s+ou\s+superior\s+a|superior(?:\s+ou\s+igual)?\s+a|≥|>=|comprovar)/i.test(trecho)) {
        var item = { contexto: trecho }
        if (mBRL) {
          var n = parseFloat(mBRL[1].replace(/\./g, '').replace(',', '.'))
          item.valorAbsoluto = n
          item.formatado = 'R$ ' + mBRL[1]
        }
        if (mPct) {
          item.percentual = parseFloat(mPct[1].replace(',', '.'))
          if (!item.formatado) item.formatado = mPct[1] + '%'
          else item.formatado += ' ou ' + mPct[1] + '%'
        }
        resultados.push(item)
        if (resultados.length >= 3) break
      }
    }
  }

  return resultados
}

function detectarSubcontratacaoHospedagem(texto) {
  var textoLimpo = texto.replace(/\s+/g, ' ').trim()
  var n = _norm(textoLimpo)
  var ehHospedagem = /hospedagem|hotelaria|hotel|pousada|diaria|acomodacao/.test(n)
  if (!ehHospedagem) {
    return { aplicavel: false, nivel: 'neutro', permitido: null, resumo: 'Nao parece edital de hospedagem.', sinais: [], trechos: [] }
  }

  var regras = [
    { tipo: 'critico', label: 'Subcontratacao vedada', re: /(?:vedad[ao]|proibid[ao]|nao\s+(?:sera|e|serao)?\s*permitid[ao]s?)\s+(?:a\s+)?subcontratacao|subcontratacao\s+(?:total\s+ou\s+parcial\s+)?(?:e\s+)?(?:vedada|proibida|nao\s+permitida)/gi },
    { tipo: 'critico', label: 'Execucao propria exigida', re: /execucao\s+(?:direta|propria)|prestacao\s+direta|sem\s+intermediacao|nao\s+podera\s+(?:terceirizar|subcontratar)|responsabilidade\s+direta\s+da\s+contratada/gi },
    { tipo: 'critico', label: 'Restrito a hotel/pousada', re: /(?:somente|exclusivamente|apenas)\s+(?:hoteis|hot[eé]is|pousadas|meios\s+de\s+hospedagem)|(?:hotel|pousada|meio\s+de\s+hospedagem)\s+(?:localizad[ao]|situad[ao])|estabelecimentos?\s+hoteleiros?\s+(?:local|da\s+regiao|do\s+municipio)/gi },
    { tipo: 'atencao', label: 'Credenciamento de meios de hospedagem', re: /credenciamento[\s\S]{0,180}(?:hotel|pousada|meio\s+de\s+hospedagem|hospedagem)|(?:hotel|pousada|meio\s+de\s+hospedagem)[\s\S]{0,180}credenciamento/gi },
    { tipo: 'positivo', label: 'Subcontratacao permitida', re: /(?:permitid[ao]|admitid[ao]|autorizad[ao])\s+(?:a\s+)?subcontratacao|podera\s+subcontratar|subcontratacao\s+(?:parcial\s+)?(?:permitida|admitida|autorizada)/gi },
    { tipo: 'positivo', label: 'Agencia/intermediacao aceita', re: /agencia\s+de\s+viagens|agenciamento\s+(?:de\s+viagens|de\s+hospedagem)|intermediacao\s+de\s+hospedagem|reserva\s+de\s+hoteis/gi },
  ]

  var sinais = []
  var trechos = []
  for (var i = 0; i < regras.length; i++) {
    var r = regras[i]
    var matches = textoLimpo.match(r.re)
    if (matches && matches.length) {
      sinais.push({ tipo: r.tipo, label: r.label, ocorrencias: matches.length })
      r.re.lastIndex = 0
      trechos.push({ tipo: r.tipo, label: r.label, texto: trechoContexto(textoLimpo, r.re, 260) })
    }
  }

  var critico = sinais.some(function(s) { return s.tipo === 'critico' })
  var atencao = sinais.some(function(s) { return s.tipo === 'atencao' })
  var positivo = sinais.some(function(s) { return s.tipo === 'positivo' })
  var nivel = 'atencao'
  var permitido = null
  var resumo = 'Hospedagem detectada. Nao encontrei regra clara sobre subcontratacao; conferir edital.'

  if (critico) {
    nivel = 'critico'
    permitido = false
    resumo = 'Possivel bloqueio para agencia: edital indica restricao a subcontratacao, execucao propria ou hotel/pousada local.'
  } else if (positivo) {
    nivel = 'ok'
    permitido = true
    resumo = 'Ha sinais de que agencia/intermediacao ou subcontratacao pode ser aceita, mas confirme as clausulas.'
  } else if (atencao) {
    nivel = 'atencao'
    permitido = null
    resumo = 'Credenciamento/hospedagem detectado; pode exigir que o proprio hotel/pousada participe.'
  }

  return {
    aplicavel: true,
    nivel: nivel,
    permitido: permitido,
    resumo: resumo,
    sinais: sinais,
    trechos: trechos.slice(0, 6),
  }
}

/**
 * Análise principal — recebe texto extraído e devolve resumo estruturado.
 */
function analisar(texto) {
  if (!texto) return { erro: 'Texto vazio' }
  var textoLimpo = texto.replace(/\s+/g, ' ').trim()
  var textoNorm  = _norm(textoLimpo)
  var len = textoLimpo.length

  var keywords    = detectarKeywords(textoNorm)
  var requisitos  = detectarRequisitos(textoLimpo)
  var datas       = extrairDatas(textoLimpo)
  var valores     = extrairValores(textoLimpo)
  var indicesFin  = detectarIndicesFinanceiros(textoLimpo)
  var patrimonio  = detectarPatrimonioLiquido(textoLimpo)
  var subHospedagem = detectarSubcontratacaoHospedagem(textoLimpo)

  // Trechos importantes pra cada requisito relevante
  var trechos = {}
  for (var i = 0; i < requisitos.length; i++) {
    var r = REQUISITOS_HABILITACAO.find(function (x) { return x.id === requisitos[i].id })
    if (r) {
      r.re.lastIndex = 0
      trechos[requisitos[i].id] = trechoContexto(textoLimpo, r.re, 220)
    }
  }

  // Recomendação combinando aderência + sinais financeiros
  var temViagem = Object.keys(keywords).length > 0
  var bloqueado = requisitos.some(function (r) { return r.id === 'me_epp_exclusivo' || r.id === 'regional' })
  if (subHospedagem && subHospedagem.nivel === 'critico') bloqueado = true
  var indicesAltos = indicesFin.some(function (x) { return x.minimo > 1 })
  var temPlMinimo  = patrimonio.length > 0
  var recomendacao
  if (!temViagem) {
    recomendacao = { nivel: 'baixo', texto: 'Pouca aderência ao perfil de viagens detectada no documento.' }
  } else if (bloqueado || indicesAltos || temPlMinimo) {
    var motivos = []
    if (bloqueado)    motivos.push('possíveis restrições (ME/EPP, regional)')
    if (indicesAltos) motivos.push('índices financeiros mais altos que o usual (>1)')
    if (temPlMinimo)  motivos.push('exigência de patrimônio líquido mínimo')
    if (subHospedagem && subHospedagem.nivel === 'critico') motivos.push('hospedagem com restricao operacional para agencia')
    recomendacao = {
      nivel: 'atencao',
      texto: 'Aderente, mas com pontos eliminatórios em destaque: ' + motivos.join('; ') + '.',
    }
  } else {
    recomendacao = { nivel: 'alto', texto: 'Aderente ao perfil de viagens. Avalie em detalhe o edital.' }
  }

  return {
    tamanho_texto:    len,
    keywords:         keywords,
    requisitos:       requisitos,
    indices_financeiros: indicesFin,
    patrimonio_liquido:  patrimonio,
    subcontratacao_hospedagem: subHospedagem,
    trechos:          trechos,
    datas:            datas,
    valores:          valores,
    recomendacao:     recomendacao,
    preview:          textoLimpo.slice(0, 1500),
  }
}

// ─── PIPELINE COMPLETO ────────────────────────────────────────────────────────

/** Extrai texto de um DOCX (Word) — lê word/document.xml e strip de tags. */
function extractDocxText(buffer) {
  var zip = new AdmZip(buffer)
  var entry = zip.getEntry('word/document.xml')
  if (!entry) return ''
  var xml = entry.getData().toString('utf8')
  // Substitui <w:p> por quebra de linha pra preservar parágrafos
  var texto = xml
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<w:tab\/>/gi, '\t')
    .replace(/<w:br\/>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]+/g, ' ')
    .trim()
  return texto
}

/** Extrai texto de um arquivo XLSX — lê sharedStrings + sheet*.xml. */
function extractXlsxText(buffer) {
  try {
    var zip = new AdmZip(buffer)
    var entries = zip.getEntries()
    var texto = ''
    // Tudo que tem <t>...</t> nos XMLs (texto das células)
    for (var i = 0; i < entries.length; i++) {
      if (/\.xml$/i.test(entries[i].entryName) && /(sheet|sharedStrings)/i.test(entries[i].entryName)) {
        var xml = entries[i].getData().toString('utf8')
        var matches = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
        for (var j = 0; j < matches.length; j++) {
          var m = matches[j].match(/<t[^>]*>([\s\S]*?)<\/t>/)
          if (m) texto += m[1] + ' '
        }
      }
    }
    return texto.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  } catch (e) { return '' }
}

/**
 * Extrai recursivamente todos os PDFs/DOCX/XLSX de um buffer.
 * Suporta: PDF direto, DOCX, XLSX, ZIP simples, ZIP aninhado (ZIP dentro de ZIP).
 *
 * @param {Buffer} buffer
 * @param {string} nome  — nome do arquivo (pra debug)
 * @param {number} prof  — profundidade atual (proteção contra ZIP-bomb)
 * @returns {Promise<{textos: Array<{nome, texto, paginas}>, tipos: Set<string>, info: string[]}>}
 */
async function extrairConteudoRecursivo(buffer, nome, prof) {
  prof = prof || 0
  if (prof > 5) return { textos: [], tipos: new Set(), info: ['(profundidade máxima atingida em ' + nome + ')'] }
  if (!buffer || buffer.length < 4) return { textos: [], tipos: new Set(), info: [] }

  var firstBytes = buffer.slice(0, 8).toString()
  var info = []
  var tipos = new Set()

  // PDF direto
  if (firstBytes.startsWith('%PDF')) {
    try {
      var r = await extractPdfText(buffer)
      tipos.add('PDF')
      return {
        textos: [{ nome: nome, texto: r.text || '', paginas: r.pages || 0 }],
        tipos: tipos, info: info,
      }
    } catch (e) {
      info.push('Falha ao ler PDF ' + nome + ': ' + e.message)
      return { textos: [], tipos: tipos, info: info }
    }
  }

  // ZIP-based (DOCX, XLSX, archive ou ZIP aninhado)
  if (firstBytes.startsWith('PK')) {
    var zip
    try { zip = new AdmZip(buffer) } catch (e) {
      info.push('ZIP corrompido (' + nome + '): ' + e.message)
      return { textos: [], tipos: tipos, info: info }
    }
    var entries = zip.getEntries()
    var nomes = entries.map(function (e) { return e.entryName })

    // DOCX (Word)
    if (nomes.indexOf('word/document.xml') >= 0) {
      var t = extractDocxText(buffer)
      tipos.add('DOCX')
      return {
        textos: [{ nome: nome, texto: t, paginas: 1 }],
        tipos: tipos, info: info,
      }
    }
    // XLSX (Excel)
    if (nomes.some(function (n) { return /^xl\//.test(n) })) {
      var t2 = extractXlsxText(buffer)
      tipos.add('XLSX')
      return {
        textos: [{ nome: nome, texto: t2, paginas: 1 }],
        tipos: tipos, info: info,
      }
    }

    // ZIP genérico: percorre entradas e processa PDFs/DOCX/XLSX/ZIPs internos
    tipos.add('ZIP')
    var todosTextos = []
    // Filtra arquivos relevantes (PDF, DOCX, XLSX, ZIP) — pula imagens, dwg, etc.
    var relevantes = entries.filter(function (e) {
      if (e.isDirectory) return false
      return /\.(pdf|docx?|xlsx?|zip)$/i.test(e.entryName)
    })
    // Ordena: ZIPs aninhados primeiro (provável edital), depois PDFs por tamanho desc
    relevantes.sort(function (a, b) {
      var aZip = /\.zip$/i.test(a.entryName)
      var bZip = /\.zip$/i.test(b.entryName)
      if (aZip && !bZip) return -1
      if (!aZip && bZip) return 1
      return b.header.size - a.header.size
    })

    for (var k = 0; k < relevantes.length && k < 15; k++) {
      try {
        var entryBuf = relevantes[k].getData()
        var sub = await extrairConteudoRecursivo(entryBuf, relevantes[k].entryName, prof + 1)
        todosTextos = todosTextos.concat(sub.textos)
        sub.tipos.forEach(function (t) { tipos.add(t) })
        info = info.concat(sub.info)
      } catch (e) {
        info.push('Falha em ' + relevantes[k].entryName + ': ' + e.message)
      }
    }

    if (todosTextos.length === 0) {
      info.push('ZIP "' + nome + '" sem arquivos suportados. Conteúdo: ' + nomes.slice(0, 5).join(', ') + (nomes.length > 5 ? '…' : ''))
    }
    return { textos: todosTextos, tipos: tipos, info: info }
  }

  // Outros formatos
  if (firstBytes.startsWith('{') || firstBytes.startsWith('[')) {
    var preview = buffer.slice(0, 200).toString()
    info.push('Servidor devolveu JSON (erro): ' + preview.slice(0, 150) + '…')
    tipos.add('JSON')
    return { textos: [], tipos: tipos, info: info }
  }
  if (/^<!doctype|^<html/i.test(firstBytes)) {
    info.push('Servidor devolveu página HTML (provavelmente login/erro).')
    tipos.add('HTML')
    return { textos: [], tipos: tipos, info: info }
  }

  info.push('Formato não reconhecido em ' + nome + '. Primeiros bytes: "' + firstBytes.replace(/[^\x20-\x7e]/g, '·').slice(0, 30) + '"')
  return { textos: [], tipos: tipos, info: info }
}

/** Wrapper compat com chamadas antigas — concatena tudo num só blob de texto. */
async function extractTextAny(buffer) {
  var resultado = await extrairConteudoRecursivo(buffer, 'arquivo', 0)
  if (resultado.textos.length === 0) {
    return { texto: '', paginas: 0, tipo: Array.from(resultado.tipos).join('/') || 'desconhecido', erro: resultado.info.join(' · ') }
  }

  // Concatena texto de todos os arquivos extraídos
  var textoTotal = resultado.textos
    .map(function (t) { return '\n\n--- ' + t.nome + ' ---\n\n' + (t.texto || '') })
    .join('')
    .trim()
  var paginas = resultado.textos.reduce(function (acc, t) { return acc + (t.paginas || 0) }, 0)
  var tipo = Array.from(resultado.tipos).join('+') + ' (' + resultado.textos.length + ' arquivo' + (resultado.textos.length === 1 ? '' : 's') + ')'

  return { texto: textoTotal, paginas: paginas, tipo: tipo }
}

async function downloadAndAnalyze(url) {
  var bin = await fetchBinary(url)

  var resultado
  try {
    resultado = await extractTextAny(bin.buffer)
  } catch (e) {
    return {
      ok: false,
      erro: 'Falha ao processar arquivo: ' + (e.message || 'erro desconhecido'),
      tamanho_bytes: bin.buffer.length,
    }
  }

  if (resultado.erro || !resultado.texto || resultado.texto.trim().length < 50) {
    return {
      ok: false,
      erro: resultado.erro || 'Sem texto extraível (' + resultado.tipo + '). Pode ser documento escaneado.',
      tamanho_bytes: bin.buffer.length,
      paginas: resultado.paginas,
      tipo: resultado.tipo,
    }
  }

  var ana = analisar(resultado.texto)
  ana.ok            = true
  ana.tamanho_bytes = bin.buffer.length
  ana.paginas       = resultado.paginas
  ana.tipo          = resultado.tipo
  return ana
}

module.exports = {
  fetchBinary,
  resolvePncpArquivoAtivo,
  extractPdfText,
  extractTextAny,
  analisar,
  downloadAndAnalyze,
}
