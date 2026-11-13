import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { listingIdFromUrl, normalizeListingUrl } from './parser.js'
import { hasDatabase, useSql } from './db.js'
import { bynToUsd, expandUsdRates, fetchNbrbUsdRates, shiftDate } from './rates.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const file = path.join(dir, 'store.json')
const SNAPSHOT_DAYS = 90

const empty = () => ({
  sources: [],
  listings: [],
  snapshots: [],
  parseRuns: [],
  parseChanges: [],
  listingHistory: [],
})

function loadJson() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return empty()
  }
}

function saveJson(data) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

function today() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function pruneJson(data) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - SNAPSHOT_DAYS)
  const min = cutoff.toISOString().slice(0, 10)
  data.snapshots = data.snapshots.filter((s) => s.date >= min)
}

function snapshotCutoff() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - SNAPSHOT_DAYS)
  return cutoff.toISOString().slice(0, 10)
}

function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function ymd(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function sameNum(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Number(a) === Number(b)
}

function sameText(a, b) {
  return String(a || '') === String(b || '')
}

function mapParseRun(row, changes = []) {
  return {
    id: row.id,
    startedAt: iso(row.started_at || row.startedAt),
    finishedAt: iso(row.finished_at || row.finishedAt),
    trigger: row.trigger,
    category: row.category || null,
    parsedCount: Number(row.parsed_count ?? row.parsedCount) || 0,
    addedCount: Number(row.added_count ?? row.addedCount) || 0,
    updatedCount: Number(row.updated_count ?? row.updatedCount) || 0,
    removedCount: Number(row.removed_count ?? row.removedCount) || 0,
    error: row.error ?? null,
    changes,
  }
}

function mapParseChange(row) {
  return {
    id: row.id,
    runId: row.run_id || row.runId,
    listingId: row.listing_id || row.listingId || null,
    action: row.action,
    title: row.title || row.new_title || row.newTitle || row.old_title || row.oldTitle || '',
    url: row.url || '',
    oldPriceByn: num(row.old_price_byn ?? row.oldPriceByn),
    newPriceByn: num(row.new_price_byn ?? row.newPriceByn),
    oldTitle: row.old_title ?? row.oldTitle ?? null,
    newTitle: row.new_title ?? row.newTitle ?? null,
    oldRooms: row.old_rooms ?? row.oldRooms ?? null,
    newRooms: row.new_rooms ?? row.newRooms ?? null,
    oldAreaM2: num(row.old_area_m2 ?? row.oldAreaM2),
    newAreaM2: num(row.new_area_m2 ?? row.newAreaM2),
  }
}

function listingChanged(prev, next) {
  return (
    !sameNum(prev.priceByn ?? prev.price_byn, next.priceByn) ||
    !sameText(prev.title, next.title) ||
    !sameNum(prev.rooms, next.rooms) ||
    !sameNum(prev.areaM2 ?? prev.area_m2, next.areaM2)
  )
}

function changeRow(action, listing, prev = null, next = null) {
  return {
    listingId: listing.id,
    action,
    title: (next && next.title) || listing.title || (prev && prev.title) || '',
    url: listing.url || '',
    oldPriceByn: prev ? num(prev.priceByn ?? prev.price_byn) : null,
    newPriceByn: next ? num(next.priceByn) : num(listing.priceByn ?? listing.price_byn),
    oldTitle: prev ? prev.title || null : null,
    newTitle: next ? next.title || null : listing.title || null,
    oldRooms: prev ? prev.rooms ?? null : null,
    newRooms: next ? next.rooms ?? null : listing.rooms ?? null,
    oldAreaM2: prev ? num(prev.areaM2 ?? prev.area_m2) : null,
    newAreaM2: next ? num(next.areaM2) : num(listing.areaM2 ?? listing.area_m2),
  }
}

function sourceNameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Парсер'
  }
}

function normalizeThreshold(raw) {
  if (raw == null || String(raw).trim() === '') return 200
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 200
  return Math.round(n)
}

function normalizeHour(raw, fallback = 20) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const hour = Math.round(n)
  return hour >= 0 && hour <= 23 ? hour : fallback
}

function normalizeMinute(raw, fallback = 0) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const minute = Math.round(n)
  return minute >= 0 && minute <= 59 ? minute : fallback
}

function isEmptyRun(row) {
  return (
    !(Number(row.parsed_count ?? row.parsedCount) || 0) &&
    !(Number(row.added_count ?? row.addedCount) || 0) &&
    !(Number(row.updated_count ?? row.updatedCount) || 0) &&
    !(Number(row.removed_count ?? row.removedCount) || 0) &&
    !row.error
  )
}

function belowPriceThreshold(oldPrice, newPrice, threshold) {
  const prev = num(oldPrice)
  const next = num(newPrice)
  if (prev == null || next == null) return false
  return Math.abs(next - prev) < normalizeThreshold(threshold)
}

function mapSource(row) {
  return {
    id: row.id,
    url: row.url,
    name: row.name || sourceNameFromUrl(row.url),
    category: row.category,
    priceThreshold: Number(row.price_threshold ?? row.priceThreshold) || 200,
    active: row.active !== false,
    parseHour: normalizeHour(row.parse_hour ?? row.parseHour, 20),
    parseMinute: normalizeMinute(row.parse_minute ?? row.parseMinute, 0),
    createdAt: iso(row.created_at || row.createdAt),
    lastParsedAt: iso(row.last_parsed_at || row.lastParsedAt),
    lastError: row.last_error ?? row.lastError ?? null,
    lastCount: Number(row.last_count ?? row.lastCount) || 0,
  }
}

function priceChange(current, previous) {
  const next = num(current)
  const prev = num(previous)
  if (next == null || prev == null || next === prev) return null
  return next > prev ? 'up' : 'down'
}

function mapListing(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id ?? null,
    url: row.url,
    category: row.category,
    title: row.title,
    rooms: row.rooms == null ? null : Number(row.rooms),
    areaM2: num(row.area_m2 ?? row.areaM2),
    priceByn: num(row.price_byn ?? row.priceByn),
    image: row.image ?? null,
    active: Boolean(row.active),
    firstSeenAt: iso(row.first_seen_at || row.firstSeenAt) || iso(row.last_parsed_at || row.lastParsedAt),
    lastParsedAt: iso(row.last_parsed_at || row.lastParsedAt),
    prevPriceByn: num(row.prev_price_byn ?? row.prevPriceByn),
    priceChange: row.priceChange || priceChange(row.price_byn ?? row.priceByn, row.prev_price_byn ?? row.prevPriceByn),
  }
}

function mapSnapshot(row) {
  return {
    listingId: row.listing_id,
    date: ymd(row.date),
    priceByn: num(row.price_byn),
    priceUsd: num(row.price_usd ?? row.priceUsd),
    rooms: row.rooms == null ? null : Number(row.rooms),
    areaM2: num(row.area_m2),
    category: row.category,
  }
}

async function listSourcesSql(category) {
  const sql = useSql()
  const rows = category
    ? await sql`select * from sources where category = ${category} order by created_at`
    : await sql`select * from sources order by created_at`
  return rows.map(mapSource)
}

async function getSourceSql(id) {
  const [row] = await useSql()`select * from sources where id = ${id}`
  return row ? mapSource(row) : null
}

async function addSourceSql(url, category, extras = {}) {
  const sql = useSql()
  const [existing] = await sql`select * from sources where url = ${url} and category = ${category}`
  if (existing) return mapSource(existing)
  const name = String(extras.name || '').trim() || sourceNameFromUrl(url)
  const priceThreshold = normalizeThreshold(extras.priceThreshold)
  const parseHour = normalizeHour(extras.parseHour, 20)
  const parseMinute = normalizeMinute(extras.parseMinute, 0)
  const [row] = await sql`
    insert into sources (url, category, name, price_threshold, parse_hour, parse_minute)
    values (${url}, ${category}, ${name}, ${priceThreshold}, ${parseHour}, ${parseMinute})
    returning *
  `
  return mapSource(row)
}

async function updateSourceSql(id, extras = {}) {
  const sql = useSql()
  const [current] = await sql`select * from sources where id = ${id}`
  if (!current) return null
  const url = extras.url != null ? String(extras.url).trim() : current.url
  if (!url) throw new Error('Укажите URL')
  if (url !== current.url) {
    const [dup] = await sql`select id from sources where url = ${url} and category = ${current.category} and id <> ${id}`
    if (dup) throw new Error('Такой URL уже есть в этой категории')
  }
  const name = extras.name != null ? String(extras.name).trim() || sourceNameFromUrl(url) : current.name
  const priceThreshold =
    extras.priceThreshold != null ? normalizeThreshold(extras.priceThreshold) : current.price_threshold
  const parseHour = extras.parseHour != null ? normalizeHour(extras.parseHour, current.parse_hour) : current.parse_hour
  const parseMinute =
    extras.parseMinute != null ? normalizeMinute(extras.parseMinute, current.parse_minute) : current.parse_minute
  const active = extras.active != null ? Boolean(extras.active) : current.active
  const [row] = await sql`
    update sources
    set url = ${url}, name = ${name}, price_threshold = ${priceThreshold},
        parse_hour = ${parseHour}, parse_minute = ${parseMinute}, active = ${active}
    where id = ${id}
    returning *
  `
  return mapSource(row)
}

async function deleteSourceSql(id) {
  const [row] = await useSql()`update sources set active = false where id = ${id} returning *`
  return row ? mapSource(row) : null
}

async function listListingsSql(category) {
  const sql = useSql()
  const rows = category
    ? await sql`
        with prev as (
          select listing_id, price_byn
          from (
            select listing_id, price_byn,
              row_number() over (partition by listing_id order by recorded_at desc) as rn
            from listing_history
          ) ranked
          where rn = 2
        )
        select l.*, p.price_byn as prev_price_byn
        from listings l
        left join prev p on p.listing_id = l.id
        where l.active and l.category = ${category}
        order by l.price_byn asc nulls last
      `
    : await sql`
        with prev as (
          select listing_id, price_byn
          from (
            select listing_id, price_byn,
              row_number() over (partition by listing_id order by recorded_at desc) as rn
            from listing_history
          ) ranked
          where rn = 2
        )
        select l.*, p.price_byn as prev_price_byn
        from listings l
        left join prev p on p.listing_id = l.id
        where l.active
        order by l.price_byn asc nulls last
      `
  return rows.map(mapListing)
}

async function listAllListingsSql(category) {
  const sql = useSql()
  const rows = category
    ? await sql`select * from listings where category = ${category}`
    : await sql`select * from listings`
  return rows.map(mapListing)
}

async function deleteListingSql(id) {
  await useSql()`delete from listings where id = ${id}`
}

async function applyParseSql(sourceId, items, error, runId) {
  const sql = useSql()
  const date = today()
  const usdRate = error ? null : await usdRateOn(date)
  const result = await sql.begin(async (tx) => {
    const [source] = await tx`select * from sources where id = ${sourceId}`
    if (!source) return { listings: [], changes: [], parsedCount: 0, error: error || null }

    const now = new Date()
    await tx`
      update sources
      set last_parsed_at = ${now}, last_error = ${error || null}, last_count = ${items.length}
      where id = ${sourceId}
    `
    if (error) return { listings: [], changes: [], parsedCount: items.length, error }

    const before = await tx`select * from listings where source_id = ${sourceId}`
    const beforeById = new Map(before.map((row) => [row.id, row]))
    await tx`update listings set active = false where source_id = ${sourceId}`

    const upserted = []
    const seen = new Set()
    const changes = []
    const historyPoints = []
    for (const item of items) {
      if (!item.url) continue
      const url = normalizeListingUrl(item.url)
      const externalId = item.externalId || listingIdFromUrl(url)
      const title = item.title || 'Адрес не указан'
      const rooms = item.rooms ?? null
      const areaM2 = item.areaM2 ?? null
      const priceByn = item.priceByn ?? null
      const image = item.image ?? null

      let listing = null
      if (externalId) {
        ;[listing] = await tx`
          select * from listings
          where external_id = ${externalId} and category = ${source.category}
          limit 1
        `
      }
      if (!listing) {
        ;[listing] = await tx`
          select * from listings
          where url = ${url} and category = ${source.category}
          limit 1
        `
      }

      if (!listing) {
        ;[listing] = await tx`
          insert into listings (
            source_id, external_id, url, category, title, rooms, area_m2, price_byn, image, active, first_seen_at, last_parsed_at
          ) values (
            ${sourceId}, ${externalId}, ${url}, ${source.category}, ${title}, ${rooms}, ${areaM2}, ${priceByn}, ${image}, true, ${now}, ${now}
          ) returning *
        `
        const mapped = mapListing(listing)
        changes.push(changeRow('added', mapped, null, mapped))
        seen.add(listing.id)
        upserted.push(mapped)
      } else {
        const prev = beforeById.get(listing.id) || listing
        const skipPrice = belowPriceThreshold(prev.price_byn ?? prev.priceByn, priceByn, source.price_threshold)
        const next = {
          title,
          rooms: rooms ?? listing.rooms,
          areaM2: areaM2 ?? listing.area_m2,
          priceByn: skipPrice ? num(prev.price_byn ?? prev.priceByn) : priceByn ?? listing.price_byn,
        }
        ;[listing] = await tx`
          update listings set
            source_id = ${listing.source_id},
            external_id = ${externalId || listing.external_id},
            url = ${url},
            category = ${source.category},
            title = ${title},
            rooms = ${rooms ?? listing.rooms},
            area_m2 = ${areaM2 ?? listing.area_m2},
            price_byn = ${next.priceByn},
            image = ${image ?? listing.image},
            active = true,
            last_parsed_at = ${now}
          where id = ${listing.id}
          returning *
        `
        const mapped = mapListing(listing)
        const recordHistory = !prev.active || (!skipPrice && listingChanged(prev, next))
        if (!prev.active) changes.push(changeRow('added', mapped, prev, next))
        else if (!skipPrice && listingChanged(prev, next)) changes.push(changeRow('updated', mapped, prev, next))
        seen.add(listing.id)
        upserted.push(mapped)
        if (recordHistory) {
          historyPoints.push({
            listingId: listing.id,
            recordedAt: now,
            priceByn: listing.price_byn,
            rooms: listing.rooms,
            areaM2: listing.area_m2,
            title: listing.title,
          })
        }
        await tx`
          insert into snapshots (listing_id, date, price_byn, price_usd, rooms, area_m2, category)
          values (${listing.id}, ${date}, ${listing.price_byn}, ${bynToUsd(listing.price_byn, usdRate)}, ${listing.rooms}, ${listing.area_m2}, ${listing.category})
          on conflict (listing_id, date) do update set
            price_byn = excluded.price_byn,
            price_usd = coalesce(excluded.price_usd, snapshots.price_usd),
            rooms = excluded.rooms,
            area_m2 = excluded.area_m2,
            category = excluded.category
        `
        continue
      }

      await tx`
        insert into snapshots (listing_id, date, price_byn, price_usd, rooms, area_m2, category)
        values (${listing.id}, ${date}, ${listing.price_byn}, ${bynToUsd(listing.price_byn, usdRate)}, ${listing.rooms}, ${listing.area_m2}, ${listing.category})
        on conflict (listing_id, date) do update set
          price_byn = excluded.price_byn,
          price_usd = coalesce(excluded.price_usd, snapshots.price_usd),
          rooms = excluded.rooms,
          area_m2 = excluded.area_m2,
          category = excluded.category
      `
      historyPoints.push({
        listingId: listing.id,
        recordedAt: now,
        priceByn: listing.price_byn,
        rooms: listing.rooms,
        areaM2: listing.area_m2,
        title: listing.title,
      })
    }

    for (const prev of before) {
      if (prev.active && !seen.has(prev.id)) {
        changes.push(changeRow('removed', mapListing(prev), prev, null))
      }
    }

    await tx`delete from snapshots where date < ${snapshotCutoff()}`
    return { listings: upserted, changes, historyPoints, parsedCount: items.length, error: null }
  })

  try {
    await appendListingHistorySql(result.historyPoints || [])
  } catch (err) {
    console.error('[listing-history] append failed', err)
  }
  if (runId) {
    try {
      await appendParseRunSql(runId, result)
    } catch (err) {
      console.error('[parse-history] append failed', err)
    }
  }
  return result.listings
}

async function appendListingHistorySql(points) {
  if (!points.length) return
  const sql = useSql()
  for (const point of points) {
    await sql`
      insert into listing_history (listing_id, recorded_at, price_byn, rooms, area_m2, title)
      values (
        ${point.listingId}, ${point.recordedAt}, ${point.priceByn},
        ${point.rooms}, ${point.areaM2}, ${point.title}
      )
    `
  }
}

async function listSnapshotsSql(category) {
  const sql = useSql()
  const rows = category
    ? await sql`select * from snapshots where category = ${category}`
    : await sql`select * from snapshots`
  return rows.map(mapSnapshot)
}

function listSourcesJson(category) {
  const data = loadJson()
  const rows = category ? data.sources.filter((s) => s.category === category) : data.sources
  return rows.map(mapSource)
}

function getSourceJson(id) {
  const row = loadJson().sources.find((s) => s.id === id)
  return row ? mapSource(row) : null
}

function addSourceJson(url, category, extras = {}) {
  const data = loadJson()
  const existing = data.sources.find((s) => s.url === url && s.category === category)
  if (existing) return mapSource(existing)
  const source = {
    id: randomUUID(),
    url,
    name: String(extras.name || '').trim() || sourceNameFromUrl(url),
    category,
    priceThreshold: normalizeThreshold(extras.priceThreshold),
    active: true,
    parseHour: normalizeHour(extras.parseHour, 20),
    parseMinute: normalizeMinute(extras.parseMinute, 0),
    createdAt: new Date().toISOString(),
    lastParsedAt: null,
    lastError: null,
    lastCount: 0,
  }
  data.sources.push(source)
  saveJson(data)
  return mapSource(source)
}

function updateSourceJson(id, extras = {}) {
  const data = loadJson()
  const current = data.sources.find((s) => s.id === id)
  if (!current) return null
  if (extras.url != null) {
    const url = String(extras.url).trim()
    if (!url) throw new Error('Укажите URL')
    const dup = data.sources.find((s) => s.url === url && s.category === current.category && s.id !== id)
    if (dup) throw new Error('Такой URL уже есть в этой категории')
    current.url = url
  }
  if (extras.name != null) current.name = String(extras.name).trim() || sourceNameFromUrl(current.url)
  if (extras.priceThreshold != null) current.priceThreshold = normalizeThreshold(extras.priceThreshold)
  if (extras.parseHour != null) current.parseHour = normalizeHour(extras.parseHour, current.parseHour)
  if (extras.parseMinute != null) current.parseMinute = normalizeMinute(extras.parseMinute, current.parseMinute)
  if (extras.active != null) current.active = Boolean(extras.active)
  saveJson(data)
  return mapSource(current)
}

function deleteSourceJson(id) {
  const data = loadJson()
  const current = data.sources.find((s) => s.id === id)
  if (!current) return null
  current.active = false
  saveJson(data)
  return mapSource(current)
}

function prevPriceFromHistory(data, listingId) {
  const points = (data.listingHistory || [])
    .filter((row) => row.listingId === listingId)
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))
  return points[1]?.priceByn ?? null
}

function listListingsJson(category) {
  const data = loadJson()
  return data.listings
    .filter((l) => (!category || l.category === category) && l.active)
    .sort((a, b) => (a.priceByn ?? Infinity) - (b.priceByn ?? Infinity))
    .map((listing) => mapListing({ ...listing, prevPriceByn: prevPriceFromHistory(data, listing.id) }))
}

function listAllListingsJson(category) {
  return loadJson().listings.filter((l) => !category || l.category === category)
}

function deleteListingJson(id) {
  const data = loadJson()
  data.listings = data.listings.filter((l) => l.id !== id)
  data.snapshots = data.snapshots.filter((s) => s.listingId !== id)
  saveJson(data)
}

async function applyParseJson(sourceId, items, error, runId) {
  const date = today()
  const usdRate = error ? null : await usdRateOn(date)
  const data = loadJson()
  if (!data.parseRuns) data.parseRuns = []
  if (!data.parseChanges) data.parseChanges = []
  const source = data.sources.find((s) => s.id === sourceId)
  if (!source) return []

  const now = new Date().toISOString()
  source.lastParsedAt = now
  source.lastError = error || null
  source.lastCount = items.length

  if (error) {
    appendParseRunJson(data, runId, { changes: [], parsedCount: items.length, error })
    saveJson(data)
    return []
  }

  const before = data.listings.filter((l) => l.sourceId === sourceId).map((l) => ({ ...l }))
  const beforeById = new Map(before.map((row) => [row.id, row]))
  for (const listing of data.listings.filter((l) => l.sourceId === sourceId)) {
    listing.active = false
  }

  const upserted = []
  const seen = new Set()
  const changes = []
  for (const item of items) {
    if (!item.url) continue
    const url = normalizeListingUrl(item.url)
    const externalId = item.externalId || listingIdFromUrl(url)
    let listing =
      (externalId &&
        data.listings.find((l) => l.externalId === externalId && l.category === source.category)) ||
      data.listings.find((l) => normalizeListingUrl(l.url) === url && l.category === source.category)
    if (!listing) {
      listing = {
        id: randomUUID(),
        sourceId,
        externalId,
        url,
        category: source.category,
        title: item.title || 'Адрес не указан',
        rooms: item.rooms ?? null,
        areaM2: item.areaM2 ?? null,
        priceByn: item.priceByn ?? null,
        image: item.image ?? null,
        active: true,
        firstSeenAt: now,
        lastParsedAt: now,
      }
      data.listings.push(listing)
      changes.push(changeRow('added', listing, null, listing))
    } else {
      const prev = beforeById.get(listing.id) || { ...listing }
      const skipPrice = belowPriceThreshold(prev.priceByn, item.priceByn, source.priceThreshold)
      const next = {
        title: item.title || listing.title,
        rooms: item.rooms ?? listing.rooms,
        areaM2: item.areaM2 ?? listing.areaM2,
        priceByn: skipPrice ? prev.priceByn : item.priceByn ?? listing.priceByn,
      }
      listing.sourceId = listing.sourceId || sourceId
      listing.externalId = externalId || listing.externalId
      listing.url = url
      listing.category = source.category
      listing.title = next.title
      listing.rooms = next.rooms
      listing.areaM2 = next.areaM2
      listing.priceByn = next.priceByn
      listing.image = item.image ?? listing.image
      listing.active = true
      listing.lastParsedAt = now
      if (!prev.active) changes.push(changeRow('added', listing, prev, next))
      else if (!skipPrice && listingChanged(prev, next)) changes.push(changeRow('updated', listing, prev, next))
      if (prev.active && skipPrice) {
        seen.add(listing.id)
        upserted.push(listing)
        const snap = data.snapshots.find((s) => s.listingId === listing.id && s.date === date)
        const payload = {
          listingId: listing.id,
          date,
          priceByn: listing.priceByn,
          priceUsd: bynToUsd(listing.priceByn, usdRate) ?? snap?.priceUsd ?? null,
          rooms: listing.rooms,
          areaM2: listing.areaM2,
          category: listing.category,
        }
        if (snap) Object.assign(snap, payload)
        else data.snapshots.push(payload)
        continue
      }
    }

    seen.add(listing.id)
    const snap = data.snapshots.find((s) => s.listingId === listing.id && s.date === date)
    const payload = {
      listingId: listing.id,
      date,
      priceByn: listing.priceByn,
      priceUsd: bynToUsd(listing.priceByn, usdRate) ?? snap?.priceUsd ?? null,
      rooms: listing.rooms,
      areaM2: listing.areaM2,
      category: listing.category,
    }
    if (snap) Object.assign(snap, payload)
    else data.snapshots.push(payload)
    if (!data.listingHistory) data.listingHistory = []
    data.listingHistory.push({
      id: randomUUID(),
      listingId: listing.id,
      recordedAt: now,
      priceByn: listing.priceByn,
      rooms: listing.rooms,
      areaM2: listing.areaM2,
      title: listing.title,
    })
    upserted.push(listing)
  }

  for (const prev of before) {
    if (prev.active && !seen.has(prev.id)) {
      changes.push(changeRow('removed', prev, prev, null))
    }
  }

  appendParseRunJson(data, runId, { changes, parsedCount: items.length, error: null })
  pruneJson(data)
  saveJson(data)
  return upserted
}

function appendParseRunJson(data, runId, { changes, parsedCount, error }) {
  if (!runId) return
  const run = data.parseRuns.find((row) => row.id === runId)
  if (!run) return
  run.parsedCount = (run.parsedCount || 0) + parsedCount
  run.addedCount = (run.addedCount || 0) + changes.filter((c) => c.action === 'added').length
  run.updatedCount = (run.updatedCount || 0) + changes.filter((c) => c.action === 'updated').length
  run.removedCount = (run.removedCount || 0) + changes.filter((c) => c.action === 'removed').length
  if (error) run.error = error
  for (const change of changes) {
    data.parseChanges.push({ id: randomUUID(), runId, ...change })
  }
}

function listSnapshotsJson(category) {
  return loadJson().snapshots.filter((s) => !category || s.category === category)
}

export async function listSources(category) {
  return hasDatabase() ? listSourcesSql(category) : listSourcesJson(category)
}

export async function getSource(id) {
  return hasDatabase() ? getSourceSql(id) : getSourceJson(id)
}

export async function addSource(url, category, extras = {}) {
  return hasDatabase() ? addSourceSql(url, category, extras) : addSourceJson(url, category, extras)
}

export async function updateSource(id, extras = {}) {
  return hasDatabase() ? updateSourceSql(id, extras) : updateSourceJson(id, extras)
}

export async function deleteSource(id) {
  return hasDatabase() ? deleteSourceSql(id) : deleteSourceJson(id)
}

export async function listListings(category) {
  return hasDatabase() ? listListingsSql(category) : listListingsJson(category)
}

export async function listAllListings(category) {
  return hasDatabase() ? listAllListingsSql(category) : listAllListingsJson(category)
}

export async function deleteListing(id) {
  return hasDatabase() ? deleteListingSql(id) : deleteListingJson(id)
}

export async function applyParse(sourceId, items, error, runId) {
  return hasDatabase()
    ? applyParseSql(sourceId, items, error, runId)
    : applyParseJson(sourceId, items, error, runId)
}

function mapHistoryPoint(row) {
  return {
    id: row.id,
    listingId: row.listing_id || row.listingId,
    recordedAt: iso(row.recorded_at || row.recordedAt),
    date: ymd(row.recorded_at || row.recordedAt || row.date),
    priceByn: num(row.price_byn ?? row.priceByn),
    rooms: row.rooms == null ? null : Number(row.rooms),
    areaM2: num(row.area_m2 ?? row.areaM2),
    title: row.title || null,
  }
}

async function getListingSql(id) {
  const [row] = await useSql()`select * from listings where id = ${id}`
  return row ? mapListing(row) : null
}

function getListingJson(id) {
  const listing = loadJson().listings.find((item) => item.id === id)
  return listing ? mapListing(listing) : null
}

export async function getListing(id) {
  return hasDatabase() ? getListingSql(id) : getListingJson(id)
}

async function listListingHistorySql(id) {
  const rows = await useSql()`
    select * from listing_history where listing_id = ${id} order by recorded_at asc
  `
  return rows.map(mapHistoryPoint)
}

function listListingHistoryJson(id) {
  return (loadJson().listingHistory || [])
    .filter((row) => row.listingId === id)
    .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)))
    .map(mapHistoryPoint)
}

export async function listListingHistory(id) {
  return hasDatabase() ? listListingHistorySql(id) : listListingHistoryJson(id)
}

async function listListingChangesSql(id) {
  const rows = await useSql()`
    select c.*, r.started_at
    from parse_changes c
    join parse_runs r on r.id = c.run_id
    where c.listing_id = ${id}
    order by r.started_at desc
  `
  return rows.map((row) => ({ ...mapParseChange(row), at: iso(row.started_at) }))
}

function listListingChangesJson(id) {
  const data = loadJson()
  const runs = new Map((data.parseRuns || []).map((run) => [run.id, run]))
  return (data.parseChanges || [])
    .filter((row) => row.listingId === id)
    .map((row) => ({
      ...mapParseChange(row),
      at: iso(runs.get(row.runId)?.startedAt),
    }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

export async function listListingChanges(id) {
  return hasDatabase() ? listListingChangesSql(id) : listListingChangesJson(id)
}

async function appendParseRunSql(runId, { changes, parsedCount, error }) {
  const sql = useSql()
  const added = changes.filter((c) => c.action === 'added').length
  const updated = changes.filter((c) => c.action === 'updated').length
  const removed = changes.filter((c) => c.action === 'removed').length
  await sql`
    update parse_runs set
      parsed_count = parsed_count + ${parsedCount},
      added_count = added_count + ${added},
      updated_count = updated_count + ${updated},
      removed_count = removed_count + ${removed},
      error = coalesce(error, ${error || null})
    where id = ${runId}
  `
  for (const change of changes) {
    await sql`
      insert into parse_changes (
        run_id, listing_id, action, title, url,
        old_price_byn, new_price_byn, old_title, new_title, old_rooms, new_rooms, old_area_m2, new_area_m2
      ) values (
        ${runId}, ${change.listingId}, ${change.action}, ${change.title}, ${change.url},
        ${change.oldPriceByn}, ${change.newPriceByn}, ${change.oldTitle}, ${change.newTitle},
        ${change.oldRooms}, ${change.newRooms}, ${change.oldAreaM2}, ${change.newAreaM2}
      )
    `
  }
}

function startParseRunJson({ trigger, category }) {
  const data = loadJson()
  if (!data.parseRuns) data.parseRuns = []
  const run = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trigger: trigger === 'cron' ? 'cron' : 'manual',
    category: category || null,
    parsedCount: 0,
    addedCount: 0,
    updatedCount: 0,
    removedCount: 0,
    error: null,
  }
  data.parseRuns.push(run)
  saveJson(data)
  return mapParseRun(run)
}

async function startParseRunSql({ trigger, category }) {
  const sql = useSql()
  const [row] = await sql`
    insert into parse_runs (trigger, category)
    values (${trigger === 'cron' ? 'cron' : 'manual'}, ${category || null})
    returning *
  `
  return mapParseRun(row)
}

export async function startParseRun(payload) {
  return hasDatabase() ? startParseRunSql(payload) : startParseRunJson(payload)
}

function finishParseRunJson(id, { error } = {}) {
  const data = loadJson()
  const run = (data.parseRuns || []).find((row) => row.id === id)
  if (!run) return
  run.finishedAt = new Date().toISOString()
  if (error) run.error = error
  if (isEmptyRun(run)) {
    data.parseRuns = data.parseRuns.filter((row) => row.id !== id)
    data.parseChanges = (data.parseChanges || []).filter((row) => row.runId !== id)
  }
  saveJson(data)
}

async function finishParseRunSql(id, { error } = {}) {
  const sql = useSql()
  const [row] = error
    ? await sql`update parse_runs set finished_at = now(), error = coalesce(error, ${error}) where id = ${id} returning *`
    : await sql`update parse_runs set finished_at = now() where id = ${id} returning *`
  if (row && isEmptyRun(row)) {
    await sql`delete from parse_runs where id = ${id}`
  }
}

export async function finishParseRun(id, payload) {
  return hasDatabase() ? finishParseRunSql(id, payload) : finishParseRunJson(id, payload)
}

function listParseRunsJson() {
  const data = loadJson()
  const runs = [...(data.parseRuns || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  const changes = data.parseChanges || []
  return runs
    .filter((run) => !isEmptyRun(run))
    .slice(0, 30)
    .map((run) => mapParseRun(run, changes.filter((c) => c.runId === run.id).map(mapParseChange)))
}

async function listParseRunsSql() {
  const sql = useSql()
  await sql`
    delete from parse_runs
    where parsed_count = 0 and added_count = 0 and updated_count = 0 and removed_count = 0
      and error is null
      and (finished_at is not null or started_at < now() - interval '2 minutes')
  `
  const runs = await sql`select * from parse_runs order by started_at desc limit 30`
  if (!runs.length) return []
  const ids = runs.map((row) => row.id)
  const changes = await sql`select * from parse_changes where run_id in ${sql(ids)} order by action, title`
  const byRun = new Map(ids.map((id) => [id, []]))
  for (const row of changes) {
    byRun.get(row.run_id)?.push(mapParseChange(row))
  }
  return runs.map((row) => mapParseRun(row, byRun.get(row.id) || []))
}

export async function listParseRuns() {
  return hasDatabase() ? listParseRunsSql() : listParseRunsJson()
}

export async function backfillParseRuns() {
  if (!hasDatabase()) return
  const sql = useSql()
  const [{ count }] = await sql`select count(*)::int as count from parse_runs`
  if (count > 0) return
  const sources = await sql`
    select last_parsed_at, last_count, last_error, category
    from sources
    where last_parsed_at is not null
    order by last_parsed_at desc
  `
  if (!sources.length) return
  const latest = sources[0]
  const parsed = sources.reduce((sum, row) => sum + (Number(row.last_count) || 0), 0)
  await sql`
    insert into parse_runs (started_at, finished_at, trigger, category, parsed_count, error)
    values (
      ${latest.last_parsed_at}, ${latest.last_parsed_at}, 'cron',
      ${sources.length === 1 ? latest.category : null}, ${parsed}, ${latest.last_error}
    )
  `
}

async function readFxRates(from, to) {
  if (!hasDatabase()) {
    const rows = loadJson().fxRates || []
    return new Map(
      rows
        .filter((row) => row.date >= from && row.date <= to)
        .map((row) => [row.date, Number(row.usdByn)]),
    )
  }
  const rows = await useSql()`
    select date::text as date, usd_byn
    from fx_rates
    where date >= ${from} and date <= ${to}
  `
  return new Map(rows.map((row) => [ymd(row.date), Number(row.usd_byn)]))
}

async function writeFxRates(rows) {
  if (!rows.length) return
  if (!hasDatabase()) {
    const data = loadJson()
    const map = new Map((data.fxRates || []).map((row) => [row.date, row.usdByn]))
    for (const row of rows) map.set(row.date, row.usdByn)
    data.fxRates = [...map.entries()]
      .map(([date, usdByn]) => ({ date, usdByn }))
      .sort((a, b) => a.date.localeCompare(b.date))
    saveJson(data)
    return
  }
  const sql = useSql()
  for (const row of rows) {
    await sql`
      insert into fx_rates (date, usd_byn)
      values (${row.date}, ${row.usdByn})
      on conflict (date) do update set usd_byn = excluded.usd_byn
    `
  }
}

async function ensureUsdRates(from, to) {
  const start = shiftDate(from, -14)
  const existing = await readFxRates(start, to)
  const covered = []
  for (let day = from; day <= to; day = shiftDate(day, 1)) covered.push(day)
  if (covered.length && covered.every((day) => existing.has(day))) return existing
  const known = [...existing.entries()].map(([date, usdByn]) => ({ date, usdByn }))
  let fetched = []
  try {
    fetched = await fetchNbrbUsdRates(start, to)
  } catch (error) {
    console.error('[fx] nbrb history failed', error.message)
  }
  const expanded = expandUsdRates([...known, ...fetched], from, to)
  const missing = expanded.filter((row) => existing.get(row.date) !== row.usdByn)
  if (missing.length) await writeFxRates(missing)
  const map = new Map(existing)
  for (const row of expanded) map.set(row.date, row.usdByn)
  return map
}

async function usdRateOn(date) {
  try {
    const map = await ensureUsdRates(date, date)
    return map.get(date) ?? null
  } catch (error) {
    console.error('[fx] rate lookup failed', error)
    return null
  }
}

export async function backfillSnapshotPrices() {
  if (!hasDatabase()) return backfillSnapshotPricesJson()
  const sql = useSql()
  const [bounds] = await sql`
    select min(date)::text as min, max(date)::text as max
    from snapshots
    where price_usd is null and price_byn is not null
  `
  if (!bounds?.min) return { updated: 0 }
  await ensureUsdRates(bounds.min, bounds.max)
  const updated = await sql`
    update snapshots s
    set price_usd = round(s.price_byn / f.usd_byn, 2)
    from fx_rates f
    where s.price_usd is null
      and s.price_byn is not null
      and f.date = s.date
      and f.usd_byn > 0
  `
  return { updated: updated.count }
}

async function backfillSnapshotPricesJson() {
  const data = loadJson()
  const pending = (data.snapshots || []).filter((snap) => snap.priceUsd == null && snap.priceByn != null)
  if (!pending.length) return { updated: 0 }
  const dates = pending.map((snap) => snap.date).sort()
  const map = await ensureUsdRates(dates[0], dates[dates.length - 1])
  const fresh = loadJson()
  let updated = 0
  for (const snap of fresh.snapshots || []) {
    if (snap.priceUsd != null || snap.priceByn == null) continue
    const usd = bynToUsd(snap.priceByn, map.get(snap.date))
    if (usd == null) continue
    snap.priceUsd = usd
    updated += 1
  }
  if (updated) saveJson(fresh)
  return { updated }
}

export async function listSnapshots(category) {
  return hasDatabase() ? listSnapshotsSql(category) : listSnapshotsJson(category)
}

export async function importJsonFile({ force = false } = {}) {
  if (!hasDatabase()) return { skipped: true, reason: 'no-database' }
  const data = loadJson()
  if (!data.sources.length) return { skipped: true, reason: 'no-json' }

  const sql = useSql()
  if (!force) {
    const [{ count }] = await sql`select count(*)::int as count from sources`
    if (count > 0) return { skipped: true, reason: 'not-empty', sources: count }
  }

  await sql.begin(async (tx) => {
    for (const source of data.sources) {
      await tx`
        insert into sources (id, url, category, created_at, last_parsed_at, last_error, last_count)
        values (
          ${source.id}, ${source.url}, ${source.category}, ${source.createdAt},
          ${source.lastParsedAt}, ${source.lastError}, ${source.lastCount || 0}
        )
        on conflict (id) do update set
          url = excluded.url,
          category = excluded.category,
          created_at = excluded.created_at,
          last_parsed_at = excluded.last_parsed_at,
          last_error = excluded.last_error,
          last_count = excluded.last_count
      `
    }

    for (const listing of data.listings) {
      await tx`
        insert into listings (
          id, source_id, external_id, url, category, title, rooms, area_m2, price_byn, image, active, first_seen_at, last_parsed_at
        ) values (
          ${listing.id}, ${listing.sourceId}, ${listing.externalId}, ${listing.url}, ${listing.category},
          ${listing.title}, ${listing.rooms}, ${listing.areaM2}, ${listing.priceByn}, ${listing.image},
          ${listing.active}, ${listing.firstSeenAt || listing.lastParsedAt}, ${listing.lastParsedAt}
        )
        on conflict (id) do update set
          source_id = excluded.source_id,
          external_id = excluded.external_id,
          url = excluded.url,
          category = excluded.category,
          title = excluded.title,
          rooms = excluded.rooms,
          area_m2 = excluded.area_m2,
          price_byn = excluded.price_byn,
          image = excluded.image,
          active = excluded.active,
          last_parsed_at = excluded.last_parsed_at
      `
    }

    for (const snap of data.snapshots) {
      await tx`
        insert into snapshots (listing_id, date, price_byn, price_usd, rooms, area_m2, category)
        values (${snap.listingId}, ${snap.date}, ${snap.priceByn}, ${snap.priceUsd ?? null}, ${snap.rooms}, ${snap.areaM2}, ${snap.category})
        on conflict (listing_id, date) do update set
          price_byn = excluded.price_byn,
          price_usd = coalesce(excluded.price_usd, snapshots.price_usd),
          rooms = excluded.rooms,
          area_m2 = excluded.area_m2,
          category = excluded.category
      `
    }
  })

  return {
    imported: true,
    sources: data.sources.length,
    listings: data.listings.length,
    snapshots: data.snapshots.length,
  }
}
