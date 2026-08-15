#!/usr/bin/env node
/** Test driver that sends one turn through the usage telemetry Loader composition. */

import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('usage telemetry driver requires a config path')

const ctx = await boot('usage-telemetry-loader', resolveConfigPath(configPath, undefined))
try {
  await runFixtureTurn(ctx, { task: 'measure one call' })
} finally {
  await ctx.fiber.dispose()
}
