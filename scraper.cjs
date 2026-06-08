/**
 * scraper.cjs — Lógica compartilhada de scraping de páginas de licitação
 * Usado por server.js (produção) e vite.config.js (desenvolvimento)
 */

const http  = require('http')
const https = require('https')

// ─── HTTP FETCH ───────────────────────────────────────────────────────────────

function fetchPageHtml(targetUrl, redirects) {
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
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection':      'close',
      }
    }
    var req = transport.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : parsed.origin + res.headers.location
        return resolve(fetchPageHtml(nextUrl, redirects + 1))
      }
      var chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end',  function () {
        var buf = Buffer.concat(chunks)
        resolve(decodeBuffer(buf, res.headers['content-type']))
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(35000, function () { req.destroy(); reject(new Error('Timeout ao acessar a página')) })
    req.end()
  })
}

/**
 * Decodifica o buffer aplicando o charset correto.
 * Prioridade: header Content-Type → meta charset (primeiros 1024 bytes) → utf-8.
 */
function decodeBuffer(buf, contentType) {
  // 1. Header HTTP
  var ct = contentType || ''
  var ctMatch = ct.match(/charset\s*=\s*["']?([^;"'\s]+)/i)
  if (ctMatch) {
    var cs = ctMatch[1].toLowerCase()
    if (cs.indexOf('iso-8859') >= 0 || cs.indexOf('windows-125') >= 0 || cs === 'latin1') {
      return buf.toString('latin1')
    }
    return buf.toString('utf8')
  }

  // 2. Meta charset (somente nos primeiros 1024 bytes do head)
  var head = buf.slice(0, 1024).toString('ascii')
  var metaMatch = head.match(/<meta[^>]+charset\s*=\s*["']?([^"'\s>]+)/i)
  if (metaMatch) {
    var ms = metaMatch[1].toLowerCase()
    if (ms.indexOf('iso-8859') >= 0 || ms.indexOf('windows-125') >= 0 || ms === 'latin1') {
      return buf.toString('latin1')
    }
  }

  // 3. Default UTF-8
  return buf.toString('utf8')
}

// ─── HTML UTILS ───────────────────────────────────────────────────────────────

function textOf(html) {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&atilde;/g, 'ã')
    .replace(/&otilde;/g, 'õ').replace(/&ccedil;/g, 'ç').replace(/&ecirc;/g, 'ê')
    .replace(/&acirc;/g, 'â').replace(/&ocirc;/g, 'ô').replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í').replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&Atilde;/g, 'Ã').replace(/&Otilde;/g, 'Õ')
    .replace(/&Ccedil;/g, 'Ç').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n)) })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)) })
    .replace(/\s+/g, ' ').trim()
}

function normalizeKey(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── PARSER DE TABELAS COLUNADAS ──────────────────────────────────────────────
/**
 * BLL Compras (e outros portais) usam tabelas com cabeçalhos numa linha
 * e os valores na linha seguinte:
 *
 *   <tr><th>Nº EDITAL</th><th>ÓRGÃO</th><th>MODALIDADE</th></tr>
 *   <tr><td>019/2026</td><td>MUN. SANTO ESTEVÃO</td><td>Pregão Eletr.</td></tr>
 *
 * Esta função extrai todas essas tabelas e devolve um dicionário
 * { "n edital": "019/2026", "orgao": "MUN. SANTO ESTEVÃO", ... }
 */
function parseColumnTables(html) {
  var dict = {}
  var tableRe = /<table[\s\S]*?<\/table>/gi
  var tables = html.match(tableRe) || []

  for (var t = 0; t < tables.length; t++) {
    var table = tables[t]

    // Pega todas as linhas <tr>
    var rows = []
    var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    var rm
    while ((rm = rowRe.exec(table)) !== null) rows.push(rm[1])
    if (rows.length < 2) continue

    // Extrai cabeçalhos (<th>) da primeira linha
    var headers = []
    var thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi
    var hm
    while ((hm = thRe.exec(rows[0])) !== null) headers.push(textOf(hm[1]))
    if (headers.length === 0) continue

    // Para cada linha de dados, extrai células e mapeia
    for (var i = 1; i < rows.length; i++) {
      var cells = []
      var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
      var cm
      while ((cm = tdRe.exec(rows[i])) !== null) cells.push(textOf(cm[1]))

      for (var j = 0; j < headers.length && j < cells.length; j++) {
        var key = normalizeKey(headers[j])
        if (!key) continue
        var val = cells[j]
        if (val && val !== '-' && val !== '—' && !dict[key]) {
          dict[key] = val
        }
      }
    }
  }
  return dict
}

// ─── PARSER DE PARES <label> + <input value="…"> ─────────────────────────────
/**
 * BLL Compras (e portais que usam Bootstrap form-control disabled) renderizam:
 *
 *   <label ...>NOME DO CAMPO</label>
 *   <input ... value="VALOR" ... />
 *
 * dentro de <td>s. Esta função varre o HTML inteiro e devolve um dicionário
 * { "n edital": "075/2025 PE", "publicacao": "19/12/2025 15:32", ... }
 * com a chave normalizada (sem acento, lowercase, sem pontuação).
 */
function parseLabelInputPairs(html) {
  var dict = {}

  // 1. <label>RÓTULO</label> ... <input ... value="VAL" .../>
  var reInput = /<label[^>]*>([\s\S]*?)<\/label>\s*(?:<[^>]+>\s*)*?<input\b[^>]*\bvalue\s*=\s*["']([^"']*)["'][^>]*\/?>/gi
  var m
  while ((m = reInput.exec(html)) !== null) {
    var label = textOf(m[1])
    var value = textOf(m[2])
    if (!label || !value) continue
    var key = normalizeKey(label)
    if (key && !dict[key]) dict[key] = value
  }

  // 2. <label>RÓTULO</label> ... <textarea ...>VALOR</textarea>
  var reTa = /<label[^>]*>([\s\S]*?)<\/label>\s*(?:<[^>]+>\s*)*?<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi
  while ((m = reTa.exec(html)) !== null) {
    var lbl2 = textOf(m[1])
    var val2 = textOf(m[2])
    if (!lbl2 || !val2) continue
    var k2 = normalizeKey(lbl2)
    if (k2 && !dict[k2]) dict[k2] = val2
  }

  return dict
}

// ─── EXTRATOR DE CAMPO (POR RÓTULO) ───────────────────────────────────────────
/**
 * Tenta extrair o valor de um campo a partir de várias variantes do rótulo.
 * Usa apenas padrões ESTRITOS — sem fallback "guloso" que pegava o próximo th.
 */
function extractFieldStrict(html, labels) {
  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    var patterns = [
      // <th>LABEL</th><td>VALOR</td>  (mesma linha)
      new RegExp('<th[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>', 'i'),
      // <dt>LABEL</dt><dd>VALOR</dd>
      new RegExp('<dt[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>', 'i'),
      // <td>LABEL</td><td>VALOR</td>
      new RegExp('<td[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>', 'i'),
      // <label>LABEL</label> + <input value="VALOR">
      new RegExp('<label[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/label>\\s*<input[^>]*value\\s*=\\s*["\']([^"\']*)["\']', 'i'),
      // <label>LABEL</label> + <span/p>VALOR</span/p>  (NÃO casa com <th>)
      new RegExp('<label[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/label>\\s*<(?:span|p|div|strong|b)[^>]*>([^<]+)<\\/(?:span|p|div|strong|b)>', 'i'),
      // <strong>LABEL:</strong> VALOR  (texto solto após o strong)
      new RegExp('<(?:strong|b)[^>]*>\\s*' + lbl + '\\s*:\\s*<\\/(?:strong|b)>\\s*([^<]{2,})', 'i'),
      // <span class="...label">LABEL</span> <span class="...value">VALOR</span>
      new RegExp('<span[^>]*>\\s*' + lbl + '\\s*:?\\s*<\\/span>\\s*<span[^>]*>([^<]+)<\\/span>', 'i'),
    ]

    for (var j = 0; j < patterns.length; j++) {
      var m = html.match(patterns[j])
      if (m) {
        var val = textOf(m[1])
        if (val && val !== '-' && val !== '—' && val !== 'N/A' && val.length > 0) return val
      }
    }
  }
  return ''
}

// ─── BLACKLIST DE LABELS COMUNS ───────────────────────────────────────────────
/**
 * Se o "valor" extraído coincidir com um destes textos, é descartado.
 * Eles são cabeçalhos/labels muito comuns que não devem ser usados como valor.
 */
var LABEL_BLACKLIST = [
  'fase', 'condutor', 'taxa adm', 'taxa adm.', 'ano referencia', 'ano referência',
  'lote', 'item', 'itens', 'qtd', 'qtde', 'quantidade', 'un', 'unidade',
  'status', 'situacao', 'situação', 'acoes', 'ações', 'codigo', 'código',
  'descricao', 'descrição', 'valor unit.', 'valor unitario', 'valor unitário',
  'valor total', 'data', 'hora', 'tipo', 'numero', 'número', 'n', 'no.', 'nº',
  'edital', 'processo', 'modalidade', 'orgao', 'órgão', 'promotor', 'objeto',
  'nº edital', 'n edital', 'orgao/promotor', 'órgão/promotor',
  'diligencias', 'diligências', 'historico', 'histórico',
]

function looksLikeLabel(value) {
  if (!value) return false
  var n = normalizeKey(value)
  for (var i = 0; i < LABEL_BLACKLIST.length; i++) {
    var bl = normalizeKey(LABEL_BLACKLIST[i])
    if (n === bl) return true
  }
  return false
}

// ─── BUSCA UNIFICADA POR CAMPO ────────────────────────────────────────────────

function buscarEmDict(dict, rotulos) {
  for (var i = 0; i < rotulos.length; i++) {
    var key = normalizeKey(rotulos[i])
    if (!key) continue
    // Match exato
    if (dict[key] && !looksLikeLabel(dict[key])) return dict[key]
    // Match por inclusão (ex: "n edital" inclui "edital", "publicacao" inclui "data publicacao")
    for (var k in dict) {
      if (k === key) continue
      if (k.indexOf(key) >= 0 || key.indexOf(k) >= 0) {
        if (dict[k] && !looksLikeLabel(dict[k])) return dict[k]
      }
    }
  }
  return ''
}

function buscarCampo(html, dicts, rotulos) {
  // 1. Tenta cada dicionário em ordem (label/input primeiro, depois colunas)
  for (var d = 0; d < dicts.length; d++) {
    var v = buscarEmDict(dicts[d], rotulos)
    if (v) return v
  }
  // 2. Padrões estritos no HTML
  var v2 = extractFieldStrict(html, rotulos)
  if (v2 && !looksLikeLabel(v2)) return v2
  return ''
}

// ─── PORTAL E LOCALIDADE ──────────────────────────────────────────────────────

function detectPortal(rawUrl) {
  try {
    var h = new URL(rawUrl).hostname.toLowerCase()
    if (h.indexOf('bllcompras.com') >= 0 || h.indexOf('bll.org.br') >= 0)        return 'BLL Compras'
    if (h.indexOf('pncp.gov.br') >= 0)                                           return 'Compras.gov (PNCP)'
    if (h.indexOf('compras.gov.br') >= 0)                                        return 'Compras.gov'
    if (h.indexOf('portaldecompraspublicas.com.br') >= 0)                        return 'Portal de Compras Públicas'
    if (h.indexOf('licitacoes-e.com.br') >= 0)                                   return 'Licitações-e'
    if (h.indexOf('licitanet.com.br') >= 0)                                      return 'Licitanet'
    if (h.indexOf('comprasnet.gov.br') >= 0)                                     return 'ComprasNet'
    return h
  } catch (e) { return 'Portal externo' }
}

function inferLocalidade(orgao) {
  if (!orgao) return { uf: '', municipio: '' }
  var mUf  = orgao.match(/\s*[-–]\s*([A-Z]{2})\s*$/)
  var uf   = mUf ? mUf[1] : ''
  var mMun = orgao.match(/(?:MUNIC[IÍ]PIO|PREFEITURA|CÂMARA|CAMARA)\s+(?:MUNICIPAL\s+)?DE\s+(.+?)(?:\s*[-–]|$)/i)
  var municipio = mMun ? textOf(mMun[1]) : ''
  return { uf: uf, municipio: municipio }
}

// ─── PALAVRAS-CHAVE ───────────────────────────────────────────────────────────

// Lista can\u00f4nica \u2014 mesmas strings exibidas como checkboxes no frontend.
// Mantenha sincronizada com TODAS_KEYWORDS em src/App.jsx.
var KEYWORDS = [
  'agenciamento de viagens',
  'agenciamento de passagens',
  'passagens a\u00e9reas',
  'passagens rodovi\u00e1rias',
  'passagens mar\u00edtimas',
  'passagens fluviais',
  'passagens ferrovi\u00e1rias',
  'passagens nacionais',
  'passagens internacionais',
  'hospedagem',
  'seguro viagem',
  'loca\u00e7\u00e3o de ve\u00edculos',
  'eventos',
  'traslado',
  'transporte',
  'turismo',
]

/** Remove acento e baixa pra lowercase. */
function _norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Varia\u00e7\u00f5es comuns para uma palavra (singular/plural em portugu\u00eas). */
function _wordVariants(w) {
  var set = {}
  set[w] = true
  // -m  \u2194 -ns   (hospedagem \u2194 hospedagens, viagem \u2194 viagens)
  if (/m$/.test(w))  set[w.slice(0, -1) + 'ns'] = true
  if (/ns$/.test(w)) set[w.slice(0, -2) + 'm']  = true
  // -l  \u2194 -is   (hotel \u2194 hoteis)
  if (/l$/.test(w))  set[w.slice(0, -1) + 'is'] = true
  if (/is$/.test(w)) set[w.slice(0, -2) + 'l']  = true
  // -\u00e3o \u2194 -oes  (loca\u00e7\u00e3o \u2194 locacoes \u2014 j\u00e1 normalizado pra "locacao" / "locacoes")
  if (/ao$/.test(w)) set[w.slice(0, -2) + 'oes'] = true
  if (/oes$/.test(w)) set[w.slice(0, -3) + 'ao'] = true
  // singular \u2194 plural simples (-s)
  if (/s$/.test(w))  set[w.slice(0, -1)] = true
  else               set[w + 's']        = true
  return Object.keys(set)
}

/**
 * Constr\u00f3i regex que casa a keyword permitindo plurais e conectores
 * opcionais (de/da/do/das/dos) entre as palavras.
 */
function _buildKeywordRegex(kw) {
  var normKw = _norm(kw)
  var words  = normKw.split(/\s+/).filter(Boolean)
  // Se a palavra j\u00e1 \u00e9 um conector ("de"/"da"/"do"), mant\u00e9m literal
  var parts = words.map(function (w) {
    if (/^(de|da|do|das|dos|e|a|o)$/.test(w)) return w
    return '(?:' + _wordVariants(w).join('|') + ')'
  })
  // Permite conectores opcionais entre palavras (assim "seguro viagem" casa "seguro DE viagem")
  var joined = parts.join('\\s+(?:de\\s+|da\\s+|do\\s+|das\\s+|dos\\s+)?')
  return new RegExp('\\b' + joined + '\\b', 'i')
}

// Cache de regex (constr\u00f3i s\u00f3 uma vez por keyword)
var _kwRegexCache = null
function _getKeywordRegexes() {
  if (_kwRegexCache) return _kwRegexCache
  _kwRegexCache = KEYWORDS.map(function (kw) {
    return { kw: kw, re: _buildKeywordRegex(kw) }
  })
  return _kwRegexCache
}

function detectKeywords(text) {
  var norm = _norm(text)
  return _getKeywordRegexes()
    .filter(function (k) { return k.re.test(norm) })
    .map(function (k) { return k.kw })
}

// ─── PARSER PRINCIPAL ─────────────────────────────────────────────────────────

function parseLicitacaoPage(html, sourceUrl) {
  var portal     = detectPortal(sourceUrl)
  var labelDict  = parseLabelInputPairs(html)
  var columnDict = parseColumnTables(html)

  function get(rotulos) { return buscarCampo(html, [labelDict, columnDict], rotulos) }

  var orgao = get([
    'Promotor', 'Órgão', 'Orgao', 'Órgão / Promotor', 'Orgao / Promotor', 'Orgão/Promotor',
    'Unidade Gestora', 'Entidade', 'Razão Social', 'Comprador',
  ])

  var numEdital = get([
    'Nº Edital', 'N Edital', 'Número do Edital', 'Numero do Edital',
    'Nº do Edital', 'No. do Edital', 'Nr. Edital', 'Número Edital', 'Edital',
  ])

  var numProcesso = get([
    'Nº Proc Adm', 'N Proc Adm', 'Nº Proc. Adm.', 'Processo Administrativo',
    'Número do Processo', 'Numero do Processo',
    'Nº do Processo', 'Nº Processo', 'N Processo', 'Processo Adm', 'Processo Adm.',
    'Processo',
  ])

  var modalidade = get([
    'Modalidade', 'Modalidade de Compra', 'Tipo de Licitação', 'Modalidade Licitação',
    'Tipo de Pregão',
  ])

  var tipoContrato = get([
    'Tipo Contrato', 'Tipo de Contrato', 'Tipo do Contrato', 'Regime de Execução',
    'Forma de Contratação', 'Sistema de Registro', 'SRP',
  ])

  var faseAtual = get([
    'Fase', 'Fase Atual', 'Fase do Processo', 'Etapa', 'Andamento',
    'Status do Processo', 'Situação do Processo', 'Estágio',
  ])

  var dataPublicacao = get([
    'Publicação', 'Data de Publicação', 'Data Publicação', 'Data Divulgação',
    'Data de Divulgação', 'Publicado em',
  ])

  var dataInicio = get([
    'Início Rec Proposta', 'Inicio Rec Proposta', 'Início Rec. Proposta',
    'Início do Recebimento', 'Inicio do Recebimento', 'Recebimento de Propostas',
    'Início das Propostas', 'Data Início Propostas', 'Início Recebimento',
    'Data de Início de Recebimento', 'Abertura de Propostas',
    'Data de Abertura das Propostas',
  ])

  var dataFim = get([
    'Fim Rec Proposta', 'Fim Rec. Proposta', 'Fim do Recebimento',
    'Encerramento das Propostas', 'Encerramento Recebimento',
    'Data de Encerramento', 'Data Encerramento', 'Fim das Propostas',
    'Fim Recebimento', 'Prazo Final de Propostas', 'Prazo para Propostas',
    'Data Fim Propostas', 'Data de Encerramento das Propostas', 'Limite de Propostas',
  ])

  var dataSessao = get([
    'Início Disputa', 'Inicio Disputa', 'Início da Disputa',
    'Data da Sessão', 'Data Sessão', 'Data da Disputa', 'Data Disputa',
    'Início da Sessão', 'Sessão Pública', 'Data da Sessão Pública',
    'Data/Hora da Sessão', 'Data e Hora da Sessão', 'Data de Abertura da Sessão',
  ])

  var impugnacao = get([
    'Fim Impugnação', 'Fim Impugnacao',
    'Prazo de Impugnação', 'Prazo Impugnação', 'Impugnação',
    'Prazo Final de Impugnação', 'Limite Impugnação', 'Limite para Impugnação',
    'Data Limite Impugnação',
  ])

  var esclarecimentos = get([
    'Fim Esclarecimentos',
    'Prazo de Esclarecimentos', 'Esclarecimentos', 'Prazo Esclarecimentos',
    'Prazo Final de Esclarecimentos', 'Limite Esclarecimentos',
    'Limite para Esclarecimentos', 'Data Limite Esclarecimentos',
  ])

  var validade = get([
    'Validade meses', 'Validade (meses)', 'Validade em Meses',
    'Validade da Proposta', 'Validade Proposta', 'Vigência da Proposta',
    'Prazo de Validade', 'Validade',
  ])

  var tipoLance = get([
    'Tipo de Lance', 'Critério de Julgamento', 'Julgamento',
    'Critério de Aceitação', 'Critério',
  ])

  var modoDisputa = get([
    'Modo de Disputa', 'Modo Disputa', 'Forma de Disputa', 'Modo da Disputa',
  ])

  var exclusivoMe = get([
    'Exclusivo ME', 'Exclusividade ME/EPP', 'Exclusivo ME/EPP', 'ME/EPP',
    'Cota ME/EPP', 'Benefício ME', 'Tratamento Diferenciado',
    'LC 123', 'Lei Complementar 123',
  ])

  var exclusivoReg = get([
    'Exclusivo Regional', 'Exclusividade Regional', 'Regional',
    'Exclusivo Local', 'Âmbito Local', 'Local',
  ])

  var objeto = get([
    'Objeto', 'Objeto da Licitação', 'Descrição do Objeto', 'Objeto do Processo',
    'Objeto da Contratação', 'Descrição',
  ])

  var valor = get([
    'Valor Total do Processo', 'Valor Total Estimado', 'Valor Estimado',
    'Valor Global', 'Valor da Licitação', 'Estimativa de Valor',
    'Valor de Referência', 'Valor Máximo Aceitável', 'Total Estimado',
    'Estimativa Total',
  ])

  // UF e município
  var uf  = get(['UF', 'Estado', 'Unidade Federativa']) || ''
  var mun = get(['Município', 'Municipio', 'Cidade']) || ''
  if (!uf || !mun) {
    var loc = inferLocalidade(orgao)
    if (!uf)  uf  = loc.uf
    if (!mun) mun = loc.municipio
  }

  return {
    portal:                portal,
    link_licitacao:        sourceUrl,
    orgao:                 orgao || '',
    uf:                    uf || '',
    municipio:             mun || '',
    num_edital:            numEdital || '',
    numero_processo:       numProcesso || '',
    modalidade:            modalidade || '',
    tipo_contrato:         tipoContrato || '',
    fase_atual:            faseAtual || '',
    data_publicacao:       dataPublicacao || '',
    data_inicio_propostas: dataInicio || '',
    data_fim_propostas:    dataFim || '',
    data_sessao:           dataSessao || '',
    prazo_impugnacao:      impugnacao || '',
    prazo_esclarecimentos: esclarecimentos || '',
    validade_proposta:     validade || '',
    tipo_lance:            tipoLance || '',
    modo_disputa:          modoDisputa || '',
    exclusivo_me_epp:      exclusivoMe || '',
    exclusivo_regional:    exclusivoReg || '',
    objeto:                objeto || 'não identificado automaticamente',
    valor_estimado:        valor  || 'não identificado automaticamente',
    palavras_chave:        detectKeywords(objeto || ''),

    // Para depuração: lista de chaves capturadas das tabelas colunadas
    _debug_columns: Object.keys(columnDict),
  }
}

// ─── ARQUIVOS DO PROCESSO (BLL) ───────────────────────────────────────────────
/**
 * Extrai o token criptografado do botão "Arquivos" da página principal do BLL.
 * Esse token é diferente do param1 da URL, e é usado em /Process/ProcessFiles.
 */
function extractProcessFilesToken(html) {
  var m = html.match(/doAction\([^)]*'Process'\s*,\s*'ProcessFiles'\s*,\s*\[\s*'([^']+)'/i)
  return m ? m[1] : ''
}

/**
 * Faz parse do HTML retornado por /Process/ProcessFiles.
 * Devolve: [{ nome, criado_em, url }]
 */
function parseProcessFilesHtml(html) {
  var arquivos = []
  // Estratégia: encontrar cada <a download="NOME" href="URL"> e tentar achar
  // a data próxima (o <td> imediatamente anterior).
  var aRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+\.[a-z0-9]{2,5})["'][^>]*\bdownload\s*=\s*["']([^"']+)["']/gi
  var aRe2 = /<a\b[^>]*\bdownload\s*=\s*["']([^"']+)["'][^>]*\bhref\s*=\s*["']([^"']+\.[a-z0-9]{2,5})["']/gi
  var matches = []
  var m
  while ((m = aRe.exec(html))  !== null) matches.push({ url: m[1], nome: m[2], pos: m.index })
  while ((m = aRe2.exec(html)) !== null) matches.push({ url: m[2], nome: m[1], pos: m.index })

  for (var i = 0; i < matches.length; i++) {
    var item = matches[i]
    // Procura a data: pega a fatia 400 chars antes da posição do <a>
    var antes = html.slice(Math.max(0, item.pos - 400), item.pos)
    var tdMatches = antes.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []
    var criadoEm = ''
    // Itera de trás para frente — a data é o último <td> antes do link
    for (var j = tdMatches.length - 1; j >= 0; j--) {
      var t = textOf(tdMatches[j].replace(/<\/?td[^>]*>/gi, ''))
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) { criadoEm = t; break }
    }
    arquivos.push({ nome: textOf(item.nome), criado_em: criadoEm, url: item.url })
  }

  // Deduplica por URL
  var seen = {}
  return arquivos.filter(function (a) {
    if (seen[a.url]) return false
    seen[a.url] = true
    return true
  })
}

/**
 * Para uma página BLL Compras: busca a lista de arquivos do processo.
 * Retorna [] se não conseguir.
 */
function fetchProcessFiles(pageHtml, baseUrl) {
  var token = extractProcessFilesToken(pageHtml)
  if (!token) return Promise.resolve([])
  var origin = ''
  try { origin = new URL(baseUrl).origin } catch (e) { origin = 'https://bllcompras.com' }
  var url = origin + '/Process/ProcessFiles?param1=' + encodeURIComponent(token)
  return fetchPageHtml(url).then(function (raw) {
    var inner = ''
    try { inner = JSON.parse(raw).html || '' } catch (e) { inner = raw }
    return parseProcessFilesHtml(inner)
  }).catch(function () { return [] })
}

// ─── PNCP ─────────────────────────────────────────────────────────────────────
/**
 * URL típica: https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}
 * API:       https://pncp.gov.br/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}
 * Arquivos:  https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos
 */
function parsePncpUrl(rawUrl) {
  try {
    var u = new URL(rawUrl)
    if (!/pncp\.gov\.br/i.test(u.hostname)) return null
    var m = u.pathname.match(/\/editais\/(\d{14})\/(\d{4})\/(\d+)/)
    if (!m) return null
    return { cnpj: m[1], ano: m[2], sequencial: m[3] }
  } catch (e) { return null }
}

/** Fetch específico para APIs JSON (usa headers application/json). */
function fetchJsonRaw(targetUrl, redirects) {
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
      headers: {
        // PNCP bloqueia alguns UAs (Mozilla/5.0 simples, curl…) — usar UA detalhado
        'User-Agent':      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    }
    var req = transport.request(opts, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : parsed.origin + res.headers.location
        return resolve(fetchJsonRaw(nextUrl, redirects + 1))
      }
      var chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end',  function () { resolve(Buffer.concat(chunks).toString('utf8')) })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(30000, function () { req.destroy(); reject(new Error('Timeout ao acessar API')) })
    req.end()
  })
}

/** Faz fetch com retry automático em caso de timeout (rate-limit do PNCP). */
var RETRY_DELAYS = [8000, 15000, 25000, 40000]   // 8s, 15s, 25s, 40s = ~1m30s no pior caso

function fetchJsonRawWithRetry(url, attempt) {
  attempt = attempt || 0
  return fetchJsonRaw(url).catch(function (err) {
    if (attempt < RETRY_DELAYS.length && /timeout/i.test(err.message)) {
      var wait = RETRY_DELAYS[attempt]
      console.log('[fetchJson] timeout — aguardando ' + (wait / 1000) + 's antes da tentativa ' + (attempt + 2) + '/' + (RETRY_DELAYS.length + 1))
      return new Promise(function (resolve) { setTimeout(resolve, wait) })
        .then(function () { return fetchJsonRawWithRetry(url, attempt + 1) })
    }
    throw err
  })
}

function _fetchJson(url) {
  return fetchJsonRawWithRetry(url).then(function (raw) {
    try { return JSON.parse(raw) } catch (e) { return null }
  })
}

function _formatPncpDate(iso) {
  if (!iso) return ''
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return iso
  return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5]
}

function _formatBRL(n) {
  if (!n && n !== 0) return ''
  if (typeof n === 'string') n = parseFloat(n)
  if (isNaN(n) || n === 0) return ''
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function parsePortalComprasPublicasUrl(rawUrl) {
  try {
    var u = new URL(rawUrl)
    if (!/portaldecompraspublicas\.com\.br$/i.test(u.hostname)) return null
    return u.pathname.indexOf('/processos/') >= 0 ? { url: rawUrl } : null
  } catch (e) { return null }
}

function _htmlDecodeJsonScript(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
}

function _extractNgState(html) {
  var m = html.match(/<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try { return JSON.parse(_htmlDecodeJsonScript(m[1])) } catch (e) { return null }
}

function _findStateBody(state, predicate) {
  if (!state || typeof state !== 'object') return null
  for (var k in state) {
    var entry = state[k]
    var body = entry && entry.b
    if (body && predicate(body, entry)) return body
  }
  return null
}

function _formatPortalDate(iso) {
  if (!iso) return ''
  var s = String(iso)
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (m) return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5]
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})-(\d{2}):(\d{2})/)
  if (m) return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3] + ' ' + m[4] + ':' + m[5]
  return s
}

function _extractUfFromPortalUrl(rawUrl) {
  try {
    var m = new URL(rawUrl).pathname.match(/\/processos\/([a-z]{2})\//i)
    return m ? m[1].toUpperCase() : ''
  } catch (e) { return '' }
}

function _formatPortalBool(v) {
  if (v === true) return 'Sim'
  if (v === false) return 'Não'
  return ''
}

function parsePortalComprasPublicasPage(html, sourceUrl) {
  var state = _extractNgState(html)
  if (!state) return null

  var lic = _findStateBody(state, function (b) {
    return b && b.codigoLicitacao && b.numeroProcesso && b.razaoSocialComprador
  })
  if (!lic) return null

  var itensBody = _findStateBody(state, function (b, entry) {
    return entry && /\/itens\?pagina=/i.test(entry.u || '') && b && b.itens && Array.isArray(b.itens.result)
  })
  var itens = itensBody && itensBody.itens && Array.isArray(itensBody.itens.result)
    ? itensBody.itens.result
    : []

  var docs = _findStateBody(state, function (b, entry) {
    return entry && /\/documentos\/processo/i.test(entry.u || '') && Array.isArray(b)
  }) || []

  var itemDescricoes = itens.map(function (i) { return i && i.descricao }).filter(Boolean)
  var objeto = lic.resumo || itemDescricoes.join('\n\n')

  var valorTotal = 0
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i] || {}
    var ref = it.valorReferencia
    var qtd = it.quantidade || 1
    if (ref || ref === 0) valorTotal += Number(ref) * Number(qtd || 1)
  }

  var arquivos = docs
    .filter(function (d) { return d && d.url })
    .map(function (d) {
      return {
        nome: d.nome || d.tituloDocumento || d.tipo || 'Documento',
        criado_em: _formatPortalDate(d.dataHora),
        url: d.url,
      }
    })

  return {
    portal:                'Portal de Compras Públicas',
    link_licitacao:        sourceUrl,
    orgao:                 lic.razaoSocialComprador || '',
    uf:                    _extractUfFromPortalUrl(sourceUrl),
    municipio:             lic.cidadeEstadoComprador || '',
    num_edital:            lic.numeroProcesso || '',
    numero_processo:       lic.numeroProcesso || '',
    modalidade:            lic.tipoLicitacao || lic.tipoPregao || '',
    tipo_contrato:         '',
    fase_atual:            lic.statusProcesso && lic.statusProcesso.descricao || lic.operacao || '',
    data_publicacao:       _formatPortalDate(lic.dataHoraPublicacao),
    data_inicio_propostas: _formatPortalDate(lic.dataHoraInicioRecebimentoPropostas),
    data_fim_propostas:    _formatPortalDate(lic.dataHoraFinalRecebimentoPropostas || lic.dataHoraLimiteRecebimentoPropostas),
    data_sessao:           _formatPortalDate(lic.dataHoraAbertura),
    prazo_impugnacao:      _formatPortalDate(lic.dataHoraLimiteImpugnacoes),
    prazo_esclarecimentos: _formatPortalDate(lic.dataHoraLimiteEsclarecimentos),
    validade_proposta:     '',
    tipo_lance:            lic.tipoJulgamento || '',
    modo_disputa:          lic.tratamentoFasesLances || '',
    exclusivo_me_epp:      _formatPortalBool(lic.isTratamentoDiferenciado),
    exclusivo_regional:    _formatPortalBool(lic.isBeneficoLocal),
    objeto:                objeto || 'não identificado automaticamente',
    valor_estimado:        _formatBRL(valorTotal) || 'não identificado automaticamente',
    palavras_chave:        detectKeywords((objeto || '') + '\n' + itemDescricoes.join('\n')),
    arquivos:              arquivos,
  }
}

function fetchPncpProcess(url) {
  var ids = parsePncpUrl(url)
  if (!ids) return Promise.reject(new Error('URL PNCP inválida'))
  var apiBase = 'https://pncp.gov.br/api/consulta/v1/orgaos/' + ids.cnpj +
                '/compras/' + ids.ano + '/' + ids.sequencial
  var arqUrl  = 'https://pncp.gov.br/api/pncp/v1/orgaos/' + ids.cnpj +
                '/compras/' + ids.ano + '/' + ids.sequencial + '/arquivos'

  // Sequencial: PNCP rate-limita chamadas paralelas do mesmo IP
  return _fetchJson(apiBase).then(function (j) {
    return _fetchJson(arqUrl).catch(function () { return [] }).then(function (arq) {
      return [j, arq]
    })
  }).then(function (results) {
    var j   = results[0] || {}
    var arq = Array.isArray(results[1]) ? results[1] : []

    var orgao = j.orgaoEntidade && j.orgaoEntidade.razaoSocial || ''
    var ufNome = j.unidadeOrgao && j.unidadeOrgao.ufSigla || ''
    var mun    = j.unidadeOrgao && j.unidadeOrgao.municipioNome || ''
    var objeto = j.objetoCompra || ''
    if (j.informacaoComplementar) objeto += (objeto ? '\n\n' : '') + 'Informação complementar: ' + j.informacaoComplementar

    var data = {
      portal:                'PNCP',
      link_licitacao:        url,
      orgao:                 orgao,
      uf:                    ufNome,
      municipio:             mun,
      num_edital:            j.numeroCompra || '',
      numero_processo:       j.processo || '',
      modalidade:            j.modalidadeNome || '',
      tipo_contrato:         j.tipoInstrumentoConvocatorioNome || '',
      fase_atual:            j.situacaoCompraNome || '',
      data_publicacao:       _formatPncpDate(j.dataPublicacaoPncp),
      data_inicio_propostas: _formatPncpDate(j.dataAberturaProposta),
      data_fim_propostas:    _formatPncpDate(j.dataEncerramentoProposta),
      data_sessao:           _formatPncpDate(j.dataAberturaProposta),
      prazo_impugnacao:      '',
      prazo_esclarecimentos: '',
      validade_proposta:     '',
      tipo_lance:            '',
      modo_disputa:          j.modoDisputaNome || '',
      exclusivo_me_epp:      '',
      exclusivo_regional:    '',
      objeto:                objeto || 'não identificado automaticamente',
      valor_estimado:        _formatBRL(j.valorTotalEstimado) || (j.orcamentoSigilosoCodigo === 3 ? 'Sigiloso' : ''),
      palavras_chave:        detectKeywords(objeto),
      arquivos: arq.map(function (a) {
        return {
          nome: (a.titulo || ('documento-' + a.sequencialDocumento)) +
                (a.tipoDocumentoNome ? ' (' + a.tipoDocumentoNome + ')' : ''),
          criado_em: _formatPncpDate(a.dataPublicacaoPncp),
          url: a.url,
        }
      }),
    }
    return data
  })
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
/**
 * Função única que recebe uma URL de licitação e devolve os dados parseados,
 * roteando entre PNCP (API JSON) e BLL/genérico (HTML).
 */
function fetchAndParse(url) {
  if (parsePncpUrl(url)) return fetchPncpProcess(url)
  if (parsePortalComprasPublicasUrl(url)) {
    return fetchPageHtml(url).then(function (html) {
      var data = parsePortalComprasPublicasPage(html, url)
      if (data) return data
      return parseLicitacaoPage(html, url)
    })
  }

  // Default: HTML scraping (BLL e similares)
  return fetchPageHtml(url).then(function (html) {
    var data = parseLicitacaoPage(html, url)
    return fetchProcessFiles(html, url).then(function (arquivos) {
      data.arquivos = arquivos || []
      return data
    })
  })
}

module.exports = {
  fetchPageHtml,
  parseLicitacaoPage,
  parseColumnTables,
  extractFieldStrict,
  detectPortal,
  detectKeywords,
  fetchProcessFiles,
  extractProcessFilesToken,
  parseProcessFilesHtml,
  parsePncpUrl,
  fetchPncpProcess,
  parsePortalComprasPublicasUrl,
  parsePortalComprasPublicasPage,
  fetchAndParse,
}
