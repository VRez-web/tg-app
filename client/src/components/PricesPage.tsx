import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Listing, ParseChange, PricesView, Source, SubTab } from '../types'
import { AddParserModal } from './AddParserModal'
import { Infographic } from './Infographic'
import { ListingHistory } from './ListingHistory'
import { ParseHistory } from './ParseHistory'

function money(value: number | null) {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} Br`
}

function priceDelta(item: Listing) {
  if (item.priceByn == null || item.prevPriceByn == null || item.priceByn === item.prevPriceByn) return null
  return item.priceByn - item.prevPriceByn
}

function deltaText(diff: number) {
  const abs = Math.abs(diff).toLocaleString('ru-BY', { maximumFractionDigits: 0 })
  return `${diff > 0 ? '+' : '−'}${abs} Br`
}

function listingFromChange(change: ParseChange): Listing {
  return {
    id: change.listingId || change.id,
    sourceId: '',
    url: change.url,
    category: 'apartments',
    title: change.title || change.newTitle || change.oldTitle || 'Без адреса',
    rooms: change.newRooms ?? change.oldRooms,
    areaM2: change.newAreaM2 ?? change.oldAreaM2,
    priceByn: change.newPriceByn ?? change.oldPriceByn,
    image: null,
    active: change.action !== 'removed',
    firstSeenAt: '',
    lastParsedAt: '',
    priceChange: null,
    prevPriceByn: change.oldPriceByn,
  }
}

function meta(item: Listing) {
  const parts = []
  if (item.rooms != null) parts.push(item.rooms <= 0 ? 'студия' : `${item.rooms}-комн.`)
  if (item.areaM2 != null) parts.push(`${item.areaM2} м²`)
  return parts.join(' · ')
}

function ageLabel(iso: string | null | undefined) {
  if (!iso) return ''
  const day = (value: Date) =>
    value.toLocaleDateString('en-CA', { timeZone: 'Europe/Minsk' })
  const from = Date.parse(`${day(new Date(iso))}T00:00:00Z`)
  const to = Date.parse(`${day(new Date())}T00:00:00Z`)
  const days = Math.max(0, Math.round((to - from) / 86400000))
  if (days < 1) return 'сегодня'
  if (days < 30) return `${days}д`
  if (days < 365) return `${Math.floor(days / 30)}м`
  const years = Math.floor(days / 365)
  if (years === 1) return '1 год'
  if (years < 5) return `${years} года`
  return `${years} лет`
}

const PAGE_SIZE = 20
type SortKey = 'price-asc' | 'price-desc' | 'area-desc' | 'rooms-asc' | 'address'

function toNum(value: string) {
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && value.trim() !== '' ? n : null
}

export function PricesPage() {
  const [subTab, setSubTab] = useState<PricesView>('apartments')
  const [sources, setSources] = useState<Source[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [openListing, setOpenListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [roomsFilter, setRoomsFilter] = useState('all')
  const [priceFrom, setPriceFrom] = useState('')
  const [priceTo, setPriceTo] = useState('')
  const [areaFrom, setAreaFrom] = useState('')
  const [areaTo, setAreaTo] = useState('')
  const [sort, setSort] = useState<SortKey>('price-asc')
  const [page, setPage] = useState(1)

  const load = useCallback(async (nextCategory: SubTab, signal?: AbortSignal) => {
    const [nextSources, nextListings] = await Promise.all([
      api.sources(nextCategory, signal),
      api.listings(nextCategory, signal),
    ])
    if (signal?.aborted) return
    setSources(nextSources)
    setListings(nextListings)
    setReady(true)
  }, [])

  useEffect(() => {
    if (subTab === 'history') return
    const controller = new AbortController()
    setShowInfo(false)
    setError('')
    setPage(1)
    setRoomsFilter('all')
    setPriceFrom('')
    setPriceTo('')
    setAreaFrom('')
    setAreaTo('')
    setSort('price-asc')
    setReady(false)
    setLoading(true)
    setListings([])
    load(subTab, controller.signal)
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить')
        setReady(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [load, subTab])

  const filtered = useMemo(() => {
    const minPrice = toNum(priceFrom)
    const maxPrice = toNum(priceTo)
    const minArea = toNum(areaFrom)
    const maxArea = toNum(areaTo)
    const rows = listings.filter((item) => {
      if (roomsFilter !== 'all') {
        if (roomsFilter === '4+') {
          if (item.rooms == null || item.rooms < 4) return false
        } else if (item.rooms !== Number(roomsFilter)) return false
      }
      if (minPrice != null && (item.priceByn == null || item.priceByn < minPrice)) return false
      if (maxPrice != null && (item.priceByn == null || item.priceByn > maxPrice)) return false
      if (minArea != null && (item.areaM2 == null || item.areaM2 < minArea)) return false
      if (maxArea != null && (item.areaM2 == null || item.areaM2 > maxArea)) return false
      return true
    })
    rows.sort((a, b) => {
      if (sort === 'price-desc') return (b.priceByn ?? -1) - (a.priceByn ?? -1)
      if (sort === 'area-desc') return (b.areaM2 ?? -1) - (a.areaM2 ?? -1)
      if (sort === 'rooms-asc') return (a.rooms ?? 99) - (b.rooms ?? 99)
      if (sort === 'address') return a.title.localeCompare(b.title, 'ru')
      return (a.priceByn ?? Infinity) - (b.priceByn ?? Infinity)
    })
    return rows
  }, [listings, roomsFilter, priceFrom, priceTo, areaFrom, areaTo, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [roomsFilter, priceFrom, priceTo, areaFrom, areaTo, sort])

  async function onRefresh() {
    setLoading(true)
    setError('')
    try {
      if (subTab === 'history') return
      await api.parse(subTab)
      await load(subTab)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="prices-page">
      <div className="subtabs subtabs-3">
        <button
          className={`subtab ${subTab === 'apartments' ? 'active' : ''}`}
          onClick={() => setSubTab('apartments')}
        >
          Квартиры
        </button>
        <button className={`subtab ${subTab === 'other' ? 'active' : ''}`} onClick={() => setSubTab('other')}>
          Другое
        </button>
        <button className={`subtab ${subTab === 'history' ? 'active' : ''}`} onClick={() => setSubTab('history')}>
          История
        </button>
      </div>

      {subTab === 'history' ? (
        <ParseHistory onOpenListing={(change) => change.listingId && setOpenListing(listingFromChange(change))} />
      ) : null}

      {subTab !== 'history' && (
      <>
      {sources.some((source) => source.lastError) && (
        <div className="form-error">{sources.find((source) => source.lastError)?.lastError}</div>
      )}

      <div className="actions actions-3">
        <button type="button" className="btn" onClick={() => setShowAdd(true)} disabled={loading}>
          Добавить парсер
        </button>
        <button type="button" className="btn" onClick={() => setShowInfo(true)} disabled={loading}>
          Инфографика
        </button>
        <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
          Обновить
        </button>
      </div>
      <div className="list-meta">В базе: {listings.length}</div>

      {listings.length > 0 && (
        <div className="toolbar">
          {subTab === 'apartments' && (
            <select value={roomsFilter} onChange={(e) => setRoomsFilter(e.target.value)}>
              <option value="all">Все комнаты</option>
              <option value="1">1-комн.</option>
              <option value="2">2-комн.</option>
              <option value="3">3-комн.</option>
              <option value="4+">4+</option>
            </select>
          )}
          <input value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} placeholder="Цена от" inputMode="numeric" />
          <input value={priceTo} onChange={(e) => setPriceTo(e.target.value)} placeholder="Цена до" inputMode="numeric" />
          {subTab === 'apartments' && (
            <>
              <input value={areaFrom} onChange={(e) => setAreaFrom(e.target.value)} placeholder="м² от" inputMode="decimal" />
              <input value={areaTo} onChange={(e) => setAreaTo(e.target.value)} placeholder="м² до" inputMode="decimal" />
            </>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="price-asc">Сначала дешёвые</option>
            <option value="price-desc">Сначала дорогие</option>
            {subTab === 'apartments' && <option value="area-desc">Больше площадь</option>}
            {subTab === 'apartments' && <option value="rooms-asc">По комнатам</option>}
            <option value="address">По адресу</option>
          </select>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}
      {loading && <div className="muted">Загрузка…</div>}
      {showAdd && (
        <AddParserModal
          category={subTab as SubTab}
          onClose={() => setShowAdd(false)}
          onAdded={() => load(subTab as SubTab)}
        />
      )}
      {showInfo && <Infographic category={subTab as SubTab} onClose={() => setShowInfo(false)} />}

      {!ready ? null : listings.length === 0 ? (
        <div className="empty">Добавьте парсер</div>
      ) : filtered.length === 0 ? (
        <div className="empty">Нет объявлений по фильтрам</div>
      ) : (
        <>
          <div className="list-meta">
            Показано {filtered.length} · стр. {currentPage}/{pageCount}
          </div>
          {visible.map((item) => {
            const delta = priceDelta(item)
            return (
            <article key={item.id} className="listing-card listing-card-open" onClick={() => setOpenListing(item)}>
              <div className="info">
                <h4>{item.title}</h4>
                <p>{meta(item) || 'Параметры не распознаны'}</p>
                <span className="listing-age">{ageLabel(item.firstSeenAt || item.lastParsedAt)}</span>
              </div>
              <div className="price">
                <span>{money(item.priceByn)}</span>
                {delta != null && (
                  <span className={`price-delta ${delta > 0 ? 'price-up' : 'price-down'}`}>
                    {deltaText(delta)}
                  </span>
                )}
              </div>
            </article>
            )
          })}
          <div className="pager">
            <button type="button" className="btn btn-ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Назад
            </button>
            <span>
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Дальше
            </button>
          </div>
        </>
      )}
      </>
      )}
      {openListing && <ListingHistory listing={openListing} onClose={() => setOpenListing(null)} />}
    </section>
  )
}
