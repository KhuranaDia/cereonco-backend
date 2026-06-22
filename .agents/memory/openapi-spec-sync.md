---
name: openapi-spec.ts sync with openapi.yaml
description: How to keep the server's Swagger source (openapi-spec.ts) in sync with the OpenAPI contract after editing openapi.yaml
---

# Keeping openapi-spec.ts in sync with openapi.yaml

`artifacts/api-server/src/openapi-spec.ts` is an AUTO-GENERATED mirror of `lib/api-spec/openapi.yaml`, served at `/api/openapi.json` for Swagger UI. It is NOT produced by orval codegen — orval only generates `lib/api-zod` and the react client.

**Rule:** any edit to `openapi.yaml` must be followed by regenerating `openapi-spec.ts`, or Swagger drifts from the real contract.

**How to apply** — regenerate by parsing the YAML to JSON (run from `lib/api-spec/`):
```
node -e "const fs=require('fs'),yaml=require('yaml');const doc=yaml.parse(fs.readFileSync('openapi.yaml','utf8'));fs.writeFileSync('../../artifacts/api-server/src/openapi-spec.ts','// AUTO-GENERATED from lib/api-spec/openapi.yaml — do not edit by hand.\n// Regenerate by parsing the YAML (the contract is the single source of truth).\nexport const openApiSpec = '+JSON.stringify(doc,null,2)+';\n');"
```
**Why no `as const`:** the original export has no `as const`; adding it narrows types and can break `swaggerUi.setup(...)` consumers. Keep it a plain object literal.

Full post-yaml-edit sequence: edit `openapi.yaml` → regenerate `openapi-spec.ts` (above) → `pnpm --filter @workspace/api-spec run codegen` → reset `lib/api-zod/src/index.ts` to ONLY `export * from "./generated/api";` (the codegen barrel re-adds `./generated/types`, which collides → TS2308) → `pnpm run typecheck`.
