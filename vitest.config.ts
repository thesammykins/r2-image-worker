import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Bindings (including R2, vars, secrets) should be loaded from wrangler.toml
      },
    },
    // Increase timeout if needed for worker startup/R2 interactions
    // testTimeout: 30000,
  },
}); 