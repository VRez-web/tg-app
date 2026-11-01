import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cron from 'node-cron'
import { ensureSchema, hasDatabase, pingDb } from './db.js'
import {
  addSource,
  applyParse,
  backfillParseRuns,
  deleteListing,
  deleteSource,
  finishParseRun,
  getSource,
  importJsonFile,
  listListings,
  listParseRuns,
  listSources,
  startParseRun,
} from './store.js'
import { parseSource } from './parser.js'
import { getRates, getUsdRate } from './rates.js'
import { buildListingDetail, buildStats, normalizePeriod } from './stats.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

function normalizeUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) throw new Error('Укажите URL')
  const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const url = new URL(withProto)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Некорректный URL')
  return url.href
}

function normalizeCategory(raw) {
  return raw === 'other' ? 'other' : 'apartments'
}

async function parseOne(source, runId) {
  const { rate } = await getUsdRate().catch(() => ({ rate: null }))
  try {
    const items = await parseSource(source.url, rate, source.category)
    await applyParse(source.id, items, items.length ? null : 'Не удалось извлечь объявления', runId)
    return { sourceId: source.id, count: items.length }
  } catch (error) {
    await applyParse(source.id, [], error.message, runId)
    return { sourceId: source.id, count: 0, error: error.message }
  }
}

async function parseAll(category, runId) {
  const sources = await listSources(category)
  const results = []
  for (const source of sources) {
    results.push(await parseOne(source, runId))
  }
  return results
}

async function withParseRun(trigger, category, work) {
  let run = null
  try {
    run = await startParseRun({ trigger, category })
  } catch (error) {
    console.error('[parse-history] start failed', error)
  }
  try {
    const result = await work(run?.id)
    if (run) {
      const error = Array.isArray(result)
        ? result.map((item) => item.error).filter(Boolean).join('; ') || null
        : result?.error || null
      await finishParseRun(run.id, { error }).catch((err) => console.error('[parse-history] finish failed', err))
    }
    return result
  } catch (error) {
    if (run) {
      await finishParseRun(run.id, { error: error.message }).catch((err) =>
        console.error('[parse-history] finish failed', err),
      )
    }
    throw error
  }
}

async function runParse({ trigger, category }) {
  const results = await withParseRun(trigger, category, (runId) => parseAll(category, runId))
  return { results }
}

app.get('/health', async (_req, res) => {
  try {
    const db = await pingDb()
    res.json({ status: 'ok', service: 'tg-mini-app-server', ...db })
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message })
  }
})

const KEEP_ALIVE_MS = 5 * 60 * 1000

function startKeepAlive() {
  const base = process.env.RENDER_EXTERNAL_URL
  if (!base) return
  const url = `${base.replace(/\/$/, '')}/health`
  setInterval(() => {
    fetch(url).catch((e) => console.warn('[keep-alive] ping failed', e))
  }, KEEP_ALIVE_MS)
}

app.get('/api/rates', async (_req, res) => {
  try {
    const rates = await getRates()
    res.json({ usd: rates.usd, eur: rates.eur, rub: rates.rub, date: rates.date, source: rates.source })
  } catch (error) {
    res.status(502).json({ error: error.message })
  }
})

app.get('/api/sources', async (req, res) => {
  res.json(await listSources(req.query.category))
})

app.post('/api/sources', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url)
    const category = normalizeCategory(req.body?.category)
    const source = await addSource(url, category)
    const parsed = await withParseRun('manual', category, (runId) => parseOne(source, runId))
    const listings = (await listListings(category)).filter((l) => l.sourceId === source.id)
    res.status(201).json({
      source: await getSource(source.id),
      parsed,
      listings,
    })
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.delete('/api/sources/:id', async (req, res) => {
  await deleteSource(req.params.id)
  res.status(204).end()
})

app.get('/api/listings', async (req, res) => {
  res.json(await listListings(req.query.category))
})

app.get('/api/listings/:id', async (req, res) => {
  try {
    const detail = await buildListingDetail(req.params.id, normalizePeriod(req.query.period))
    if (!detail) return res.status(404).json({ error: 'Объявление не найдено' })
    res.json(detail)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.delete('/api/listings/:id', async (req, res) => {
  await deleteListing(req.params.id)
  res.status(204).end()
})

app.post('/api/parse', async (req, res) => {
  const category = req.body?.category ? normalizeCategory(req.body.category) : undefined
  const { results } = await runParse({ trigger: 'manual', category })
  res.json({ results })
})

app.get('/api/parse-runs', async (_req, res) => {
  try {
    res.json(await listParseRuns())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/stats', async (req, res) => {
  try {
    const category = normalizeCategory(req.query.category)
    const period = normalizePeriod(req.query.period)
    const usd = await getUsdRate().catch(() => ({ rate: null }))
    res.json(await buildStats(category, usd.rate, period))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/news', (_req, res) => {
  res.json([])
})

const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next()
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

cron.schedule(
  '0 20 * * *',
  () => {
    console.log('[cron] daily parse started')
    runParse({ trigger: 'cron' })
      .then(({ results }) => console.log('[cron] daily parse done', results))
      .catch((error) => console.error('[cron] daily parse failed', error))
  },
  { timezone: 'Europe/Minsk' },
)

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)
  startKeepAlive()
  if (process.env.RENDER && !hasDatabase()) {
    console.error('На Render нужен DATABASE_URL, иначе данные пропадут')
    return
  }
  if (!hasDatabase()) return
  try {
    await ensureSchema()
    await backfillParseRuns().catch((error) => console.error('[parse-history] backfill failed', error))
    const imported = await importJsonFile()
    if (imported.imported) console.log('[import]', imported)
  } catch (error) {
    console.error('[db] init failed', error)
  }
})
