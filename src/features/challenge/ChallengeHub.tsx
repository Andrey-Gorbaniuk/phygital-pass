import { useEffect, useState } from 'react'
import { getChallenges, getLeaderboard, getStoredParticipant, submitChallengeResult, type Challenge, type Leaderboard, type SubmissionResult } from './api'

type Props = {
  onClose: () => void
}

export function ChallengeHub({ onClose }: Props) {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [selected, setSelected] = useState<Challenge | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getChallenges()
      .then((items) => {
        setChallenges(items)
        setSelected(items[0] ?? null)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить челленджи.'))
  }, [])

  useEffect(() => {
    if (!selected) return
    void getLeaderboard(selected.id)
      .then(setLeaderboard)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить лидерборд.'))
  }, [selected])

  return (
    <section className="challenge-screen screen-enter">
      <div className="challenge-header">
        <div><div className="eyebrow"><span className="pulse-dot" /> CAMPUS CHALLENGES</div><h1>Челленджи <em>движения</em></h1></div>
        <button className="text-button" type="button" onClick={onClose}>На главный экран</button>
      </div>
      {error && <p className="service-error">{error}</p>}
      {challenges.length === 0 && !error && <div className="empty-state"><strong>Пока нет активных челленджей</strong><p>Организатор опубликует правила и период участия здесь.</p></div>}
      {challenges.length > 0 && (
        <div className="challenge-layout">
          <aside className="challenge-selector">
            {challenges.map((challenge) => <button key={challenge.id} type="button" className={selected?.id === challenge.id ? 'selected-challenge' : ''} onClick={() => { setLeaderboard(null); setSelected(challenge) }}><span>АКТИВНЫЙ ЧЕЛЛЕНДЖ</span><strong>{challenge.title}</strong><small>до {formatDate(challenge.endsAt)}</small></button>)}
          </aside>
          <div className="leaderboard-card">
            <div className="leaderboard-head"><div><span>ПРОВЕРЕННЫЙ РЕЙТИНГ</span><h2>{selected?.title}</h2></div><small>{leaderboard ? `${leaderboard.leaderboard.length} участников` : 'Загрузка...'}</small></div>
            {selected?.description && <p className="challenge-description">{selected.description}</p>}
            <p className="verification-note">{leaderboard?.verificationNotice ?? 'Загружаем правила рейтинга...'}</p>
            <ol className="leaderboard-list">
              {leaderboard?.leaderboard.length ? leaderboard.leaderboard.map((entry) => <li key={`${entry.rank}-${entry.alias}`}><b>{entry.rank}</b><span><strong>{entry.alias}</strong>{entry.team && <small>{entry.team}</small>}</span><em>{entry.score}</em></li>) : <li className="leaderboard-empty"><span>Проверенных результатов пока нет.</span></li>}
            </ol>
            {Boolean(leaderboard?.teams.length) && <div className="team-ranking"><span>КОМАНДЫ</span>{leaderboard?.teams.map((team) => <p key={team.team}><b>{team.team}</b><small>{team.participants} участников</small><em>{team.score}</em></p>)}</div>}
          </div>
        </div>
      )}
    </section>
  )
}

export function ChallengeSubmission({ result }: { result: SubmissionResult }) {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [alias, setAlias] = useState(() => getStoredParticipant()?.alias ?? '')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getChallenges()
      .then((items) => {
        setChallenges(items.filter((challenge) => challenge.protocolVersion === 'squat-v1'))
        setSelectedId(items.find((challenge) => challenge.protocolVersion === 'squat-v1')?.id ?? '')
      })
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Сервис челленджей недоступен.'))
      .finally(() => setLoading(false))
  }, [])

  const submit = async () => {
    if (!selectedId || !alias.trim()) return
    setLoading(true)
    setMessage(null)
    try {
      const submitted = await submitChallengeResult(selectedId, alias.trim(), result)
      setMessage(`${submitted.notice} Итоговый балл: ${submitted.score}.`)
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось отправить результат.')
    } finally {
      setLoading(false)
    }
  }

  if (!loading && challenges.length === 0 && !message) return null

  return (
    <section className="submission-card">
      <div><span>УЧАСТИЕ В ЧЕЛЛЕНДЖЕ</span><h2>Отправить результат</h2><p>В рейтинг попадёт только результат, проверенный организатором. Видео не загружается.</p></div>
      {challenges.length > 1 && <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Выберите челлендж">{challenges.map((challenge) => <option value={challenge.id} key={challenge.id}>{challenge.title}</option>)}</select>}
      <label>Псевдоним<input value={alias} maxLength={24} onChange={(event) => setAlias(event.target.value)} placeholder="Например, Vector_7" /></label>
      <p className="consent-note">Продолжая, вы соглашаетесь на хранение псевдонима и результата. Удаление доступно через организатора.</p>
      <button className="secondary-button" type="button" disabled={loading || !selectedId || !alias.trim()} onClick={() => void submit()}>{loading ? 'Проверяем челлендж...' : 'Отправить на проверку'}</button>
      {message && <p className="submission-message">{message}</p>}
    </section>
  )
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'завершение неизвестно' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date).replace('.', '')
}
