import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { listingIdFromUrl, normalizeListingUrl } from './parser.js'
import { hasDatabase, useSql } from './db.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const file = path.join(dir, 'store.json')
const SNAPSHOT_DAYS = 90

const empty = () => ({ sources: [], listings: [], snapshots: [] })

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

function mapSource(row) {
  return {
    id: row.id,
    url: row.url,
    category: row.category,
    createdAt: iso(row.created_at),
    lastParsedAt: iso(row.last_parsed_at),
    lastError: row.last_error ?? null,
    lastCount: Number(row.last_count) || 0,
  }
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
    areaM2: num(row.area_m2),
    priceByn: num(row.price_byn),
    image: row.image ?? null,
    active: Boolean(row.active),
    lastParsedAt: iso(row.last_parsed_at),
  }
}

function mapSnapshot(row) {
  return {
    listingId: row.listing_id,
    date: ymd(row.date),
    priceByn: num(row.price_byn),
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

async function addSourceSql(url, category) {
  const sql = useSql()
  const [existing] = await sql`select * from sources where url = ${url} and category = ${category}`
  if (existing) return mapSource(existing)
  const [row] = await sql`
    insert into sources (url, category) values (${url}, ${category}) returning *
  `
  return mapSource(row)
}

async function deleteSourceSql(id) {
  await useSql()`delete from sources where id = ${id}`
}

async function listListingsSql(category) {
  const sql = useSql()
  const rows = category
    ? await sql`select * from listings where active and category = ${category} order by price_byn asc nulls last`
    : await sql`select * from listings where active order by price_byn asc nulls last`
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

async function applyParseSql(sourceId, items, error) {
  const sql = useSql()
  return sql.begin(async (tx) => {
    const [source] = await tx`select * from sources where id = ${sourceId}`
    if (!source) return []

    const now = new Date()
    const date = today()
    await tx`
      update sources
      set last_parsed_at = ${now}, last_error = ${error || null}, last_count = ${items.length}
      where id = ${sourceId}
    `
    if (error) return []

    await tx`update listings set active = false where source_id = ${sourceId}`

    const upserted = []
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
        ;[listing] = await tx`select * from listings where external_id = ${externalId} limit 1`
      }
      if (!listing) {
        ;[listing] = await tx`select * from listings where url = ${url} limit 1`
      }

      if (!listing) {
        ;[listing] = await tx`
          insert into listings (
            source_id, external_id, url, category, title, rooms, area_m2, price_byn, image, active, last_parsed_at
          ) values (
            ${sourceId}, ${externalId}, ${url}, ${source.category}, ${title}, ${rooms}, ${areaM2}, ${priceByn}, ${image}, true, ${now}
          ) returning *
        `
      } else {
        ;[listing] = await tx`
          update listings set
            source_id = ${sourceId},
            external_id = ${externalId || listing.external_id},
            url = ${url},
            category = ${source.category},
            title = ${title},
            rooms = ${rooms ?? listing.rooms},
            area_m2 = ${areaM2 ?? listing.area_m2},
            price_byn = ${priceByn ?? listing.price_byn},
            image = ${image ?? listing.image},
            active = true,
            last_parsed_at = ${now}
          where id = ${listing.id}
          returning *
        `
      }

      await tx`
        insert into snapshots (listing_id, date, price_byn, rooms, area_m2, category)
        values (${listing.id}, ${date}, ${listing.price_byn}, ${listing.rooms}, ${listing.area_m2}, ${listing.category})
        on conflict (listing_id, date) do update set
          price_byn = excluded.price_byn,
          rooms = excluded.rooms,
          area_m2 = excluded.area_m2,
          category = excluded.category
      `
      upserted.push(mapListing(listing))
    }

    await tx`delete from snapshots where date < ${snapshotCutoff()}`
    return upserted
  })
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
  return category ? data.sources.filter((s) => s.category === category) : data.sources
}

function getSourceJson(id) {
  return loadJson().sources.find((s) => s.id === id) || null
}

function addSourceJson(url, category) {
  const data = loadJson()
  const existing = data.sources.find((s) => s.url === url && s.category === category)
  if (existing) return existing
  const source = {
    id: randomUUID(),
    url,
    category,
    createdAt: new Date().toISOString(),
    lastParsedAt: null,
    lastError: null,
    lastCount: 0,
  }
  data.sources.push(source)
  saveJson(data)
  return source
}

function deleteSourceJson(id) {
  const data = loadJson()
  const listingIds = new Set(data.listings.filter((l) => l.sourceId === id).map((l) => l.id))
  data.sources = data.sources.filter((s) => s.id !== id)
  data.listings = data.listings.filter((l) => l.sourceId !== id)
  data.snapshots = data.snapshots.filter((s) => !listingIds.has(s.listingId))
  saveJson(data)
}

function listListingsJson(category) {
  return loadJson()
    .listings.filter((l) => (!category || l.category === category) && l.active)
    .sort((a, b) => (a.priceByn ?? Infinity) - (b.priceByn ?? Infinity))
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

function applyParseJson(sourceId, items, error) {
  const data = loadJson()
  const source = data.sources.find((s) => s.id === sourceId)
  if (!source) return []

  const now = new Date().toISOString()
  const date = today()
  source.lastParsedAt = now
  source.lastError = error || null
  source.lastCount = items.length

  if (error) {
    saveJson(data)
    return []
  }

  for (const listing of data.listings.filter((l) => l.sourceId === sourceId)) {
    listing.active = false
  }

  const upserted = []
  for (const item of items) {
    if (!item.url) continue
    const url = normalizeListingUrl(item.url)
    const externalId = item.externalId || listingIdFromUrl(url)
    let listing =
      (externalId && data.listings.find((l) => l.externalId === externalId)) ||
      data.listings.find((l) => normalizeListingUrl(l.url) === url)
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
        lastParsedAt: now,
      }
      data.listings.push(listing)
    } else {
      listing.sourceId = sourceId
      listing.externalId = externalId || listing.externalId
      listing.url = url
      listing.category = source.category
      listing.title = item.title || listing.title
      listing.rooms = item.rooms ?? listing.rooms
      listing.areaM2 = item.areaM2 ?? listing.areaM2
      listing.priceByn = item.priceByn ?? listing.priceByn
      listing.image = item.image ?? listing.image
      listing.active = true
      listing.lastParsedAt = now
    }

    const snap = data.snapshots.find((s) => s.listingId === listing.id && s.date === date)
    const payload = {
      listingId: listing.id,
      date,
      priceByn: listing.priceByn,
      rooms: listing.rooms,
      areaM2: listing.areaM2,
      category: listing.category,
    }
    if (snap) Object.assign(snap, payload)
    else data.snapshots.push(payload)
    upserted.push(listing)
  }

  pruneJson(data)
  saveJson(data)
  return upserted
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

export async function addSource(url, category) {
  return hasDatabase() ? addSourceSql(url, category) : addSourceJson(url, category)
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

export async function applyParse(sourceId, items, error) {
  return hasDatabase() ? applyParseSql(sourceId, items, error) : applyParseJson(sourceId, items, error)
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
          id, source_id, external_id, url, category, title, rooms, area_m2, price_byn, image, active, last_parsed_at
        ) values (
          ${listing.id}, ${listing.sourceId}, ${listing.externalId}, ${listing.url}, ${listing.category},
          ${listing.title}, ${listing.rooms}, ${listing.areaM2}, ${listing.priceByn}, ${listing.image},
          ${listing.active}, ${listing.lastParsedAt}
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
        insert into snapshots (listing_id, date, price_byn, rooms, area_m2, category)
        values (${snap.listingId}, ${snap.date}, ${snap.priceByn}, ${snap.rooms}, ${snap.areaM2}, ${snap.category})
        on conflict (listing_id, date) do update set
          price_byn = excluded.price_byn,
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
