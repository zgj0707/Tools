"""MCP stdio adapter for the TypeSafe Jev System One API."""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from mcp.server.fastmcp import FastMCP


API_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-latest"
REQUEST_TIMEOUT_SECONDS = 60
MAX_RETRIES = 2
MAX_ERROR_BODY_CHARS = 1000

mcp = FastMCP("typesafe-jev")


def _is_json_value(value: Any) -> bool:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return False
    return True


def _validate_question(question_id: str, question: Any) -> None:
    if not isinstance(question_id, str) or not question_id.strip():
        raise ValueError("Question IDs must be non-empty strings.")
    if not isinstance(question, dict):
        raise ValueError(f"Question {question_id!r} must be an object.")

    question_type = question.get("type")
    if question_type not in {"noul", "choice", "score"}:
        raise ValueError(
            f"Question {question_id!r} has unsupported type; use noul, choice, or score."
        )

    if "instructions" not in question or not _is_json_value(question["instructions"]):
        raise ValueError(
            f"Question {question_id!r} needs JSON-compatible instructions."
        )

    criteria = question.get("criteria")
    if question_type == "choice":
        if not isinstance(criteria, dict) or not 1 <= len(criteria) <= 255:
            raise ValueError(
                f"Choice question {question_id!r} needs 1 to 255 criteria options."
            )
    elif question_type == "score":
        if not isinstance(criteria, list) or not 2 <= len(criteria) <= 10:
            raise ValueError(
                f"Score question {question_id!r} needs 2 to 10 ordered criteria levels."
            )
    elif criteria is not None and not isinstance(criteria, dict):
        raise ValueError(
            f"Noul question {question_id!r} criteria must be an object when supplied."
        )

    if criteria is not None and not _is_json_value(criteria):
        raise ValueError(f"Question {question_id!r} criteria must be JSON-compatible.")


def validate_request(state: Any, questions: Any, model: str | None) -> dict[str, Any]:
    if not _is_json_value(state):
        raise ValueError("state must be JSON-compatible.")
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions must be a non-empty object keyed by question ID.")
    if not _is_json_value(questions):
        raise ValueError("questions must be JSON-compatible.")

    for question_id, question in questions.items():
        _validate_question(question_id, question)

    selected_model = model or DEFAULT_MODEL
    if not isinstance(selected_model, str) or not selected_model.strip():
        raise ValueError("model must be a non-empty string when supplied.")

    return {"state": state, "questions": questions, "model": selected_model}


def _load_api_key() -> str | None:
    value = os.environ.get("TYPESAFE_API_KEY")
    if value:
        return value

    # A running Codex desktop process may predate a newly added Windows user
    # environment variable. Reading that variable from HKCU lets the MCP child
    # pick it up without placing the secret in the plugin or Codex config.
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                value, _ = winreg.QueryValueEx(key, "TYPESAFE_API_KEY")
            if isinstance(value, str) and value:
                return value
        except (ImportError, FileNotFoundError, OSError):
            pass
    return None


def _request_typesafe(payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "typesafe-jev-mcp/0.1.0",
        },
    )

    for attempt in range(MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                parsed = json.loads(response.read().decode("utf-8"))
            if not isinstance(parsed, dict) or not isinstance(
                parsed.get("answers"), dict
            ):
                raise RuntimeError("TypeSafe returned an unexpected response shape.")
            return parsed
        except urllib.error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")[:MAX_ERROR_BODY_CHARS]
            if exc.code in {429, 529} and attempt < MAX_RETRIES:
                retry_after = exc.headers.get("Retry-After")
                try:
                    delay = min(max(float(retry_after), 0.1), 8.0) if retry_after else 2**attempt
                except ValueError:
                    delay = 2**attempt
                time.sleep(delay)
                continue
            if exc.code == 401:
                raise RuntimeError(
                    "TypeSafe rejected the API key (401). Check the local TYPESAFE_API_KEY setting."
                ) from None
            raise RuntimeError(
                f"TypeSafe request failed with HTTP {exc.code}: {body_text}"
            ) from None
        except urllib.error.URLError as exc:
            if attempt < MAX_RETRIES:
                time.sleep(2**attempt)
                continue
            raise RuntimeError(f"Could not reach TypeSafe API: {exc.reason}") from None
        except json.JSONDecodeError:
            raise RuntimeError("TypeSafe returned a response that was not valid JSON.") from None

    raise RuntimeError("TypeSafe request failed after retries.")


async def evaluate(state: Any, questions: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    """Evaluate typed questions against state and return TypeSafe's typed response."""
    payload = validate_request(state, questions, model)
    api_key = _load_api_key()
    if not api_key:
        raise RuntimeError(
            "TypeSafe API key is not configured. Set the Windows user environment variable TYPESAFE_API_KEY."
        )
    return await asyncio.to_thread(_request_typesafe, payload, api_key)


mcp.tool(name="jev_evaluate") (evaluate)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
