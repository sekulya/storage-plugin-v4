# Storage

RFID warehouse: zones and shelves, RFID-tagged stock by piece, box or drum, counts and movements

An erxes plugin for the new core (Postgres). `api/` is the API: Express 5,
oRPC and Drizzle. `ui/` is the Module Federation remote web loads. Read the
`AGENTS.md` in the folder you edit. `api/src/modules/tags.ts` and
`ui/src/modules/tags` are the reference feature: copy their shape for a new one.
Zones, RFID tags, counts and movements replace 3.x's `storage_api`; booking movements in
accounting waits for 4.0's accounting plugin.

<!-- quality:start -->

## Quality

Every erxes repo on the new stack has this section, unchanged. The brackets name the checks that
enforce a rule; `review` marks the part no tool can check. The rewrite keeps every feature and improves the
architecture. Agents write the code and the checks judge it, so a green check lets a change ship
without line-by-line review.

- `vp run check` is the type check: oxfmt, type-aware oxlint on tsrs and knip in about 10 s. Run it after each edit and before each commit; it replaces `tsc`. `vp run fix` formats and autofixes. [vp run check]
- Port what a feature does, not its code. Fix what the old code got wrong instead of carrying it over. [review]
- Use a maintained library when one does the job. Keep dependencies near their latest release and off deprecated APIs. [typescript/no-deprecated, review]
- One way to do each job. Search for the existing helper before writing one, merge the repeats you find, delete what nothing uses. [knip, review]
- Types flow from the database schema to the contract to the UI. Infer them, so each shape is written once. [pnpm check:generated, review]
- API input, output and events are flat rows, as the table stores them: `referenceType` and `referenceId`, never a nested `{ type, id }` object or a `to…Dto` mapper. A value the row lacks comes from the query. [erxes/no-dto-mapper, review]
- Parse outside input with zod and narrow it, so the code needs no `any`, cast or `!`. [typescript/no-explicit-any, typescript/no-unsafe-type-assertion, typescript/no-non-null-assertion]
- Lint and type rules are the spec: when one fires, fix the code. Silencing it is never the fix, whether by a disable comment, `@ts-ignore`, an override, an ignore, a weaker option or a raised limit. A rule that is wrong changes in its own PR. [typescript/ban-ts-comment, review]
- Split a file or function that outgrows its limit by responsibility (router, service, queries). [max-lines, max-lines-per-function, review]
- Finish the work in the change, with no TODO or FIXME left in code. [no-warning-comments]
- Tests call the public interface (HTTP, the typed client, the rendered page) and assert what it does, never source strings or code shapes. [review]
- Every test runs: a skipped test or an empty suite fails the run. A failing test gets its code or its wrong expectation fixed, never loosened or deleted. [vp run test, review]
- Log through the structured logger, with the facts as fields. A caught error is rethrown or logged with its context. [no-console, review]
- Make the long-term change in one go, with no backward-compatibility shim, stopgap or speculative option. [review]
- Docs, PRs and copy are short: plain words, active voice, what it does or the number. [review]

<!-- quality:end -->

## This repo

- `vp run check` runs the escape guard, format, lint, types, React Doctor on `ui/`
  (`doctor.config.jsonc`), knip, the docs guard and `pnpm check:generated`, which
  compares the migrations with the schema. `pnpm exec react-doctor why <file:line>`,
  run in `ui/`, explains a React Doctor hit.
- Other gates: `vp run test` on real Postgres via `DATA_TEST_URL`,
  `pnpm check:rls`, `pnpm build`. `vp run fix` formats and fixes lint.
- Core finds the plugin by these names, so they stay fixed: plugin `storage`,
  remote `storage_ui` exposing `./config` and `./storage`, pages under `/storage/*`.
- Every table, index and constraint starts with `storage_`, and every table has
  `org_id` with forced row-level security, or is listed in `tools/no-org-id.sql`
  with the reason. Core and other plugins share the database. [pnpm check:rls]
- The lint rules are `@erxes/lint`'s preset (`vite.config.ts`). It,
  `tools/test/no-skips.ts` and `tools/check-rls.sql` come from core unchanged, as
  does the quality section above. Change them in core.
- The API reaches core through `@erxes/plugin-sdk` (`api/src/core.ts`), the UI
  through `@erxes/core-contract/client` with the member's session. Neither reads
  `core_*` tables or imports core's app code.
- Members are signed in by core: the UI sends a session token, the API checks it
  with `verifyPluginSession`; another plugin reading for an organisation sends a
  call token, checked with `verifyPluginCall`. The same procedures are REST at `/api/v1` for
  scripts, which get the token from core with an API key; `/api/openapi/member.json`
  documents them (`pluginOpenApi`), and core's Settings › Developer › API reference
  shows it. The assistant finds and calls those member routes as the member, with no
  step in between, so check the member's permission in every procedure. One that takes
  or returns a credential is never offered. Give a read `method: 'GET'`: after any other
  call web reads the page's data again. Routes for employees in the plugin's own app, customers or a website get
  their own document with that `audience`, listed in the manifest's `api.docs`. Renaming a procedure breaks those scripts. A caller outside erxes (a webhook) reaches a path
  the manifest's `publicPaths` lists through core, which names the organisation:
  check it with `verifyPublicCall` (`@erxes/plugin-sdk`'s overview has the route).
- Skills in `.agents/skills/`: `endpoint` for a procedure, `schema-change` for a
  table or column, `ui-patterns` for any page (lists, filters, forms, record
  details look like core's), `verify` before calling a change done.
- What core promises plugins, and what counts as a breaking change, is core's
  `plugin-contract` skill (erxes repo, branch `postgre`).
