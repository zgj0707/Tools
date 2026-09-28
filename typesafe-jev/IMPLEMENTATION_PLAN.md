# TypeSafe Jev Integration Plan

## Objective

Expose Jev as a callable decision tool to agents in Codex and ChatGPT. Keep the integration task-agnostic; add game-screening or other task-specific Skills only after those workflows stabilize.

## Architecture

- A local MCP server exposes `jev_evaluate(state, questions, model?)`.
- The server validates the typed question shapes and forwards them to TypeSafe's `POST https://api.typesafe.ai/v1/systemone` endpoint.
- The TypeSafe API key stays in the Windows user environment as `TYPESAFE_API_KEY`; it is never embedded in plugin files, tool arguments, logs, or outputs.
- Codex launches the MCP server locally over stdio through the personal plugin.
- ChatGPT connects to the same local stdio server through OpenAI Secure MCP Tunnel. This avoids a public listener. It requires an OpenAI Platform control-plane credential and a tunnel registered to the ChatGPT workspace.
- The bundled `typesafe-jev` Skill tells agents when and how to use the tool. It keeps task-specific criteria out of the base integration.

## Tool contract

Input:

- `state`: source material and structured context for the judgments.
- `questions`: named Noul, Choice, and/or Score questions.
- `model`: optional TypeSafe model name; defaults to `jev-latest`.

Output:

- The actual TypeSafe model version, typed answers, probability distributions/confidence when provided, and usage counts.
- Errors are bounded and do not include the API key.

## Validation and rollout

1. Validate question schemas and TypeSafe error handling locally.
2. Verify the MCP tool contract with a local MCP client.
3. Make one live, minimal Jev request once `TYPESAFE_API_KEY` is available.
4. Install and verify the personal Codex plugin. A fresh Codex session may be needed to discover newly installed tools.
5. Register the same server in ChatGPT Developer Mode through Secure MCP Tunnel, then test a call from a new ChatGPT chat.

## Current external prerequisites

- TypeSafe API key: set by the user as the Windows user environment variable `TYPESAFE_API_KEY`.
- ChatGPT remote access: OpenAI Secure MCP Tunnel setup and the account's Developer Mode availability. The local bridge can be completed before those account-bound settings are available.

## Boundaries

- The MCP server evaluates questions only. It does not fetch Steam records, generate prose, select question policy for a task, or branch on the answers.
- Jev probabilities are returned as model outputs; they do not establish factual truth or a user's calibrated long-term preferences without domain validation.
- No task-specific game-screening Skill is included in this integration phase.
