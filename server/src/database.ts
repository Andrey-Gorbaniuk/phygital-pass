import { Pool, type QueryResultRow } from 'pg'

export type Database = Pick<Pool, 'query'>

export function createDatabase(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  })
}

export async function queryOne<Row extends QueryResultRow>(database: Database, statement: string, values: unknown[] = []): Promise<Row | null> {
  const result = await database.query<Row>(statement, values)
  return result.rows[0] ?? null
}
