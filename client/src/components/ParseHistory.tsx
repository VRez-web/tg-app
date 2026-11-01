import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ParseChange, ParseChangeAction, ParseRun } from '../types'

const ACTION_LABEL: Record<ParseChangeAction, string> = {
  added: 'Добавлено',
  updated: 'Обновлено',
  removed: 'Снято',
}

function money(value: number | null) {
  if (value == null) return '—'
  return `${value.toLocaleString('ru-BY', { maximumFractionDigits: 0 })} Br`
}

function formatRunTime(value: string) {
  return new Date(value).toLocaleString('ru-BY', {
    timeZone: 'Europe/Minsk',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function changeText(change: ParseChange) {
  if (change.action === 'updated') {
    const bits = []
    if (change.oldPriceByn !== change.newPriceByn) {
      bits.push(`${money(change.oldPriceByn)} → ${money(change.newPriceByn)}`)
    }
    if (change.oldTitle && change.newTitle && change.oldTitle !== change.newTitle) {
      bits.push(`${change.oldTitle} → ${change.newTitle}`)
    }
    if (change.oldRooms !== change.newRooms) {
      bits.push(`${change.oldRooms ?? '—'} → ${change.newRooms ?? '—'} комн.`)
    }
    if (change.oldAreaM2 !== change.newAreaM2) {
      bits.push(`${change.oldAreaM2 ?? '—'} → ${change.newAreaM2 ?? '—'} м²`)
    }
    return bits.join(' · ') || 'Изменились поля'
  }
  return money(change.action === 'removed' ? change.oldPriceByn : change.newPriceByn)
}

export function ParseHistory() {
  const [runs, setRuns] = useState<ParseRun[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    api
      .parseRuns(controller.signal)
      .then((next) => {
        setRuns(next)
        setOpenId(next[0]?.id || null)
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить историю')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  if (loading) return <div className="muted">Загрузка…</div>
  if (error) return <div className="form-error">{error}</div>
  if (!runs.length) return <div className="empty">История появится после ближайшего парсинга</div>

  return (
    <div className="history-list">
      {runs.map((run) => {
        const open = openId === run.id
        const groups: ParseChangeAction[] = ['added', 'updated', 'removed']
        return (
          <article key={run.id} className="history-run">
            <button type="button" className="history-run-head" onClick={() => setOpenId(open ? null : run.id)}>
              <div>
                <strong>{formatRunTime(run.startedAt)}</strong>
                <span>
                  {run.trigger === 'cron' ? 'Крон 20:00' : 'Вручную'}
                  {run.category === 'apartments' ? ' · квартиры' : run.category === 'other' ? ' · другое' : ''}
                </span>
              </div>
              <em>{open ? 'Скрыть' : 'Подробнее'}</em>
            </button>
            <div className="history-stats">
              <span>Спарсено {run.parsedCount}</span>
              <span className="ok">+{run.addedCount}</span>
              <span className="upd">~{run.updatedCount}</span>
              <span className="del">−{run.removedCount}</span>
            </div>
            {run.error && <div className="form-error">{run.error}</div>}
            {!run.changes.length && (
              <p className="muted">
                {run.addedCount + run.updatedCount + run.removedCount === 0
                  ? 'Состав выборки не изменился, либо прогон записан без детализации.'
                  : 'Детализация изменений появится со следующих прогонов.'}
              </p>
            )}
            {open &&
              groups.map((action) => {
                const items = run.changes.filter((change) => change.action === action)
                if (!items.length) return null
                return (
                  <div key={action} className="history-group">
                    <h4>
                      {ACTION_LABEL[action]} · {items.length}
                    </h4>
                    {items.slice(0, 40).map((change) => (
                      <div key={change.id} className={`history-item ${action}`}>
                        <div>
                          <b>{change.title || 'Без адреса'}</b>
                          <p>{changeText(change)}</p>
                        </div>
                        {change.url && (
                          <a href={change.url} target="_blank" rel="noreferrer">
                            Открыть
                          </a>
                        )}
                      </div>
                    ))}
                    {items.length > 40 && <p className="muted">Ещё {items.length - 40}</p>}
                  </div>
                )
              })}
          </article>
        )
      })}
    </div>
  )
}
