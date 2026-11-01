import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { listingIdFromUrl, normalizeListingUrl } from './parser.js'
import { hasDatabase, useSql } from './db.js'

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
    firstSeenAt: iso(row.first_seen_at || row.firstSeenAt) || iso(row.last_parsed_at || row.lastParsedAt),
    lastParsedAt: iso(row.last_parsed_at || row.lastParsedAt),
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

async function applyParseSql(sourceId, items, error, runId) {
  const sql = useSql()
  const result = await sql.begin(async (tx) => {
    const [source] = await tx`select * from sources where id = ${sourceId}`
    if (!source) return { listings: [], changes: [], parsedCount: 0, error: error || null }

    const now = new Date()
    const date = today()
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
        const next = {
          title,
          rooms: rooms ?? listing.rooms,
          areaM2: areaM2 ?? listing.area_m2,
          priceByn: priceByn ?? listing.price_byn,
        }
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
        const mapped = mapListing(listing)
        if (!prev.active) changes.push(changeRow('added', mapped, prev, next))
        else if (listingChanged(prev, next)) changes.push(changeRow('updated', mapped, prev, next))
        seen.add(listing.id)
        upserted.push(mapped)
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
      await tx`
        insert into listing_history (listing_id, recorded_at, price_byn, rooms, area_m2, title)
        values (${listing.id}, ${now}, ${listing.price_byn}, ${listing.rooms}, ${listing.area_m2}, ${listing.title})
      `
    }

    for (const prev of before) {
      if (prev.active && !seen.has(prev.id)) {
        changes.push(changeRow('removed', mapListing(prev), prev, null))
      }
    }

    await tx`delete from snapshots where date < ${snapshotCutoff()}`
    return { listings: upserted, changes, parsedCount: items.length, error: null }
  })

  if (runId) {
    try {
      await appendParseRunSql(runId, result)
    } catch (err) {
      console.error('[parse-history] append failed', err)
    }
  }
  return result.listings
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

function applyParseJson(sourceId, items, error, runId) {
  const data = loadJson()
  if (!data.parseRuns) data.parseRuns = []
  if (!data.parseChanges) data.parseChanges = []
  const source = data.sources.find((s) => s.id === sourceId)
  if (!source) return []

  const now = new Date().toISOString()
  const date = today()
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
        firstSeenAt: now,
        lastParsedAt: now,
      }
      data.listings.push(listing)
      changes.push(changeRow('added', listing, null, listing))
    } else {
      const prev = beforeById.get(listing.id) || { ...listing }
      const next = {
        title: item.title || listing.title,
        rooms: item.rooms ?? listing.rooms,
        areaM2: item.areaM2 ?? listing.areaM2,
        priceByn: item.priceByn ?? listing.priceByn,
      }
      listing.sourceId = sourceId
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
      else if (listingChanged(prev, next)) changes.push(changeRow('updated', listing, prev, next))
    }

    seen.add(listing.id)
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
  saveJson(data)
}

async function finishParseRunSql(id, { error } = {}) {
  const sql = useSql()
  if (error) {
    await sql`update parse_runs set finished_at = now(), error = coalesce(error, ${error}) where id = ${id}`
    return
  }
  await sql`update parse_runs set finished_at = now() where id = ${id}`
}

export async function finishParseRun(id, payload) {
  return hasDatabase() ? finishParseRunSql(id, payload) : finishParseRunJson(id, payload)
}

function listParseRunsJson() {
  const data = loadJson()
  const runs = [...(data.parseRuns || [])].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  const changes = data.parseChanges || []
  return runs.slice(0, 30).map((run) =>
    mapParseRun(
      run,
      changes.filter((c) => c.runId === run.id).map(mapParseChange),
    ),
  )
}

async function listParseRunsSql() {
  const sql = useSql()
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
