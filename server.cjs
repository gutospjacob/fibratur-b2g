/**
 * server.js — Painel Fibratur Licitações
 * Serve os arquivos estáticos do build + endpoint /api/scrape para scraping BLL.
 * Execute com: node server.js
 * Não requer instalação de pacotes — usa apenas Node.js nativo.
 */
const http  = require('http')
const fs    = require('fs')
const path  = require('path')
const url   = require('url')
const AdmZip = require('adm-zip')
const { fetchAndParse } = require('./scraper.cjs')
const { downloadAndAnalyze, fetchBinary, extractTextAny } = require('./analyzer.cjs')
const { collectAll, fetchPncpDocuments, fetchPncpItens, fetchPncpCompraDetalhe } = require('./collector.cjs')

const PORT = Number(process.env.PORT || 5173)
const ROOT = path.join(__dirname, 'dist')   // pasta com o build Vite
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// Arquivo de persistência permanente (ao lado do server.cjs, nunca dentro de dist/)
var DADOS_FILE = path.join(DATA_DIR, 'dados.json')
var DOCUMENTOS_FILE = path.join(DATA_DIR, 'documentos.json')
var SENHAS_FILE = path.join(DATA_DIR, 'senhas.json')

function isAuthEnabled() {
  return !!(process.env.APP_USER && process.env.APP_PASSWORD)
}

function checkBasicAuth(req) {
  if (!isAuthEnabled()) return true
  var header = req.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  try {
    var decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    var idx = decoded.indexOf(':')
    if (idx < 0) return false
    var user = decoded.slice(0, idx)
    var pass = decoded.slice(idx + 1)
    return user === process.env.APP_USER && pass === process.env.APP_PASSWORD
  } catch {
    return false
  }
}

function requireAuth(req, res) {
  if (checkBasicAuth(req)) return false
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Fibratur"',
  })
  res.end('Acesso restrito')
  return true
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
  '.zip':  'application/zip',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.woff': 'font/woff',
  '.woff2':'font/woff2'
}

// ─── SERVIDOR HTTP ─────────────────────────────────────────────────────────────

function brMoney(v) {
  if (v === null || v === undefined || v === '') return ''
  var n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function sanitizeDownloadName(name) {
  var clean = (name || '').toString().trim().replace(/[\\/:*?"<>|]/g, '_')
  return clean || ''
}

function safeZipName(name) {
  return sanitizeDownloadName(name).replace(/\s+/g, ' ').trim() || 'documento'
}

function filenameFromDisposition(disposition) {
  var header = (disposition || '').toString()
  if (!header) return ''

  var star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      return star[1].trim().replace(/^"|"$/g, '')
    }
  }

  var plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i)
  return plain && plain[2] ? plain[2].trim() : ''
}

function hasFileExtension(name) {
  return /\.[A-Za-z0-9]{2,8}$/.test(name || '')
}

function extensionFromBinary(bin) {
  var buffer = bin && bin.buffer
  var type = ((bin && bin.contentType) || '').toLowerCase()
  if (buffer && buffer.length >= 4) {
    var sig4 = buffer.subarray(0, 4).toString('hex')
    if (sig4 === '25504446') return '.pdf'
    if (sig4 === '504b0304') return '.zip'
  }
  if (type.indexOf('pdf') >= 0) return '.pdf'
  if (type.indexOf('zip') >= 0 || type.indexOf('compressed') >= 0) return '.zip'
  return ''
}

function resolveDownloadName(requestedName, bin) {
  var requested = sanitizeDownloadName(requestedName)
  var remote = sanitizeDownloadName(filenameFromDisposition(bin && bin.contentDisposition))
  var remoteExt = hasFileExtension(remote) ? path.extname(remote) : ''
  var ext = remoteExt || extensionFromBinary(bin)

  var base = requested
  if (!base || base.toLowerCase() === 'arquivo.pdf') base = remote || 'arquivo'

  if (!hasFileExtension(base) && ext) base += ext
  return base.replace(/"/g, '')
}

function collectRequestBuffer(req, limitBytes) {
  return new Promise(function(resolve, reject) {
    var chunks = []
    var size = 0
    req.on('data', function(chunk) {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('Arquivo muito grande'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function() { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

function parseMultipartFile(body, contentType) {
  var boundaryMatch = (contentType || '').match(/boundary=([^;]+)/i)
  if (!boundaryMatch) throw new Error('Formulario de upload invalido')

  var boundary = Buffer.from('--' + boundaryMatch[1].replace(/^"|"$/g, ''))
  var start = body.indexOf(boundary)
  while (start >= 0) {
    var partStart = start + boundary.length
    if (body[partStart] === 45 && body[partStart + 1] === 45) break
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2

    var next = body.indexOf(boundary, partStart)
    if (next < 0) break

    var part = body.subarray(partStart, next)
    if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
      part = part.subarray(0, part.length - 2)
    }

    var headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd >= 0) {
      var headers = part.subarray(0, headerEnd).toString('utf8')
      var fileData = part.subarray(headerEnd + 4)
      var filenameMatch = headers.match(/filename="([^"]+)"/i)
      if (filenameMatch && fileData.length) {
        return {
          filename: sanitizeDownloadName(filenameMatch[1]) || 'documento',
          buffer: fileData,
          contentType: ((headers.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream').trim(),
        }
      }
    }

    start = next
  }
  throw new Error('Nenhum arquivo enviado')
}

function titleCaseDocumentName(name) {
  return (name || '')
    .replace(/\.[A-Za-z0-9]{2,8}$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, function(c) { return c.toUpperCase() })
}

function brDateToIso(date) {
  var raw = (date || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  var meses = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' }
  var extenso = raw.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/)
  var m = raw.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (!m && !extenso) return ''
  var d = (m ? m[1] : extenso[1]).padStart(2, '0')
  var mo = m ? m[2].padStart(2, '0') : meses[extenso[2]]
  var y = m ? (m[3].length === 2 ? '20' + m[3] : m[3]) : extenso[3]
  if (!mo) return ''
  return y + '-' + mo + '-' + d
}

function inferDocumentType(text, filename) {
  var s = ((text || '') + ' ' + (filename || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (s.indexOf('contrato social') >= 0) return 'Contrato social'
  if (s.indexOf('cartao cnpj') >= 0 || s.indexOf('comprovante de inscricao') >= 0) return 'Cartao CNPJ'
  if (s.indexOf('balanco patrimonial') >= 0 || s.indexOf('demonstracao do resultado') >= 0) return 'Balanco patrimonial'
  if (s.indexOf('falencia') >= 0 || s.indexOf('recuperacao judicial') >= 0) return 'Certidao falencia/recuperacao'
  if (s.indexOf('certidao negativa de debitos trabalhistas') >= 0 || s.indexOf('justica do trabalho') >= 0) return 'Certidao trabalhista'
  if (s.indexOf('fgts') >= 0 || s.indexOf('certificado de regularidade do fgts') >= 0) return 'Certidao FGTS'
  if (s.indexOf('receita federal') >= 0 || s.indexOf('procuradoria-geral da fazenda nacional') >= 0) return 'Certidao federal'
  if (s.indexOf('fazenda estadual') >= 0 || s.indexOf('secretaria da fazenda') >= 0) return 'Certidao estadual'
  if (s.indexOf('fazenda municipal') >= 0 || s.indexOf('prefeitura') >= 0) return 'Certidao municipal'
  if (s.indexOf('certidao') >= 0) return 'Certidao'
  return ''
}

function inferDocumentIssuer(text) {
  var s = text || ''
  var sn = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  var checks = [
    ['Receita Federal', /receita federal/i],
    ['PGFN', /procuradoria[- ]geral da fazenda nacional|pgfn/i],
    ['Caixa Economica Federal', /caixa economica federal|fgts/i],
    ['Justica do Trabalho', /justica do trabalho|tribunal superior do trabalho/i],
    ['Junta Comercial', /junta comercial/i],
    ['Tribunal de Justica', /tribunal de justica/i],
    ['Secretaria da Fazenda', /secretaria da fazenda|sefaz/i],
    ['Prefeitura Municipal', /prefeitura municipal/i],
  ]
  for (var i = 0; i < checks.length; i++) {
    if (checks[i][1].test(sn) || checks[i][1].test(s)) return checks[i][0]
  }
  var org = s.match(/(?:emissor|orgao emissor|emitido por)\s*:?\s*([^\n\r]{4,80})/i)
  return org ? org[1].trim() : ''
}

function inferDocumentDates(text) {
  var s = (text || '').replace(/\s+/g, ' ')
  var sn = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  var vencPatterns = [
    /(?:valida ate|validade ate|valido ate|vencimento|data de validade|prazo de validade|expira em|validade)\s*:?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i,
    /(?:certidao valida ate|regularidade valida ate)\s*:?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i,
    /(?:valida ate|validade ate|valido ate|vencimento|data de validade|expira em)\s*:?\s*(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i,
  ]
  var out = { emissao: '', vencimento: '' }
  for (var i = 0; i < vencPatterns.length; i++) {
    var mv = sn.match(vencPatterns[i])
    if (mv) { out.vencimento = brDateToIso(mv[1]); break }
  }
  var me = sn.match(/(?:emitida em|emissao|data de emissao|expedida em|emitido em|gerado em)\s*:?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i)
  if (me) out.emissao = brDateToIso(me[1])
  if (!out.vencimento && out.emissao) {
    var prazo = sn.match(/validade\s+(?:de|por)\s+(\d{1,3})\s+dias/i)
    if (prazo) {
      var dt = new Date(out.emissao + 'T00:00:00')
      dt.setDate(dt.getDate() + Number(prazo[1]))
      out.vencimento = dt.toISOString().slice(0, 10)
    }
  }
  return out
}

async function analyzeUploadedDocument(file) {
  var fallbackName = titleCaseDocumentName(file.filename)
  var out = {
    ok: false,
    nome: fallbackName,
    tipo: inferDocumentType('', file.filename),
    numero: '',
    emissor: '',
    emissao: '',
    vencimento: '',
    observacoes: '',
  }

  try {
    var extracted = await extractTextAny(file.buffer)
    var text = extracted && extracted.texto ? extracted.texto : ''
    if (!text || text.trim().length < 30) {
      out.observacoes = 'Nao foi possivel ler texto do arquivo. Pode ser PDF escaneado.'
      return out
    }
    var firstLine = text.split(/\r?\n/).map(function(l) { return l.trim() }).filter(Boolean)[0] || ''
    var dates = inferDocumentDates(text)
    var cnpj = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)
    out.ok = true
    out.nome = inferDocumentType(text, file.filename) || (firstLine.length <= 80 ? firstLine : fallbackName)
    out.tipo = inferDocumentType(text, file.filename)
    out.numero = cnpj ? cnpj[0] : ''
    out.emissor = inferDocumentIssuer(text)
    out.emissao = dates.emissao
    out.vencimento = dates.vencimento
    out.observacoes = 'Lido automaticamente: ' + (extracted.tipo || 'arquivo') + (extracted.paginas ? ', ' + extracted.paginas + ' pag.' : '')
    return out
  } catch (e) {
    out.observacoes = 'Nao foi possivel analisar o arquivo: ' + (e.message || 'erro desconhecido')
    return out
  }
}

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true)

  // ── CORS preflight ────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  if (req.method !== 'OPTIONS' && requireAuth(req, res)) return
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // ── GET /api/dados → lê dados.json ───────────────────────────────────────
  if (parsed.pathname === '/api/dados' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!fs.existsSync(DADOS_FILE)) {
      res.writeHead(200)
      return res.end('[]')
    }
    fs.readFile(DADOS_FILE, 'utf8', function(err, content) {
      if (err) {
        res.writeHead(500)
        return res.end(JSON.stringify({ error: err.message }))
      }
      res.writeHead(200)
      res.end(content)
    })
    return
  }

  // ── POST /api/dados → salva dados.json ───────────────────────────────────
  if (parsed.pathname === '/api/dados' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var body = ''
    req.on('data', function(chunk) { body += chunk })
    req.on('end', function() {
      try {
        var lista = JSON.parse(body)
        if (!Array.isArray(lista)) throw new Error('Esperava um array')

        // Backup atômico: mantém 1 versão anterior antes de sobrescrever
        if (fs.existsSync(DADOS_FILE)) {
          try { fs.copyFileSync(DADOS_FILE, DADOS_FILE + '.bak') } catch {}
        }

        fs.writeFile(DADOS_FILE, JSON.stringify(lista), 'utf8', function(err) {
          if (err) {
            res.writeHead(500)
            return res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          console.log('[dados] Salvo: ' + lista.length + ' licitações em dados.json')
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true, qtd: lista.length }))
        })
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false, error: 'JSON inválido: ' + e.message }))
      }
    })
    return
  }

  // ── /api/scrape?url=... ────────────────────────────────────────────────────
  if (parsed.pathname === '/api/documentos/baixar-tudo' && req.method === 'GET') {
    try {
      var docsZip = []
      if (fs.existsSync(DOCUMENTOS_FILE)) {
        try { docsZip = JSON.parse(fs.readFileSync(DOCUMENTOS_FILE, 'utf8')) } catch {}
      }
      if (!Array.isArray(docsZip)) docsZip = []
      var zip = new AdmZip()
      var usados = {}
      var adicionados = 0

      docsZip.forEach(function(doc, idx) {
        if (!doc || !doc.arquivo_url || doc.arquivo_url.indexOf('/uploads/') !== 0) return
        var cleanUrl = doc.arquivo_url.split('?')[0]
        var uploadPath = path.normalize(path.join(__dirname, decodeURIComponent(cleanUrl)))
        if (uploadPath.indexOf(UPLOADS_DIR) !== 0 || !fs.existsSync(uploadPath) || fs.statSync(uploadPath).isDirectory()) return
        var ext = path.extname(uploadPath) || path.extname(doc.arquivo_nome || doc.arquivo || '') || '.bin'
        var base = safeZipName((doc.nome || doc.arquivo_nome || doc.arquivo || ('documento-' + (idx + 1))).replace(new RegExp(ext.replace('.', '\\.') + '$', 'i'), ''))
        var zipName = base + ext
        var count = usados[zipName] || 0
        usados[zipName] = count + 1
        if (count > 0) zipName = base + '-' + (count + 1) + ext
        zip.addLocalFile(uploadPath, '', zipName)
        adicionados++
      })

      if (!adicionados) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'Nenhum arquivo local encontrado para baixar.' }))
        return
      }

      var bufferZip = zip.toBuffer()
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="fibratur-documentos.zip"',
        'Content-Length': bufferZip.length,
      })
      res.end(bufferZip)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: e.message || 'Erro ao gerar ZIP' }))
    }
    return
  }

  if (parsed.pathname === '/api/documentos' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!fs.existsSync(DOCUMENTOS_FILE)) {
      res.writeHead(200)
      return res.end('[]')
    }
    fs.readFile(DOCUMENTOS_FILE, 'utf8', function(err, content) {
      if (err) {
        res.writeHead(500)
        return res.end(JSON.stringify({ error: err.message }))
      }
      res.writeHead(200)
      res.end(content || '[]')
    })
    return
  }

  if (parsed.pathname === '/api/documentos' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var docsBody = ''
    req.on('data', function(chunk) { docsBody += chunk })
    req.on('end', function() {
      try {
        var listaDocs = JSON.parse(docsBody)
        if (!Array.isArray(listaDocs)) throw new Error('Esperava um array')
        if (fs.existsSync(DOCUMENTOS_FILE)) {
          try { fs.copyFileSync(DOCUMENTOS_FILE, DOCUMENTOS_FILE + '.bak') } catch {}
        }
        fs.writeFile(DOCUMENTOS_FILE, JSON.stringify(listaDocs, null, 2), 'utf8', function(err) {
          if (err) {
            res.writeHead(500)
            return res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          console.log('[documentos] Salvo: ' + listaDocs.length + ' documentos em documentos.json')
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true, qtd: listaDocs.length }))
        })
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false, error: 'JSON invalido: ' + e.message }))
      }
    })
    return
  }

  if (parsed.pathname === '/api/senhas' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!fs.existsSync(SENHAS_FILE)) {
      res.writeHead(200)
      return res.end('[]')
    }
    fs.readFile(SENHAS_FILE, 'utf8', function(err, content) {
      if (err) {
        res.writeHead(500)
        return res.end(JSON.stringify({ error: err.message }))
      }
      res.writeHead(200)
      res.end(content || '[]')
    })
    return
  }

  if (parsed.pathname === '/api/senhas' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var senhasBody = ''
    req.on('data', function(chunk) { senhasBody += chunk })
    req.on('end', function() {
      try {
        var listaSenhas = JSON.parse(senhasBody)
        if (!Array.isArray(listaSenhas)) throw new Error('Esperava um array')
        if (fs.existsSync(SENHAS_FILE)) {
          try { fs.copyFileSync(SENHAS_FILE, SENHAS_FILE + '.bak') } catch {}
        }
        fs.writeFile(SENHAS_FILE, JSON.stringify(listaSenhas, null, 2), 'utf8', function(err) {
          if (err) {
            res.writeHead(500)
            return res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          console.log('[senhas] Salvo: ' + listaSenhas.length + ' acessos em senhas.json')
          res.writeHead(200)
          res.end(JSON.stringify({ ok: true, qtd: listaSenhas.length }))
        })
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false, error: 'JSON invalido: ' + e.message }))
      }
    })
    return
  }

  if (parsed.pathname === '/api/upload' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    collectRequestBuffer(req, 60 * 1024 * 1024)
      .then(async function(body) {
        var file = parseMultipartFile(body, req.headers['content-type'])
        var docsDir = path.join(UPLOADS_DIR, 'docs')
        fs.mkdirSync(docsDir, { recursive: true })

        var ext = path.extname(file.filename)
        var base = path.basename(file.filename, ext).replace(/\s+/g, ' ').trim() || 'documento'
        var finalName = Date.now() + '-' + base + ext
        var target = path.join(docsDir, finalName)
        fs.writeFileSync(target, file.buffer)

        var analise = await analyzeUploadedDocument(file)

        res.writeHead(200)
        res.end(JSON.stringify({
          ok: true,
          filename: file.filename,
          storedName: finalName,
          url: '/uploads/docs/' + encodeURIComponent(finalName),
          size: file.buffer.length,
          contentType: file.contentType,
          analise: analise,
        }))
      })
      .catch(function(err) {
        res.writeHead(400)
        res.end(JSON.stringify({ ok: false, error: err.message || 'Erro ao enviar arquivo' }))
      })
    return
  }

  if (parsed.pathname === '/api/coletar') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var diasColeta = Number(parsed.query.dias || 14)
    var paginasColeta = Number(parsed.query.paginas || 1)
    var rapido = parsed.query.full !== '1'
    console.log('[coletor] Iniciando coleta real: ' + diasColeta + ' dias, ' + paginasColeta + ' paginas, modo ' + (rapido ? 'rapido' : 'completo'))
    collectAll({
      dias: diasColeta,
      maxPages: paginasColeta,
      searchPages: Number(parsed.query.searchPages || paginasColeta || 2),
      docs: parsed.query.docs === '1',
      enrich: parsed.query.enrich === '1',
      enrichLimit: Number(parsed.query.enrichLimit || 0),
      fast: rapido,
    })
      .then(function(out) {
        console.log('[coletor] OK: ' + out.total + ' licitacoes aderentes')
        res.writeHead(200)
        res.end(JSON.stringify(out))
      })
      .catch(function(err) {
        console.error('[coletor] Erro:', err.message)
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message }))
      })
    return
  }

  if (parsed.pathname === '/api/pncp-arquivos') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var cnpjArquivo = String(parsed.query.cnpj || '').replace(/\D/g, '')
    var anoArquivo = String(parsed.query.ano || '').replace(/\D/g, '')
    var seqArquivo = String(parsed.query.seq || parsed.query.sequencial || '').replace(/\D/g, '')
    if (!cnpjArquivo || !anoArquivo || !seqArquivo) {
      res.writeHead(400)
      res.end(JSON.stringify({ ok: false, error: 'Parametros cnpj, ano e seq sao obrigatorios' }))
      return
    }
    fetchPncpDocuments({
      orgaoEntidade: { cnpj: cnpjArquivo },
      anoCompra: anoArquivo,
      sequencialCompra: seqArquivo,
    })
      .then(function(arquivos) {
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, arquivos: arquivos }))
      })
      .catch(function(err) {
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message || 'Erro ao buscar arquivos PNCP' }))
      })
    return
  }

  if (parsed.pathname === '/api/pncp-detalhe') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var cnpjDetalhe = String(parsed.query.cnpj || '').replace(/\D/g, '')
    var anoDetalhe = String(parsed.query.ano || '').replace(/\D/g, '')
    var seqDetalhe = String(parsed.query.seq || parsed.query.sequencial || '').replace(/\D/g, '')
    if (!cnpjDetalhe || !anoDetalhe || !seqDetalhe) {
      res.writeHead(400)
      res.end(JSON.stringify({ ok: false, error: 'Parametros cnpj, ano e seq sao obrigatorios' }))
      return
    }
    var compraRef = {
      orgaoEntidade: { cnpj: cnpjDetalhe },
      anoCompra: anoDetalhe,
      sequencialCompra: seqDetalhe,
    }
    Promise.all([
      fetchPncpCompraDetalhe(compraRef),
      fetchPncpItens(compraRef),
      fetchPncpDocuments(compraRef),
    ])
      .then(function(results) {
        var d = results[0]
        var itensDetalhe = Array.isArray(results[1]) ? results[1] : []
        var arquivosDetalhe = Array.isArray(results[2]) ? results[2] : []
        if (!d) {
          res.writeHead(502)
          res.end(JSON.stringify({ ok: false, error: 'PNCP nao retornou detalhe agora. Tente novamente em instantes.' }))
          return
        }
        var valorItens = itensDetalhe.reduce(function(acc, it) { return acc + (Number(it.valorTotal) || 0) }, 0)
        var criterioItem = itensDetalhe.map(function(it) { return it.criterioJulgamentoNome }).filter(Boolean)[0] || ''
        var itensResumo = itensDetalhe.slice(0, 12).map(function(it) {
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
        })
        var patch = {
          valor_estimado: brMoney(d.valorTotalEstimado || valorItens || d.valorTotalHomologado),
          valor_homologado: brMoney(d.valorTotalHomologado),
          plataforma: d.usuarioNome || '',
          fonte_origem: d.usuarioNome || '',
          amparo_legal: d.amparoLegal && (d.amparoLegal.nome || d.amparoLegal.descricao) || '',
          registro_preco: typeof d.srp === 'boolean' ? (d.srp ? 'Sim' : 'Não') : (d.srp || ''),
          orcamento_sigilo: d.orcamentoSigilosoDescricao || '',
          modo_disputa: d.modoDisputaNome || '',
          criterio_julgamento: d.criterioJulgamentoNome || criterioItem || d.modoDisputaNome || '',
          tipo_contrato: d.tipoInstrumentoConvocatorioNome || '',
          numero_processo: d.processo || d.numeroControlePNCP || '',
          link_sistema_origem: d.linkSistemaOrigem || '',
          arquivos: arquivosDetalhe,
          itens_pncp: itensResumo,
          total_itens_pncp: itensDetalhe.length,
          raw_data: d,
        }
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, detalhe: d, patch: patch }))
      })
      .catch(function(err) {
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message || 'Erro ao buscar detalhe PNCP' }))
      })
    return
  }

  if (parsed.pathname === '/api/scrape') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    var targetUrl = parsed.query.url
    if (!targetUrl) {
      res.writeHead(400)
      return res.end(JSON.stringify({ error: 'Parâmetro "url" é obrigatório' }))
    }

    console.log('[scrape] Buscando:', targetUrl)
    fetchAndParse(targetUrl)
      .then(function(data) {
        var nCampos = Object.keys(data).filter(function(k) {
          return data[k] && data[k] !== '' && data[k] !== 'não identificado automaticamente' && (!Array.isArray(data[k]) || data[k].length > 0)
        }).length
        console.log('[scrape] OK — ' + nCampos + ' campos extraídos, ' + (data.arquivos || []).length + ' arquivos')
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true, data: data }))
      })
      .catch(function(err) {
        console.error('[scrape] Erro:', err.message)
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, error: err.message }))
      })
    return
  }

  // ── /api/analyze-pdf?url=... ───────────────────────────────────────────────
  if (parsed.pathname === '/api/analyze-pdf') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    var fileUrl = parsed.query.url
    if (!fileUrl) {
      res.writeHead(400)
      return res.end(JSON.stringify({ ok: false, erro: 'Parâmetro "url" é obrigatório' }))
    }
    console.log('[analyze] Baixando:', fileUrl)
    downloadAndAnalyze(fileUrl)
      .then(function (out) {
        console.log('[analyze]', out.ok ? ('OK — ' + out.paginas + ' págs, ' + Object.keys(out.keywords||{}).length + ' kw') : ('FALHOU: ' + out.erro))
        res.writeHead(200)
        res.end(JSON.stringify(out))
      })
      .catch(function (err) {
        console.error('[analyze] Erro:', err.message)
        res.writeHead(500)
        res.end(JSON.stringify({ ok: false, erro: err.message }))
      })
    return
  }

  // ── /api/download?url=...&name=... ─────────────────────────────────────────
  // Proxy de download para conseguir resolver arquivo PNCP substituído/excluído.
  if (parsed.pathname === '/api/download') {
    var downloadUrl = parsed.query.url
    var downloadName = parsed.query.name || 'arquivo.pdf'
    if (!downloadUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Parametro "url" obrigatorio')
    }
    fetchBinary(downloadUrl)
      .then(function (bin) {
        var finalName = resolveDownloadName(downloadName, bin)
        res.writeHead(200, {
          'Content-Type': bin.contentType || 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="' + finalName + '"',
          'Content-Length': bin.buffer.length,
        })
        res.end(bin.buffer)
      })
      .catch(function (err) {
        res.writeHead(err.statusCode || 500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(err.message || 'Erro ao baixar arquivo')
      })
    return
  }

  // ── Arquivos estáticos ─────────────────────────────────────────────────────
  if (parsed.pathname.indexOf('/uploads/') === 0) {
    var relUpload = decodeURIComponent(parsed.pathname).replace(/^\/uploads\/?/, '')
    var uploadPath = path.normalize(path.join(UPLOADS_DIR, relUpload))
    if (uploadPath.indexOf(UPLOADS_DIR) !== 0 || !fs.existsSync(uploadPath) || fs.statSync(uploadPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Arquivo nao encontrado')
    }
    var uploadExt = path.extname(uploadPath).toLowerCase()
    var uploadType = MIME_TYPES[uploadExt] || 'application/octet-stream'
    fs.readFile(uploadPath, function(err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end('Arquivo nao encontrado')
      }
      var headers = { 'Content-Type': uploadType }
      if (parsed.query.download === '1') {
        headers['Content-Disposition'] = 'attachment; filename="' + path.basename(uploadPath).replace(/^\d+-/, '').replace(/"/g, '') + '"'
      }
      res.writeHead(200, headers)
      res.end(data)
    })
    return
  }

  var filePath = path.join(ROOT, parsed.pathname === '/' ? 'index.html' : parsed.pathname)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html')
  }

  var ext         = path.extname(filePath).toLowerCase()
  var contentType = MIME_TYPES[ext] || 'application/octet-stream'

  fs.readFile(filePath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Arquivo não encontrado')
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
})

const HOST = process.env.HOST || '0.0.0.0'

server.listen(PORT, HOST, function() {
  var serverUrl = 'http://localhost:' + PORT
  console.log('========================================')
  console.log('  Painel Fibratur — Licitações')
  console.log('  Acesse: ' + serverUrl)
  console.log('  Scraping: GET /api/scrape?url=URL')
  console.log('  Para encerrar: feche esta janela')
  console.log('========================================')
  if (!process.env.PORT && process.platform === 'win32') {
    require('child_process').exec('start ' + serverUrl)
  }
})
