// Instant Web Audio synthesized sound feedback
// Zero external files, zero latency, works offline and on mobile browsers

export type SoundKind = 'rep'

const MUTED_STORAGE_KEY = 'phygital-pass:sound-muted'

let audioCtx: AudioContext | null = null
let muted = false

// Read initial muted state from storage
if (typeof window !== 'undefined') {
  try {
    muted = window.localStorage.getItem(MUTED_STORAGE_KEY) === 'true'
  } catch {
    muted = false
  }
}

export function isSoundMuted(): boolean {
  return muted
}

export function setSoundMuted(value: boolean): void {
  muted = value
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, value ? 'true' : 'false')
    } catch {
      // ignore
    }
  }
}

export function toggleSoundMuted(): boolean {
  setSoundMuted(!muted)
  return muted
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        audioCtx = new AudioContextClass()
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }
    return audioCtx
  } catch {
    return null
  }
}

// Warm up AudioContext on user interaction
if (typeof window !== 'undefined') {
  const unlock = () => {
    getAudioContext()
    window.removeEventListener('click', unlock)
    window.removeEventListener('touchstart', unlock)
  }
  window.addEventListener('click', unlock, { passive: true })
  window.addEventListener('touchstart', unlock, { passive: true })
}

/**
 * Plays a pleasant, gentle chime on valid repetition completion.
 * Pure warm sine tone with soft attack and smooth decay.
 */
export function playSound(kind: SoundKind = 'rep'): void {
  if (muted || kind !== 'rep') return

  const ctx = getAudioContext()
  if (!ctx) return

  const now = ctx.currentTime

  // Gentle, warm bell chime (880 Hz with pleasant exponential fade)
  // Low comfortable gain (0.12) - quiet, satisfying, non-annoying
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, now)
  osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.05) // D6 subtle harmonic lift

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.13)
}
