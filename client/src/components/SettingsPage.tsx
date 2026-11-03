import { FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Source, SubTab } from '../types'

function formatWhen(iso: string | null) {
  if (!iso) return 'ещё не запускался'
  return new Date(iso).toLocaleString('ru-BY', {
    timeZone: 'Europe/Minsk',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeValue(source: Source) {
  return `${String(source.parseHour ?? 20).padStart(2, '0')}:${String(source.parseMinute ?? 0).padStart(2, '0')}`
}

function normalizeThreshold(raw: string) {
  if (!raw.trim()) return 200
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return 200
  return Math.round(n)
}

function ParserEditor({
  source,
  onSaved,
}: {
  source: Source
  onSaved: () => void
}) {
  const [name, setName] = useState(source.name)
  const [url, setUrl] = useState(source.url)
  const [priceThreshold, setPriceThreshold] = useState(String(source.priceThreshold ?? 200))
  const [parseTime, setParseTime] = useState(timeValue(source))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(source.name)
    setUrl(source.url)
    setPriceThreshold(String(source.priceThreshold ?? 200))
    setParseTime(timeValue(source))
    setError('')
  }, [source])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const [hour, minute] = parseTime.split(':')
      await api.updateSource(source.id, {
        name,
        url,
        priceThreshold: normalizeThreshold(priceThreshold),
        parseHour: Number(hour),
        parseMinute: Number(minute),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function onToggle() {
    setSaving(true)
    setError('')
    try {
      await api.updateSource(source.id, { active: !source.active })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="parser-form" onSubmit={onSubmit}>
      <label className="field-label">
        Имя
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field-label">
        Ссылка
        <input value={url} onChange={(e) => setUrl(e.target.value)} required inputMode="url" />
      </label>
      <label className="field-label">
        Порог обновления цены
        <input value={priceThreshold} onChange={(e) => setPriceThreshold(e.target.value)} inputMode="numeric" />
      </label>
      <label className="field-label">
        Время парсинга (Минск)
        <input type="time" value={parseTime} onChange={(e) => setParseTime(e.target.value || '20:00')} />
      </label>
      <p className="muted">Последний прогон: {formatWhen(source.lastParsedAt)}</p>
      {source.lastError && <p className="form-error">{source.lastError}</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onToggle} disabled={saving}>
          {source.active ? 'Отключить' : 'Включить'}
        </button>
      </div>
    </form>
  )
}

function ParserGroup({
  title,
  category,
  sources,
  openId,
  onToggle,
  onSaved,
}: {
  title: string
  category: SubTab
  sources: Source[]
  openId: string | null
  onToggle: (id: string) => void
  onSaved: () => void
}) {
  const rows = sources.filter((source) => source.category === category)
  return (
    <section className="settings-block">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Парсеров нет. Добавьте URL на вкладке Цены.</p>
      ) : (
        rows.map((source) => (
          <article key={source.id} className={`parser-card ${openId === source.id ? 'open' : ''}`}>
            <button type="button" className="parser-head" onClick={() => onToggle(source.id)}>
              <strong>
                {source.name}
                {!source.active ? ' · отключён' : ''}
              </strong>
              <span>{timeValue(source)}</span>
            </button>
            {openId === source.id && <ParserEditor source={source} onSaved={onSaved} />}
          </article>
        ))
      )}
    </section>
  )
}

export function SettingsPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (signal?: AbortSignal) => {
    const [apartments, other] = await Promise.all([api.sources('apartments', signal), api.sources('other', signal)])
    if (signal?.aborted) return
    setSources([...apartments, ...other])
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch((err) => {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить настройки')
    })
    return () => controller.abort()
  }, [load])

  return (
    <section className="settings-page">
      <p className="muted">
        У квартир и «Другое» свои парсеры. Можно править имя, ссылку, порог и время запуска. Отключение не удаляет
        объявления.
      </p>
      {error && <div className="form-error">{error}</div>}
      <ParserGroup
        title="Квартиры"
        category="apartments"
        sources={sources}
        openId={openId}
        onToggle={(id) => setOpenId((prev) => (prev === id ? null : id))}
        onSaved={() => load()}
      />
      <ParserGroup
        title="Другое"
        category="other"
        sources={sources}
        openId={openId}
        onToggle={(id) => setOpenId((prev) => (prev === id ? null : id))}
        onSaved={() => load()}
      />
    </section>
  )
}
