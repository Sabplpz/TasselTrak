# Figma-alignment route tests

Runs the real route handlers in `app/api/**` against an in-process Postgres (PGlite), using the project's
schema, migrations 001-003 and a small seed that mirrors the Figma's "Nora Reyes" board.
Nothing here touches Neon, the network, or a real LLM (`llm-mock.ts` returns a canned plan; set
`MOCK_LLM=fail` to simulate a timeout).

Put this folder at `web/tests/figma-alignment/` (next to `app/`, `lib/`, `migrations/`), then:

    cd tests/figma-alignment && npm install && npm test

Keep it out of your Next build: it imports packages the app does not install. Add `"tests"` to the
`exclude` list in the app's `tsconfig.json`.

What is stand-in rather than yours:
- `sql/00_schema.sql` is the pasted schema cut at the point where the paste was truncated, without the
  pgvector extension/column.
- `sql/01_risk_and_stubs.sql` has migration 001 plus a `student_flags` table written from how the code uses it.
- `sql/04_seed.sql` ends with a simple `course_demand` view. Your real view was not visible.
