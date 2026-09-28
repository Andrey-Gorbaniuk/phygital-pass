import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'

const encoder = new TextEncoder()

export function createParticipantToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function matchesSecret(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

export async function createOrganizerToken(username: string, secret: string): Promise<string> {
  return new SignJWT({ role: 'organizer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(encoder.encode(secret))
}

export async function verifyOrganizerToken(token: string, secret: string): Promise<boolean> {
  try {
    const verified = await jwtVerify(token, encoder.encode(secret))
    return verified.payload.role === 'organizer'
  } catch {
    return false
  }
}
