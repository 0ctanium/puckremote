import { library } from '../../tsdown.shared.ts'

export default library(
  {
  "index": "src/index.ts",
  "runtime": "src/runtime.ts",
  "shims": "src/shims.ts",
  "constants": "src/constants.ts",
  "types": "src/types.ts",
  "host": "src/host.ts",
  "browser": "src/browser.ts",
  },
  { platform: 'neutral' },
)
