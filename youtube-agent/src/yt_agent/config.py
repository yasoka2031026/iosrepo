"""Environment-driven configuration.

No secrets live in this repo. Everything here is read from environment
variables (see config/.env.example) so API keys can be supplied later
by whoever runs the agent, without touching code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class AppConfig:
    llm_provider: str  # "claude" | "codex" | "mock"
    youtube_mode: str  # "api" | "mock"
    anthropic_api_key: Optional[str]
    openai_api_key: Optional[str]
    youtube_api_key: Optional[str]
    obsidian_vault_path: Path

    @classmethod
    def from_env(cls) -> "AppConfig":
        vault = os.environ.get("OBSIDIAN_VAULT_PATH", "./obsidian_vault")
        return cls(
            llm_provider=os.environ.get("LLM_PROVIDER", "mock"),
            youtube_mode=os.environ.get("YOUTUBE_MODE", "mock"),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY"),
            openai_api_key=os.environ.get("OPENAI_API_KEY"),
            youtube_api_key=os.environ.get("YOUTUBE_API_KEY"),
            obsidian_vault_path=Path(vault),
        )
