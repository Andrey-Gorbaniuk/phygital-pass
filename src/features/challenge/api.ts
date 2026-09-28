import { SQUAT_PROTOCOL } from '../squat/protocol'

const PARTICIPANT_KEY = 'phygital-pass:participant'

export type Challenge = {
  id: string
  title: string
  description: string
  protocolVersion: string
  startsAt: string
  endsAt: string
}

export type LeaderboardEntry = {
  rank: number
  alias: string
  team: string | null
  score: number
  quality: number
  tempo: number
  repetitions: number
  attempts: number
}

export type Leaderboard = {
  challenge: Challenge
  leaderboard: LeaderboardEntry[]
  teams: Array<{ team: string; participants: number; score: number }>
  verificationNotice: string
}

export type SubmissionResult = {
  repetitions: number
  attempts: number
  quality: number
  tempo: number
  amplitude: 'Отличная' | 'Достаточная' | 'Нужна глубже'
  shallowRejected: number
  tooFastRejected: number
  trackingRejected: number
  completedAt: string
}

type StoredParticipant = { alias: string; token: string }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok || data === null) {
    const message = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : 'Сервис временно недоступен.'
    throw new Error(message)
  }
  return data as T
}

export async function getChallenges(): Promise<Challenge[]> {
  const data = await request<{ challenges: Challenge[] }>('/challenges')
  return data.challenges
}

export function getStoredParticipant(): StoredParticipant | null {
  try {
    const item = window.localStorage.getItem(PARTICIPANT_KEY)
    return item ? (JSON.parse(item) as StoredParticipant) : null
  } catch {
    return null
  }
}

async function createParticipant(alias: string): Promise<StoredParticipant> {
  const data = await request<{ participant: { alias: string }; token: string }>('/participants', {
    method: 'POST',
    body: JSON.stringify({ alias, consent: true }),
  })
  const participant = { alias: data.participant.alias, token: data.token }
  try {
    window.localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(participant))
  } catch {
    // Участие остаётся доступным в текущей сессии, даже если браузер не даёт запись.
  }
  return participant
}

export async function submitChallengeResult(challengeId: string, alias: string, result: SubmissionResult): Promise<{ score: number; notice: string }> {
  const participant = getStoredParticipant() ?? await createParticipant(alias)
  return request<{ score: number; notice: string }>(`/challenges/${challengeId}/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${participant.token}` },
    body: JSON.stringify({ ...result, protocolVersion: SQUAT_PROTOCOL.id }),
  })
}

export async function getLeaderboard(challengeId: string): Promise<Leaderboard> {
  return request<Leaderboard>(`/challenges/${challengeId}/leaderboard`)
}
