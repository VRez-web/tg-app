import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import type { Listing, ListingDetail, StatsPeriod } from '../types'

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'days', label: 'Дни' },
  { id: 'weeks', label: 'Недели' },
  { id: 'months', label: 'Месяцы' },
  { id: 'years', label: 'Годы' },
]

function money(value: number | null | undefined) {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} Br`
}

function formatAt(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleString('ru-BY', {
    timeZone: 'Europe/Minsk',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ListingHistory({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>('days')
  const [detail, setDetail] = useState<ListingDetail | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    setError('')
    api
      .listing(listing.id, period)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить историю'))
      .finally(() => setLoading(false))
  }, [listing.id, period])

  const current = detail?.listing || listing
  const chart = (detail?.history || []).map((row) => ({
    date: row.date.length > 7 ? row.date.slice(5) : row.date,
    byn: row.priceByn || 0,
  }))
  const points = [...(detail?.points || [])].reverse()

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h3>{current.title}</h3>
            <span>
              {money(current.priceByn)}
              {current.rooms != null ? ` · ${current.rooms <= 0 ? 'студия' : `${current.rooms}-комн.`}` : ''}
              {current.areaM2 != null ? ` · ${current.areaM2} м²` : ''}
            </span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="period-tabs">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`subtab ${period === item.id ? 'active' : ''}`}
              onClick={() => setPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading && <div className="muted">Загрузка…</div>}
        {error && <div className="form-error">{error}</div>}

        {detail && chart.length > 0 && (
          <div className="stat-block">
            <h4>{detail.historyTitle}</h4>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chart}>
                  <defs>
                    <linearGradient id="listingFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6ee7c5" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6ee7c5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="date" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b9bb0" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => money(typeof value === 'number' ? value : Number(value))} />
                  <Area type="monotone" dataKey="byn" name="Br" stroke="#6ee7c5" fill="url(#listingFill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="stat-block">
          <h4>История прогонов</h4>
          {points.length === 0 ? (
            <p className="muted">Точки появятся после следующих прогонов кроны</p>
          ) : (
            <ol className="stat-list">
              {points.map((point) => (
                <li key={`${point.at}-${point.date}-${point.priceByn}`}>
                  <span>{formatAt(point.at) || point.date}</span>
                  <b>{money(point.priceByn)}</b>
                </li>
              ))}
            </ol>
          )}
        </div>

        <a className="btn" href={current.url} target="_blank" rel="noreferrer">
          Открыть объявление
        </a>
      </section>
    </div>
  )
}
