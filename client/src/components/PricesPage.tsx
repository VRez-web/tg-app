import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Listing, Source, SubTab } from '../types'
import { Infographic } from './Infographic'

function money(value: number | null) {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} Br`
}

function meta(item: Listing) {
  const parts = []
  if (item.rooms != null) parts.push(item.rooms <= 0 ? 'студия' : `${item.rooms}-комн.`)
  if (item.areaM2 != null) parts.push(`${item.areaM2} м²`)
  return parts.join(' · ')
}

const PAGE_SIZE = 20
type SortKey = 'price-asc' | 'price-desc' | 'area-desc' | 'rooms-asc' | 'address'

function toNum(value: string) {
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && value.trim() !== '' ? n : null
}

export function PricesPage() {
  const [subTab, setSubTab] = useState<SubTab>('apartments')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState<SubTab>('apartments')
  const [sources, setSources] = useState<Source[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [showInfo, setShowInfo] = useState(false)
  const [loading, setLoading] = useState(false)
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
  }, [])

  useEffect(() => {
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
    load(subTab, controller.signal).catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить')
    })
    return () => controller.abort()
  }, [load, subTab])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.addSource(url, category)
      setUrl('')
      if (category === subTab) await load(category)
      else setSubTab(category)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить')
    } finally {
      setLoading(false)
    }
  }

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
      <div className="subtabs">
        <button
          className={`subtab ${subTab === 'apartments' ? 'active' : ''}`}
          onClick={() => setSubTab('apartments')}
        >
          Квартиры
        </button>
        <button className={`subtab ${subTab === 'other' ? 'active' : ''}`} onClick={() => setSubTab('other')}>
          Другое
        </button>
      </div>

      <form className="add-form" onSubmit={onAdd}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Вставьте URL выборки"
          required
          inputMode="url"
        />
        <div className="add-form-row">
          <select value={category} onChange={(e) => setCategory(e.target.value as SubTab)}>
            <option value="apartments">Квартиры</option>
            <option value="other">Другое</option>
          </select>
          <button type="submit" className="btn" disabled={loading}>
            Добавить
          </button>
        </div>
      </form>

      {sources.some((source) => source.lastError) && (
        <div className="form-error">{sources.find((source) => source.lastError)?.lastError}</div>
      )}
      {sources.length > 0 && (
        <button
          type="button"
          className="btn btn-ghost source-remove"
          onClick={() =>
            Promise.all(sources.map((source) => api.deleteSource(source.id)))
              .then(() => load(subTab))
              .catch((err) => setError(err.message))
          }
        >
          Удалить выборку
        </button>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={() => setShowInfo(true)} disabled={loading}>
          Сформировать инфографику
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
      {showInfo && <Infographic category={subTab} onClose={() => setShowInfo(false)} />}

      {listings.length === 0 ? (
        <div className="empty">Добавьте URL выборки</div>
      ) : filtered.length === 0 ? (
        <div className="empty">Нет объявлений по фильтрам</div>
      ) : (
        <>
          <div className="list-meta">
            Показано {filtered.length} · стр. {currentPage}/{pageCount}
          </div>
          {visible.map((item) => (
            <article key={item.id} className="listing-card">
              <div className="info">
                <h4>{item.title}</h4>
                <p>{meta(item) || 'Параметры не распознаны'}</p>
                <div className="listing-actions">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Открыть
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      api.deleteListing(item.id).then(() => load(subTab)).catch((err) => setError(err.message))
                    }
                  >
                    Удалить
                  </button>
                </div>
              </div>
              <div className="price">{money(item.priceByn)}</div>
            </article>
          ))}
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
    </section>
  )
}
