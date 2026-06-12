---
name: Dual OpenAPI specs in the api-server
description: There are two OpenAPI documents in this repo that drift apart; both must be updated together on any contract change.
---

This project has TWO independent OpenAPI documents:

1. `lib/api-spec/openapi.yaml` — the codegen source of truth. `pnpm --filter @workspace/api-spec run codegen` generates Zod schemas + client from it.
2. `artifacts/api-server/src/openapi-spec.ts` — a hand-maintained literal object that the `/api/docs` (Swagger UI) route serves directly via `/api/openapi.json`. It is NOT generated from the YAML.

**Why:** they are wired completely separately — codegen never touches `openapi-spec.ts`, and the docs route never reads the YAML. So a contract change made only in the YAML compiles, tests, and codegens fine while Swagger UI silently shows the OLD contract.

**How to apply:** whenever you change an endpoint's request/response/schema, edit BOTH files. After editing, verify the served spec with `curl -s localhost:80/api/openapi.json | jq` — do not trust the YAML alone to reflect what users see in Swagger.
