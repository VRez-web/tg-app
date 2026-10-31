import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cron from 'node-cron'
import { ensureSchema, hasDatabase, pingDb } from './db.js'
import {
  addSource,
  applyParse,
  deleteListing,
  deleteSource,
  getSource,
  importJsonFile,
  listListings,
  listSources,
} from './store.js'
import { parseSource } from './parser.js'
import { getRates, getUsdRate } from './rates.js'
import { buildStats, normalizePeriod } from './stats.js'

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

async function parseOne(source) {
  const { rate } = await getUsdRate().catch(() => ({ rate: null }))
  try {
    const items = await parseSource(source.url, rate, source.category)
    await applyParse(source.id, items, items.length ? null : 'Не удалось извлечь объявления')
    return { sourceId: source.id, count: items.length }
  } catch (error) {
    await applyParse(source.id, [], error.message)
    return { sourceId: source.id, count: 0, error: error.message }
  }
}

async function parseAll(category) {
  const sources = await listSources(category)
  const results = []
  for (const source of sources) {
    results.push(await parseOne(source))
  }
  return results
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
    const parsed = await parseOne(source)
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

app.delete('/api/listings/:id', async (req, res) => {
  await deleteListing(req.params.id)
  res.status(204).end()
})

app.post('/api/parse', async (req, res) => {
  const category = req.body?.category ? normalizeCategory(req.body.category) : undefined
  const results = await parseAll(category)
  res.json({ results })
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

cron.schedule(
  '0 20 * * *',
  () => {
    parseAll().catch((error) => console.error('daily parse failed', error))
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
    const imported = await importJsonFile()
    if (imported.imported) console.log('[import]', imported)
  } catch (error) {
    console.error('[db] init failed', error)
  }
})
