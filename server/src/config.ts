import { z } from 'zod'

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  ORGANIZER_USERNAME: z.string().min(3),
  ORGANIZER_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_ORIGIN: z.string().url().optional(),
})

export type ServerConfig = z.infer<typeof environmentSchema>

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  return environmentSchema.parse(environment)
}
