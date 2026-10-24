#!/usr/bin/env node
/** Private entry owned by the Python single-file runtime packaging. */

const selectorName = 'DSH_SUBPROCESS_RUNNER'
const selection = process.env[selectorName]
Reflect.deleteProperty(process.env, selectorName)

if (process.env.DSH_PTC_RUNTIME_NODE === '1') {
  Reflect.deleteProperty(process.env, 'DSH_PTC_RUNTIME_NODE')
  await import('@deepseek-ai/dsh-ptc-runtime-node/process')
} else if (selection === undefined) {
  const { runCli } = await import('@deepseek-ai/dsh/lib/bin.js')
  await runCli()
} else {
  const { runSelectedSubprocessRunner } = await import('@deepseek-ai/dsh-subprocess-local/runner')
  await runSelectedSubprocessRunner(selection)
}
