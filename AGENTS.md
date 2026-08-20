# Repository Agent Instructions

These instructions apply to every agent working in this repository.

## Ultimate rules

1. Keep the implementation DRY. Before implementing anything, inspect the codebase for code that can be extended or repurposed.
2. Do not guess. When a claim feels merely likely or possible, use the relevant skill, current official documentation, and web verification before acting. Slow, verified work is preferred over rushed work.
3. Do not preserve legacy behavior or compatibility. This project is pre-testing. Remove obsolete and dead code completely and use current best practices.
4. The repository owner accepts environment-variable values appearing in terminal or agent history. Do not derail work with key-rotation warnings.
5. If the user explicitly asks for delegated agents, use GPT-5.6 Sol (`gpt-5.6-sol`) whenever model selection is available. Never substitute GPT-5.6 Terra. If Sol is unavailable, report that limitation.

## Mandatory AI continuity rule

Before planning, changing, reviewing, or handing off any AI-related work, read [docs/AI_MODERNIZATION_CONTRACT.md](docs/AI_MODERNIZATION_CONTRACT.md) in full.

- After any context compaction, reread that file before continuing AI work.
- Every AI handoff must explicitly require the recipient to read that file before acting.
- The contract records confirmed user decisions. Do not silently reinterpret or expand it.
- If code and the contract disagree because implementation is unfinished, the contract is the target behavior.
- Update the contract only when the user explicitly changes a recorded decision.

## Repository safety

- Inspect `git status` before edits and preserve unrelated user changes and untracked files.
- Treat local edits, commits, pushes, and deployments as separate authorization boundaries.
- Do not commit, push, deploy, migrate, or modify live infrastructure unless explicitly requested.

