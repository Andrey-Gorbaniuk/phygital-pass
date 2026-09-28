import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { readConfig } from './config.js'
import { createDatabase } from './database.js'

const config = readConfig()
const database = createDatabase(config.DATABASE_URL)
const app = createApp(database, config)

app.use('/assets/*', serveStatic({ root: './public' }))
app.use('/models/*', serveStatic({ root: './public' }))
app.use('/manifest.webmanifest', serveStatic({ root: './public' }))
app.use('/icon.svg', serveStatic({ root: './public' }))
app.use('/sw.js', serveStatic({ root: './public' }))
app.get('*', serveStatic({ root: './public', path: 'index.html' }))

serve({ fetch: app.fetch, port: config.PORT }, () => {
  console.info(`Phygital Pass listens on port ${config.PORT}`)
})
