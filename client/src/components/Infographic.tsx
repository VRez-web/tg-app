import { useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import type { Stats, StatsPeriod, SubTab } from '../types'

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'days', label: 'Дни' },
  { id: 'weeks', label: 'Недели' },
  { id: 'months', label: 'Месяцы' },
  { id: 'years', label: 'Годы' },
]

function money(value: number | null | undefined, suffix = 'Br') {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} ${suffix}`
}

function rooms(value: number | null) {
  if (value == null) return ''
  if (value <= 0) return 'студия'
  return `${value}-комн.`
}

function List({ title, items }: { title: string; items: Stats['cheapest'] }) {
  if (!items.length) return null
  return (
    <div className="stat-block">
      <h4>{title}</h4>
      <ol className="stat-list">
        {items.map((item) => (
          <li key={item.id}>
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <span>
              {[rooms(item.rooms), item.areaM2 ? `${item.areaM2} м²` : null].filter(Boolean).join(' · ')}
            </span>
            <b>
              {money(item.priceByn)} / {money(item.priceUsd, '$')}
            </b>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function Infographic({ category, onClose }: { category: SubTab; onClose: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>('days')
  const [stats, setStats] = useState<Stats | null>(null)
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
      .stats(category, period)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось посчитать статистику'))
      .finally(() => setLoading(false))
  }, [category, period])

  const roomData = (stats?.byRooms || []).map((row) => ({
    name: row.label,
    byn: row.avgByn || 0,
  }))
  const historyData = (stats?.history || []).map((row) => ({
    date: row.date.length > 7 ? row.date.slice(5) : row.date,
    byn: row.avgByn || 0,
  }))

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h3>Инфографика</h3>
            <span>
              {stats
                ? `${stats.from} — ${stats.to} · ${stats.pricedCount} из ${stats.count} с ценой`
                : 'Текущий месяц'}
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

        {loading && <div className="muted">Считаем статистику…</div>}
        {error && <div className="form-error">{error}</div>}

        {stats && (
          <>
            <div className="stat-grid">
              <article>
                <small>Средняя стоимость</small>
                <strong>{money(stats.avgPriceByn)}</strong>
                <em>{money(stats.avgPriceUsd, '$')}</em>
              </article>
              {category === 'apartments' && (
                <article>
                  <small>Средняя за м²</small>
                  <strong>{money(stats.avgPricePerM2Byn)}</strong>
                  <em>{money(stats.avgPricePerM2Usd, '$')}</em>
                </article>
              )}
            </div>

            {category === 'apartments' && roomData.length > 0 && (
              <div className="stat-block">
                <h4>Средняя стоимость по комнатам</h4>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={roomData}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="name" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#8b9bb0" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'rgba(91,140,255,0.08)' }}
                        formatter={(value) => money(typeof value === 'number' ? value : Number(value))}
                      />
                      <Bar dataKey="byn" name="Br" fill="#5b8cff" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {historyData.length > 0 && (
              <div className="stat-block">
                <h4>{stats.historyTitle}</h4>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={historyData}>
                      <defs>
                        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6ee7c5" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#6ee7c5" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="date" stroke="#8b9bb0" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#8b9bb0" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => money(typeof value === 'number' ? value : Number(value))} />
                      <Area type="monotone" dataKey="byn" name="Br" stroke="#6ee7c5" fill="url(#priceFill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {category === 'apartments' && (
              <div className="modal-lists">
                <List title="3 самых дешёвых" items={stats.cheapest} />
                <List title="3 самых дорогих" items={stats.expensive} />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
