---
name: typesafe-jev
description: Use the TypeSafe Jev MCP tool for focused, typed judgments such as classification, selection, and rubric scoring. Applies when an agent needs a structured semantic decision from supplied state.
---

# Use Jev for structured judgments

Use `jev_evaluate` when the task benefits from a typed semantic judgment and the agent needs a result it can branch on, compare, or rank. Use it when the user asks for Jev explicitly. The tool evaluates supplied state; it does not fetch source data, write explanations, or choose the agent's next action.

## Prepare the request

- Give Jev only the current evidence needed for the judgments. Preserve source, date, and uncertainty when they affect interpretation.
- Keep exact lookups, arithmetic, date comparisons, and other deterministic rules in code or a trusted source.
- Ask one narrow judgment per question. Use `noul` for a clearly defined yes/no statement, `choice` for one option from a closed set, and `score` for a rubric with 2–10 ordered levels.
- Define Choice options and Score levels so the model can tell similar options apart. Include an `other`, `none`, or `unknown` option when the supplied evidence may not support a listed answer.
- Send independent questions about the same state together. Questions in one request are evaluated independently; an answer does not become context for another question.
- If a later question depends on an earlier answer or on newly retrieved evidence, wait for that result and make a second request with the new state.

## Use the response

- Preserve the typed answer and its probabilities. Choice and Score also return confidence; Noul returns the probability of yes and has no separate confidence field.
- Compose answers in the host workflow. Keep missing evidence distinct from evidence for “no.” Route borderline or consequential cases to further checking, a stronger reasoning model, or the user.
- Treat probabilities and confidence as Jev's estimates for the requested judgment. They are not proof of factual truth and do not automatically mean the user will like, buy, or choose something.
- Do not ask Jev to generate prose or explanations. Let the host agent explain the result using the supplied evidence and returned judgments.
- Do not include API keys or unnecessary sensitive information in state. The MCP server sends state and questions to TypeSafe for evaluation.

Call `jev_evaluate` with `state` and a `questions` object whose entries contain `type` and `instructions`, plus `criteria` for Choice and Score. Omit `model` to use the tool's default `jev-latest`, or pass a supported model when a workflow explicitly pins one.

If the Jev tool is unavailable or the API key is not configured, say that the Jev call could not run. Do not present a host-model guess as a Jev result.

## References

- TypeSafe API: https://docs.typesafe.ai/api
- TypeSafe primitives: https://docs.typesafe.ai/primitives
- TypeSafe workflow design: https://docs.typesafe.ai/concepts/how-to-build-with-system-one
