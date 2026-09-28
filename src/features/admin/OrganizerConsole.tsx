import { useEffect, useState } from 'react'

const ADMIN_TOKEN_KEY = 'phygital-pass:organizer-session'

type Summary = { participants: number; pending: number; verified: number; average_score: number | null }
type Submission = { id: string; alias: string; challenge: string; score: number; quality: number; tempo: number; repetitions: number; attempts: number; shallowRejected: number; tooFastRejected: number; trackingRejected: number }
type Team = { id: string; name: string }
type Participant = { id: string; alias: string; teamId: string | null; team: string | null }

async function adminRequest<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options?.headers },
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const message = typeof payload === 'object' && payload !== null && 'error' in payload ? String(payload.error) : 'Сервис организатора недоступен.'
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

function currentDateTime(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function OrganizerConsole({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [challengeTitle, setChallengeTitle] = useState('Недельный челлендж приседаний')
  const [challengeDescription, setChallengeDescription] = useState('10 засчитанных приседаний по правилам теста.')
  const [startsAt, setStartsAt] = useState(() => currentDateTime(0))
  const [endsAt, setEndsAt] = useState(() => currentDateTime(7))
  const [teamName, setTeamName] = useState('')

  const refresh = async (sessionToken = token) => {
    if (!sessionToken) return
    try {
      const [nextSummary, nextSubmissions, nextTeams, nextParticipants] = await Promise.all([
        adminRequest<{ summary: Summary }>('/summary', sessionToken),
        adminRequest<{ submissions: Submission[] }>('/submissions?status=pending', sessionToken),
        adminRequest<{ teams: Team[] }>('/teams', sessionToken),
        adminRequest<{ participants: Participant[] }>('/participants', sessionToken),
      ])
      setSummary(nextSummary.summary)
      setSubmissions(nextSubmissions.submissions)
      setTeams(nextTeams.teams)
      setParticipants(nextParticipants.participants)
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось обновить кабинет.')
    }
  }

  useEffect(() => {
    if (!token) return
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  // refresh deliberately reads the current token only when the session changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const login = async () => {
    setMessage(null)
    const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok || typeof payload !== 'object' || payload === null || !('token' in payload)) {
      setMessage(typeof payload === 'object' && payload !== null && 'error' in payload ? String(payload.error) : 'Не удалось войти.')
      return
    }
    const sessionToken = String(payload.token)
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, sessionToken)
    setToken(sessionToken)
  }

  const review = async (submissionId: string, status: 'verified' | 'rejected') => {
    try {
      await adminRequest(`/submissions/${submissionId}`, token, { method: 'PATCH', body: JSON.stringify({ status }) })
      await refresh()
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось проверить результат.')
    }
  }

  const createChallenge = async () => {
    try {
      await adminRequest('/challenges', token, { method: 'POST', body: JSON.stringify({ title: challengeTitle, description: challengeDescription, protocolVersion: 'squat-v1', startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), publish: true }) })
      setMessage('Челлендж опубликован.')
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось создать челлендж.')
    }
  }

  const createTeam = async () => {
    if (!teamName.trim()) return
    try {
      await adminRequest('/teams', token, { method: 'POST', body: JSON.stringify({ name: teamName.trim() }) })
      setTeamName('')
      await refresh()
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось создать команду.')
    }
  }

  const assignTeam = async (participantId: string, teamId: string) => {
    try {
      await adminRequest(`/participants/${participantId}/team`, token, { method: 'PATCH', body: JSON.stringify({ teamId: teamId || null }) })
      await refresh()
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось назначить команду.')
    }
  }

  const deleteParticipant = async (participantId: string) => {
    try {
      await adminRequest(`/participants/${participantId}`, token, { method: 'DELETE' })
      await refresh()
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось удалить данные.')
    }
  }

  const downloadExport = async () => {
    try {
      const response = await fetch('/api/admin/export', { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Не удалось подготовить CSV.')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(await response.blob())
      link.download = 'phygital-pass-export.csv'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось выгрузить CSV.')
    }
  }

  if (!token) {
    return <section className="admin-screen screen-enter"><div className="admin-header"><div><div className="eyebrow"><span className="pulse-dot" /> ORGANIZER CONSOLE</div><h1>Кабинет <em>организатора</em></h1></div><button className="text-button" type="button" onClick={onClose}>На главный экран</button></div><div className="admin-login"><h2>Вход</h2><label>Логин<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label><label>Пароль<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label><button className="primary-button" type="button" onClick={() => void login()}><span>Открыть кабинет</span><b>→</b></button>{message && <p className="service-error">{message}</p>}</div></section>
  }

  return (
    <section className="admin-screen screen-enter">
      <div className="admin-header"><div><div className="eyebrow"><span className="pulse-dot" /> ORGANIZER CONSOLE</div><h1>Пилот <em>под контролем</em></h1></div><div className="admin-actions"><button className="text-button" type="button" onClick={() => void downloadExport()}>Скачать CSV</button><button className="text-button" type="button" onClick={() => { window.sessionStorage.removeItem(ADMIN_TOKEN_KEY); setToken('') }}>Выйти</button><button className="text-button" type="button" onClick={onClose}>На главный экран</button></div></div>
      {message && <p className="service-error">{message}</p>}
      <div className="admin-metrics"><Metric value={summary?.participants ?? '—'} label="участников" /><Metric value={summary?.pending ?? '—'} label="ожидают проверки" /><Metric value={summary?.verified ?? '—'} label="в рейтинге" /><Metric value={summary?.average_score ?? '—'} label="средний балл" /></div>
      <div className="admin-grid">
        <section className="admin-panel"><span>НОВЫЙ ЧЕЛЛЕНДЖ</span><h2>Опубликовать неделю</h2><label>Название<input value={challengeTitle} onChange={(event) => setChallengeTitle(event.target.value)} /></label><label>Описание<textarea value={challengeDescription} onChange={(event) => setChallengeDescription(event.target.value)} /></label><div className="form-grid"><label>Старт<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Завершение<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><p>Правила: <b>squat-v1</b>. Изменение порогов возможно только через новую версию протокола.</p><button className="secondary-button" type="button" onClick={() => void createChallenge()}>Опубликовать челлендж</button></section>
        <section className="admin-panel"><span>ПРАВИЛА ПИЛОТА</span><h2>Данные и честность</h2><ul><li>Видео никогда не загружается на сервер.</li><li>Участник использует псевдоним и может запросить удаление.</li><li>В рейтинг попадают только вручную подтверждённые результаты.</li><li>Каждый участник отправляет один результат на челлендж.</li></ul></section>
      </div>
      <section className="admin-panel pending-panel"><span>ПРОВЕРКА</span><h2>Результаты, ожидающие решения</h2>{submissions.length === 0 ? <p>Новых результатов нет.</p> : <div className="review-list">{submissions.map((submission) => <article key={submission.id}><div><strong>{submission.alias}</strong><small>{submission.challenge}</small><p>{submission.score} баллов · {submission.repetitions}/{submission.attempts} · качество {submission.quality}% · {submission.tempo} повторов/мин</p><p className="review-details">Незачёты: глубина {submission.shallowRejected}, темп {submission.tooFastRejected}, трекинг {submission.trackingRejected}</p></div><div><button type="button" className="verify-button" onClick={() => void review(submission.id, 'verified')}>Подтвердить</button><button type="button" className="reject-button" onClick={() => void review(submission.id, 'rejected')}>Отклонить</button></div></article>)}</div>}</section>
      <section className="admin-panel"><span>КОМАНДЫ И УДАЛЕНИЕ ДАННЫХ</span><h2>Участники пилота</h2><div className="team-create"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Название команды" /><button className="text-button" type="button" onClick={() => void createTeam()}>Добавить команду</button></div><div className="participant-list">{participants.map((participant) => <article key={participant.id}><strong>{participant.alias}</strong><select value={participant.teamId ?? ''} onChange={(event) => void assignTeam(participant.id, event.target.value)}><option value="">Без команды</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><button type="button" className="delete-button" onClick={() => void deleteParticipant(participant.id)}>Удалить данные</button></article>)}</div></section>
    </section>
  )
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}
