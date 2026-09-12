import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-mob',
  ['lib/types/index.js'],
  { hostPhase: true },
)
