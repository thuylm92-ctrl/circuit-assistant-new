# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Circuit Solver Artifact

A Chinese-language mobile-first web app helping university students solve circuit-analysis problems.

### Key flows
- `/solve` opens with an upload gate (image → AI extracts problem text). User can also press "跳过，直接绘制电路" to skip.
- After dismissing the gate, an interactive tour walks the user through the canvas. The tour can be skipped via the X button on its overlay cards.
- Mobile-first bottom 4-tab nav: 题目 / 画布 / 结果 / 助教.
- Canvas uses an SVG grid; click two grid points to place an element. After placing a non-wire element, the property dialog auto-opens.
- Property dialog supports edit + **delete** (red destructive button + confirmation dialog + toast). The delete button is disabled while the tour-mode demo element (`demo-r1`) is active.
- All user mutations (placement, edit, delete, clear) flow through `commitElements`, which snapshots the previous state into a 50-deep `history` stack. The top toolbar "撤销" button pops the stack to restore the prior state. The delete toast also exposes a quick "撤销" action that re-adds the removed element. No-op saves (auto-opened property dialog where nothing changed) are filtered out so a single placement counts as one undo step.

### AI analyze pipeline (`/api/ai/analyze`)
- The MNA solver is the source of truth (`artifacts/api-server/src/lib/mna-solver.ts`).
- The AI is asked to **independently** compute `computedAnswers` (node voltages + branch currents) — it is NOT given the MNA answer in the prompt.
- The server compares AI's numbers to MNA within **1% relative tolerance** (with an absolute floor of 1e-3) for both DC (scalar) and AC (complex magnitude) cases.
- On mismatch, the server retries up to **MAX_ATTEMPTS=3** with a compact, non-cumulative message list (system + base + concise mismatch summary). This keeps token cost flat across retries.
- Sign convention: branch currents are positive when flowing **nodeFrom → nodeTo**. The system prompt explicitly tells the AI this to avoid sign-mismatch false negatives.
- All AI numeric fields are coerced via `safeNum()` (Number.isFinite check, accepts numeric strings) so malformed model output produces a graceful "verification failed" rather than a 500.
- Response includes `verified` (boolean), `verificationAttempts` (1–3), and `verificationNote` (only when failed).
- Frontend shows a green "已校验 · N/3" badge when verified, an amber "未通过校验" badge + warning panel when failed. The MNA numerical answer is always displayed regardless of verification outcome.
