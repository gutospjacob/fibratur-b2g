import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { fetchAndParse } = require('./scraper.cjs')
const { downloadAndAnalyze } = require('./analyzer.cjs')

// ─── PLUGIN VITE: adiciona /api/scrape ao servidor de desenvolvimento ─────────
function scraperPlugin() {
  return {
    name: 'fibratur-scraper',
    configureServer(server) {
      server.middlewares.use('/api/scrape', function (req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')

        var urlObj    = new URL(req.url, 'http://localhost')
        var targetUrl = urlObj.searchParams.get('url')
        if (!targetUrl) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'Parâmetro "url" é obrigatório' }))
        }

        console.log('[scraper] Buscando:', targetUrl)
        fetchAndParse(targetUrl)
          .then(function (data) {
            res.writeHead(200)
            res.end(JSON.stringify({ ok: true, data }))
          })
          .catch(function (err) {
            console.error('[scraper] Erro:', err.message)
            res.writeHead(500)
            res.end(JSON.stringify({ ok: false, error: err.message }))
          })
      })

      server.middlewares.use('/api/analyze-pdf', function (req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        var urlObj  = new URL(req.url, 'http://localhost')
        var fileUrl = urlObj.searchParams.get('url')
        if (!fileUrl) {
          res.writeHead(400)
          return res.end(JSON.stringify({ ok: false, erro: 'Parâmetro "url" é obrigatório' }))
        }
        console.log('[analyze] Baixando:', fileUrl)
        downloadAndAnalyze(fileUrl)
          .then(function (out) {
            res.writeHead(200)
            res.end(JSON.stringify(out))
          })
          .catch(function (err) {
            console.error('[analyze] Erro:', err.message)
            res.writeHead(500)
            res.end(JSON.stringify({ ok: false, erro: err.message }))
          })
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), scraperPlugin()],
  base: './',
  server: { port: 5173, open: true }
})
