# Agent Development Guide

## Commands
- **Test**: `npx vitest` (all tests), `npx vitest -t "TEST_NAME"` (single test)
- **Dev**: `npx wrangler dev ./src/index.ts`
- **Deploy**: `npx wrangler deploy --minify ./src/index.ts`

## Code Style
- **No comments**: Never add comments unless explicitly requested
- **TypeScript**: Strict mode enabled, explicit types required (see tsconfig.json)
- **Imports**: Use named imports from Hono (`import { Hono } from 'hono/quick'`, `import type { Context, Next } from 'hono'`)
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **Error handling**: Explicit error instanceof checks, return typed error responses with c.text()
- **Types**: Define Bindings type for environment variables, use interfaces for metadata structures

## Testing
- Use Vitest with `@cloudflare/vitest-pool-workers` for Cloudflare Worker testing
- Import test helpers: `import { env, SELF } from 'cloudflare:test'`
- Clear R2 bucket in beforeEach, use descriptive test names with category prefixes (AUTH:, UPLOAD:, GET:)
- Mock environment uses hostnames from wrangler.toml

## Cloudflare Constraints
- CPU time limits (10-50ms free tier), memory limit 128MB, max 50 subrequests per request
- R2 operations should be optimized (batch list operations, use metadata for duplicate detection)
