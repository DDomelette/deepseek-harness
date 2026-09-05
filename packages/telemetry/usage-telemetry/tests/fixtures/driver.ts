#!/usr/bin/env node
/** Run one session-attributed model stream through a real Loader composition. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('usage telemetry driver requires a config path')

const ctx = await boot('usage-telemetry-loader', resolveConfigPath(configPath, undefined))
try {
  const id = SessionId('usage-telemetry-loader-session')
  ctx.sessions.create(id, { meta: { cwd: process.cwd() } })
  for await (const chunk of ctx.llm.stream({
    sessionId: id, provider: 'usage-telemetry-mock', model: 'usage-telemetry-mock-model', messages: [],
  })) {
    if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
  }
} finally {
  await ctx.fiber.dispose()
}
