import { FormEvent, useState } from 'react'
import { api } from '../api'
import type { SubTab } from '../types'
import { Modal } from './Modal'

function normalizeThreshold(raw: string) {
  if (!raw.trim()) return 200
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return 200
  return Math.round(n)
}

function splitTime(value: string) {
  const [hour, minute] = value.split(':')
  return { parseHour: Number(hour), parseMinute: Number(minute) }
}

export function AddParserModal({
  category,
  onClose,
  onAdded,
}: {
  category: SubTab
  onClose: () => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [priceThreshold, setPriceThreshold] = useState('200')
  const [parseTime, setParseTime] = useState('20:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.addSource(url, category, {
        name,
        priceThreshold: normalizeThreshold(priceThreshold),
        ...splitTime(parseTime),
      })
      onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить парсер')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <header className="modal-head">
        <div>
          <h3>Добавить парсер</h3>
          <span>{category === 'apartments' ? 'Квартиры' : 'Другое'}</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <form className="add-form" onSubmit={onSubmit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" required />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL выборки" required inputMode="url" />
        <input
          value={priceThreshold}
          onChange={(e) => setPriceThreshold(e.target.value)}
          placeholder="Порог обновления цены"
          inputMode="numeric"
        />
        <label className="field-label">
          Время парсинга (Минск)
          <input type="time" value={parseTime} onChange={(e) => setParseTime(e.target.value || '20:00')} />
        </label>
        <p className="muted">
          Если цена изменилась меньше чем на порог, объявление и история не обновляются. По умолчанию 200 Br.
        </p>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Добавляем…' : 'Добавить'}
        </button>
      </form>
    </Modal>
  )
}
