"""LLM abstraction over the frontier models used for summarization: Claude and Codex.

Long transcripts are handled with a simple map-reduce: split into
character-budget chunks, summarize each chunk, then combine the chunk
summaries into one final structured note. This keeps every call well
under typical context limits regardless of video length.
"""

from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from typing import Callable, Optional

from .errors import LLMError, LLMTransientError
from .models import NotableQuote, StructuredNote, VideoMetadata

CHUNK_CHAR_BUDGET = 8000
MAX_RETRIES = 3

_SYSTEM_PROMPT = """You are an information-gathering assistant. Given a YouTube \
video's metadata and transcript, extract the useful information a busy \
person would want in their notes. Respond with ONLY a JSON object with keys: \
summary (string), key_points (array of strings), notable_quotes (array of \
{quote, timestamp}), action_items (array of strings), tags (array of \
lowercase strings). No prose outside the JSON."""

_REDUCE_PROMPT = """You are combining partial summaries of chunks of a single \
YouTube video's transcript into one final structured note. Respond with \
ONLY a JSON object with keys: summary, key_points, notable_quotes, \
action_items, tags — same schema as before."""


class LLMClient(ABC):
    """Interface every concrete summarization backend implements."""

    provider_name: str = "unknown"

    def summarize(self, video: VideoMetadata, transcript_text: str) -> StructuredNote:
        chunks = _chunk_text(transcript_text, CHUNK_CHAR_BUDGET)
        if len(chunks) == 1:
            return self._summarize_single(video, chunks[0])
        return self._summarize_map_reduce(video, chunks)

    def _summarize_single(self, video: VideoMetadata, chunk: str) -> StructuredNote:
        prompt = (
            f"Title: {video.title}\nChannel: {video.channel_title}\n"
            f"Published: {video.published_at}\n\nTranscript:\n{chunk}"
        )
        raw = self._call_with_retry(_SYSTEM_PROMPT, prompt)
        return _parse_note(raw)

    def _summarize_map_reduce(self, video: VideoMetadata, chunks: list[str]) -> StructuredNote:
        partials = []
        for i, chunk in enumerate(chunks):
            prompt = (
                f"Title: {video.title} (part {i + 1}/{len(chunks)})\n\n"
                f"Transcript part:\n{chunk}"
            )
            raw = self._call_with_retry(_SYSTEM_PROMPT, prompt)
            partials.append(raw)

        combined_prompt = "Partial summaries (JSON, one per chunk):\n" + "\n---\n".join(partials)
        raw = self._call_with_retry(_REDUCE_PROMPT, combined_prompt)
        return _parse_note(raw)

    def _call_with_retry(self, system_prompt: str, user_prompt: str) -> str:
        last_error: Optional[Exception] = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return self._call(system_prompt, user_prompt)
            except LLMTransientError as exc:
                last_error = exc
                if attempt < MAX_RETRIES:
                    self._sleep(0.5 * (2 ** (attempt - 1)))
        raise LLMError(
            f"{self.provider_name}: exhausted {MAX_RETRIES} retries: {last_error}"
        ) from last_error

    def _sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    @abstractmethod
    def _call(self, system_prompt: str, user_prompt: str) -> str:
        """Return the raw text response for a single prompt. May raise LLMTransientError."""
        ...


class AnthropicClaudeClient(LLMClient):
    """Real Claude backend. Requires the ``anthropic`` package and an API key."""

    provider_name = "claude"

    def __init__(self, api_key: str, model: str = "claude-sonnet-5"):
        if not api_key:
            raise ValueError("Anthropic API key is required for AnthropicClaudeClient")
        self._api_key = api_key
        self._model = model
        self._client = None

    def _client_instance(self):
        if self._client is None:
            import anthropic  # type: ignore

            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def _call(self, system_prompt: str, user_prompt: str) -> str:
        import anthropic  # type: ignore

        try:
            resp = self._client_instance().messages.create(
                model=self._model,
                max_tokens=2000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.InternalServerError) as exc:
            raise LLMTransientError(str(exc)) from exc
        except anthropic.APIError as exc:
            raise LLMError(str(exc)) from exc

        return "".join(block.text for block in resp.content if block.type == "text")


class OpenAICodexClient(LLMClient):
    """Real Codex/GPT backend. Requires the ``openai`` package and an API key."""

    provider_name = "codex"

    def __init__(self, api_key: str, model: str = "gpt-5-codex"):
        if not api_key:
            raise ValueError("OpenAI API key is required for OpenAICodexClient")
        self._api_key = api_key
        self._model = model
        self._client = None

    def _client_instance(self):
        if self._client is None:
            import openai  # type: ignore

            self._client = openai.OpenAI(api_key=self._api_key)
        return self._client

    def _call(self, system_prompt: str, user_prompt: str) -> str:
        import openai  # type: ignore

        try:
            resp = self._client_instance().chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError) as exc:
            raise LLMTransientError(str(exc)) from exc
        except openai.APIError as exc:
            raise LLMError(str(exc)) from exc

        return resp.choices[0].message.content or ""


class MockLLMClient(LLMClient):
    """Deterministic, offline stand-in used by tests and the validation loop.

    ``behavior`` selects a canned response mode:
      - "success" (default): returns a well-formed StructuredNote as JSON.
      - "malformed_json": returns non-JSON text, exercising the parser's
        fallback path.
      - "empty": returns an empty string.
      - "transient_then_success": raises LLMTransientError on the first
        ``fail_times`` calls, then succeeds.
      - "always_transient": always raises LLMTransientError (exhausts retries).
    """

    provider_name = "mock"

    def __init__(self, behavior: str = "success", fail_times: int = 2, response_note: Optional[dict] = None):
        self.behavior = behavior
        self.fail_times = fail_times
        self._call_count = 0
        self._response_note = response_note or {
            "summary": "Mock summary of the video content.",
            "key_points": ["Point A", "Point B"],
            "notable_quotes": [{"quote": "This is important.", "timestamp": "00:01:23"}],
            "action_items": ["Follow up on X"],
            "tags": ["mock", "test"],
        }

    def _sleep(self, seconds: float) -> None:
        return  # never actually sleep in tests / validation loop

    def _call(self, system_prompt: str, user_prompt: str) -> str:
        self._call_count += 1
        if self.behavior == "always_transient":
            raise LLMTransientError("mock transient failure")
        if self.behavior == "transient_then_success":
            if self._call_count <= self.fail_times:
                raise LLMTransientError("mock transient failure")
            return json.dumps(self._response_note)
        if self.behavior == "malformed_json":
            return "Sure! Here's a summary: <not json at all>"
        if self.behavior == "empty":
            return ""
        return json.dumps(self._response_note)


def _chunk_text(text: str, budget: int) -> list[str]:
    text = text.strip()
    if not text:
        return [""]
    return [text[i : i + budget] for i in range(0, len(text), budget)] or [""]


def _parse_note(raw: str) -> StructuredNote:
    raw = (raw or "").strip()
    if not raw:
        return StructuredNote(summary="(LLM returned an empty response)", parse_error=True)

    text = raw
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return StructuredNote(
            summary=raw[:2000],
            tags=["parse-error"],
            parse_error=True,
        )

    quotes = [
        NotableQuote(quote=q.get("quote", ""), timestamp=q.get("timestamp"))
        for q in data.get("notable_quotes", [])
        if isinstance(q, dict) and q.get("quote")
    ]
    return StructuredNote(
        summary=data.get("summary", ""),
        key_points=list(data.get("key_points", [])),
        notable_quotes=quotes,
        action_items=list(data.get("action_items", [])),
        tags=list(data.get("tags", [])),
    )


def build_llm_client(provider: str, config: "AppConfig") -> LLMClient:  # noqa: F821
    """Factory used by the CLI to pick a backend from ``LLM_PROVIDER``."""
    if provider == "claude":
        return AnthropicClaudeClient(api_key=config.anthropic_api_key)
    if provider == "codex":
        return OpenAICodexClient(api_key=config.openai_api_key)
    if provider == "mock":
        return MockLLMClient()
    raise ValueError(f"Unknown LLM provider: {provider!r}")
