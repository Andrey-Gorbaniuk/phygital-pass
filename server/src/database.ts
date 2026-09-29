import { Pool, type QueryResultRow } from 'pg'

export type Database = Pick<Pool, 'query'>

export function createDatabase(connectionString: string): Pool {
  const hostname = new URL(connectionString).hostname
  const isPrivateDatabase = hostname === 'database' || hostname === 'localhost' || hostname === '127.0.0.1'

  return new Pool({
    connectionString,
    max: 10,
    ssl: isPrivateDatabase ? false : { rejectUnauthorized: false },
  })
}

export async function queryOne<Row extends QueryResultRow>(database: Database, statement: string, values: unknown[] = []): Promise<Row | null> {
  const result = await database.query<Row>(statement, values)
  return result.rows[0] ?? null
}
