"""Live MCP -> Jev smoke test. Requires TYPESAFE_API_KEY in the Windows user environment."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"


async def main() -> None:
    server_params = StdioServerParameters(
        command=str(PYTHON),
        args=[str(ROOT / "server.py")],
    )
    async with stdio_client(server_params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            if "jev_evaluate" not in names:
                raise RuntimeError(f"MCP tool not advertised: {sorted(names)}")

            result = await session.call_tool(
                "jev_evaluate",
                {
                    "state": {"sentence": "A cat is sleeping on the windowsill."},
                    "questions": {
                        "describes_sleeping_animal": {
                            "type": "noul",
                            "instructions": "Does `sentence` describe an animal that is sleeping?",
                        }
                    },
                },
            )
            if result.isError:
                raise RuntimeError(f"MCP tool returned an error: {result.content}")
            if not result.structuredContent or "answers" not in result.structuredContent:
                raise RuntimeError("MCP result did not include structured TypeSafe answers.")

            answer = result.structuredContent["answers"]["describes_sleeping_animal"]
            if answer.get("type") != "noul" or not isinstance(answer.get("noul"), (int, float)):
                raise RuntimeError("Live Jev response was missing a typed Noul value.")
            print(
                {
                    "mcp_tool": "jev_evaluate",
                    "model": result.structuredContent.get("model"),
                    "answer_type": answer.get("type"),
                    "noul": answer.get("noul"),
                    "usage": result.structuredContent.get("usage"),
                }
            )


if __name__ == "__main__":
    asyncio.run(main())
