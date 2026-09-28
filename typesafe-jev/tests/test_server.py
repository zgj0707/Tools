from __future__ import annotations

import asyncio
import io
import json
import unittest
from unittest.mock import patch

import server


class FakeResponse(io.BytesIO):
    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class RequestValidationTests(unittest.TestCase):
    def test_accepts_typed_questions_and_defaults_model(self) -> None:
        payload = server.validate_request(
            {"message": "A cat is sleeping."},
            {
                "animal": {"type": "noul", "instructions": "Does `message` describe an animal?"},
                "topic": {
                    "type": "choice",
                    "instructions": "What is happening?",
                    "criteria": {"sleeping": "The animal is asleep.", "other": "Something else."},
                },
                "clarity": {
                    "type": "score",
                    "instructions": "How clear is the message?",
                    "criteria": ["Unclear", "Clear"],
                },
            },
            None,
        )
        self.assertEqual(payload["model"], "jev-latest")

    def test_rejects_untyped_question(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported type"):
            server.validate_request("text", {"bad": {"type": "freeform"}}, None)

    def test_rejects_score_with_one_level(self) -> None:
        with self.assertRaisesRegex(ValueError, "2 to 10"):
            server.validate_request(
                "text",
                {"score": {"type": "score", "instructions": "Rate it", "criteria": ["Only"]}},
                None,
            )


class ApiAdapterTests(unittest.TestCase):
    def test_posts_official_payload_and_returns_typed_answers(self) -> None:
        response_body = {
            "model": "jev-1.13.0",
            "answers": {"animal": {"type": "noul", "noul": 0.99}},
            "usage": {"input_tokens": 10, "output_tokens": 4},
        }

        def fake_urlopen(request: object, timeout: int) -> FakeResponse:
            self.assertEqual(timeout, server.REQUEST_TIMEOUT_SECONDS)
            self.assertEqual(request.full_url, server.API_URL)  # type: ignore[attr-defined]
            self.assertEqual(request.get_header("Authorization"), "Bearer test-key")  # type: ignore[attr-defined]
            body = json.loads(request.data.decode("utf-8"))  # type: ignore[attr-defined]
            self.assertEqual(body["model"], "jev-latest")
            return FakeResponse(json.dumps(response_body).encode("utf-8"))

        with patch.object(server.urllib.request, "urlopen", fake_urlopen):
            result = server._request_typesafe(
                {"state": "A cat sleeps.", "questions": {}, "model": "jev-latest"},
                "test-key",
            )
        self.assertEqual(result, response_body)

    def test_unauthorized_error_never_returns_api_key(self) -> None:
        error = server.urllib.error.HTTPError(
            server.API_URL,
            401,
            "Unauthorized",
            {},
            io.BytesIO(b"invalid credential"),
        )
        with patch.object(server.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "rejected the API key") as caught:
                server._request_typesafe({"state": "x"}, "test-secret")
        self.assertNotIn("test-secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
