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
- Property dialog also exposes a **"待定"** (TBD) Switch — toggling it on disables the value input, marks the element with `unknown: true`, and renders its label as `Label = ?` on the canvas. Number inputs (value + gain) preserve an empty string as `undefined` instead of coercing to 0, so a cleared field stays cleared.
- All user mutations (placement, edit, delete, clear) flow through `commitElements`, which snapshots the previous state into a 50-deep `history` stack. The top toolbar "撤销" button pops the stack to restore the prior state. The delete toast also exposes a quick "撤销" action that re-adds the removed element. No-op saves (auto-opened property dialog where nothing changed) are filtered out so a single placement counts as one undo step.

### Reference-node inference & 待定 substitution
- When the user has placed no `ground` element, `inferReferenceNode(elements)` picks a virtual reference: (1) the negative terminal (`nodeTo`) of the DC voltage source whose end y is largest; (2) otherwise the union-find connected group with the most members, then the node with greatest y; (3) otherwise the first endpoint seen.
- `buildCircuitInput` remaps the inferred node id to `"0"` before sending to the server, so MNA / `validateCircuit` keep treating `"0"` as ground without any server change. The live status bar surfaces the reason (e.g. "已自动将 V1 的负极设为参考点").
- Elements marked `unknown: true` get a per-type placeholder (`placeholderForUnknown`: 1Ω / 1µF / 1mH / 1V / 1A / gain 1) substituted into the MNA input so the matrix factors. Their labels are collected as `unknownLabels` and sent on the analyze request as `unknownElements: string[]`.
- The system prompt appends a strong Chinese instruction telling the model to (a) keep `formula` strictly LaTeX-symbolic with the element labels as symbols, (b) end each `explanation` with a "代入占位值得到 …" line giving the numeric substitution, and (c) put a parameter-relation insight in `keyInsights`.
- When `unknownElements` is non-empty the analyze handler runs **only one AI attempt** and **soft-verifies** (mismatches are logged at info-level, never fail the request). It also returns `placeholderBased: true` and a placeholder-friendly `verificationNote`.
- The results page reads `placeholderBased`, applies an amber border + faded italic numbers to the 节点电压 / 支路电流 tables (with a "基于占位值" Badge in each header — testids `badge-placeholder-voltages` / `badge-placeholder-currents`), and shows an amber hint (`unknown-elements-hint`) above 解析 explaining that the symbolic 解析 is the final answer.

### AI analyze pipeline (`/api/ai/analyze`)
- The MNA solver is the source of truth (`artifacts/api-server/src/lib/mna-solver.ts`).
- The AI is asked to **independently** compute `computedAnswers` (node voltages + branch currents) — it is NOT given the MNA answer in the prompt.
- The server compares AI's numbers to MNA within **1% relative tolerance** (with an absolute floor of 1e-3) for both DC (scalar) and AC (complex magnitude) cases.
- On mismatch, the server retries up to **MAX_ATTEMPTS=3** with a compact, non-cumulative message list (system + base + concise mismatch summary). This keeps token cost flat across retries.
- Sign convention: branch currents are positive when flowing **nodeFrom → nodeTo**. The system prompt explicitly tells the AI this to avoid sign-mismatch false negatives.
- All AI numeric fields are coerced via `safeNum()` (Number.isFinite check, accepts numeric strings) so malformed model output produces a graceful "verification failed" rather than a 500.
- Response includes `verified` (boolean), `verificationAttempts` (1–3), and `verificationNote` (only when failed).
- Frontend shows a green "已校验 · N/3" badge when verified, an amber "未通过校验" badge + warning panel when failed. The MNA numerical answer is always displayed regardless of verification outcome.

### Numerical safety nets (pre-deploy hardening)
Two complementary warnings catch numerically risky inputs/outputs without ever blocking the user.

- **Safety Net A — client-side value-range advisory** (in `artifacts/circuit-solver/src/pages/solve.tsx`, `valueRangeWarning` memo). Checks the ratio of largest to smallest finite `|value|` across all non-wire/non-ground/non-`unknown` elements; if it exceeds `1e9` it shows a *gray* hint above the green/red `circuit-status` bar reading "元件数值跨度较大（约 10^N），结果可能存在浮点噪声…". Test id: `value-range-warning`. Designed to catch unit-mismatch bugs (e.g. user typed `1000000000` instead of `1k`).
- **Safety Net B — server-side condition-number warning** (in `artifacts/api-server/src/lib/mna-solver.ts`, `solveLinearSystem`). The MNA solver augments Gauss–Jordan elimination with the n×n identity to recover `A⁻¹` for free, then returns `conditionNumber = ‖A‖∞ × ‖A⁻¹‖∞` in the `CircuitSolution` (added to the OpenAPI schema). When `> 1e8`, the results page renders an amber/yellow warning panel ("数值警告：电路方程组接近奇异 …条件数估计 ≈ X.Xe+N") above the node/branch tables. Test id: `condition-warning`. Pivot-ratio is intentionally *not* used as the estimator since partial pivoting masks ill-conditioning (e.g. a R1=1, R2=1e12 divider has tiny pivot ratio but the matrix's true cond_∞ is still small enough not to fire — both are correct, the two safety nets are orthogonal).

The 10-test baseline accuracy script lives at `.local/accuracy-tests.mjs` and exercises 分压 / 分流 / 串并联 / VCVS / CCCS / 平衡电桥 / 戴维南 / RC低通 / RLC谐振 / 拓扑约束。 Run with `node .local/accuracy-tests.mjs`. Pre-deploy run: 10/10 passing.

### Math typesetting in 解析
- `step.formula` (treated as a complete LaTeX expression) and `summary` / `step.explanation` / `keyInsights` (mixed text containing `$$...$$`, `\(...\)`, or `\[...\]` segments) are rendered with KaTeX via `artifacts/circuit-solver/src/components/math-content.tsx`.
- The component is loaded via `React.lazy` so the ~265KB JS / ~29KB CSS chunk (plus KaTeX fonts) is split out of the main bundle and only fetched when the user opens the 结果 tab. Each `<MathContent>` usage in `solve.tsx` is wrapped in a `<Suspense>` whose fallback shows the original raw string.
- `formula` mode forces display-style; mixed mode preserves surrounding text via `whitespace-pre-wrap` so the original line breaks survive. Test ids: `math-formula` (display block), `math-inline` (inline span).
