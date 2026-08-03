"""Writes pipeline results as Obsidian-flavored markdown notes.

Each processed video becomes one note (YAML frontmatter + sections) under
``<vault>/YouTube/``, and is linked from a single "map of content" index
note so the whole collection stays browseable inside Obsidian without any
plugin. No Obsidian API/credentials are needed — this only writes files
into the vault folder on disk.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from .models import ProcessResult, StructuredNote, VideoMetadata

NOTES_SUBDIR = "YouTube"
MOC_FILENAME = "YouTube Information Gathering MOC.md"
_ILLEGAL_CHARS = re.compile(r'[\\/:*?"<>|\[\]#^]')
_MAX_TITLE_LEN = 80


def sanitize_filename(title: str) -> str:
    cleaned = _ILLEGAL_CHARS.sub("", title).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        cleaned = "Untitled"
    return cleaned[:_MAX_TITLE_LEN].strip()


def _yaml_str(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _yaml_list(values: list[str]) -> str:
    if not values:
        return "[]"
    return "[" + ", ".join(_yaml_str(v) for v in values) + "]"


def render_note(video: VideoMetadata, note: StructuredNote, provider: str, status: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    frontmatter_lines = [
        "---",
        f"title: {_yaml_str(video.title)}",
        "source: youtube",
        f"url: {_yaml_str(video.url)}",
        f"video_id: {_yaml_str(video.video_id)}",
        f"channel: {_yaml_str(video.channel_title)}",
        f"published: {_yaml_str(video.published_at)}",
        f"processed: {_yaml_str(now)}",
        f"llm_provider: {_yaml_str(provider)}",
        f"status: {_yaml_str(status)}",
        f"tags: {_yaml_list(['youtube', 'information-gathering', *note.tags])}",
        "---",
        "",
    ]

    body_lines = [f"# {video.title}", ""]

    body_lines += ["## 概要 (Summary)", "", note.summary or "_(summary unavailable)_", ""]

    if note.key_points:
        body_lines += ["## 主要ポイント (Key Points)", ""]
        body_lines += [f"- {p}" for p in note.key_points]
        body_lines.append("")

    if note.notable_quotes:
        body_lines += ["## 引用・注目発言 (Notable Quotes)", ""]
        for q in note.notable_quotes:
            ts = f" ({q.timestamp})" if q.timestamp else ""
            body_lines.append(f'- "{q.quote}"{ts}')
        body_lines.append("")

    if note.action_items:
        body_lines += ["## アクションアイテム / 気づき (Action Items)", ""]
        body_lines += [f"- [ ] {a}" for a in note.action_items]
        body_lines.append("")

    body_lines += [
        "## メタ情報",
        "",
        f"- チャンネル: [[{video.channel_title}]]",
        f"- 公開日: {video.published_at}",
        f"- 元動画: {video.url}",
        "",
    ]

    return "\n".join(frontmatter_lines + body_lines)


def write_note(vault_path: Path, video: VideoMetadata, note: StructuredNote, provider: str, status: str) -> Path:
    notes_dir = vault_path / NOTES_SUBDIR
    notes_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{sanitize_filename(video.title)} ({video.video_id}).md"
    path = notes_dir / filename
    path.write_text(render_note(video, note, provider, status), encoding="utf-8")
    return path


def update_moc(vault_path: Path, results: list[ProcessResult]) -> Path:
    """Append newly-processed videos to the MOC index, skipping ones already listed."""
    vault_path.mkdir(parents=True, exist_ok=True)
    moc_path = vault_path / MOC_FILENAME
    existing = moc_path.read_text(encoding="utf-8") if moc_path.exists() else (
        "# YouTube Information Gathering MOC\n\n"
        "| Video | Channel | Status | Processed |\n"
        "|---|---|---|---|\n"
    )

    new_rows = []
    for result in results:
        if not result.video or not result.note_path:
            continue
        if result.video.video_id in existing:
            continue
        note_name = Path(result.note_path).stem
        row = (
            f"| [[{note_name}\\|{result.video.title}]] "
            f"<!-- {result.video.video_id} --> "
            f"| {result.video.channel_title} | {result.status.value} | "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')} |"
        )
        new_rows.append(row)

    if new_rows:
        content = existing.rstrip("\n") + "\n" + "\n".join(new_rows) + "\n"
        moc_path.write_text(content, encoding="utf-8")
    elif not moc_path.exists():
        moc_path.write_text(existing, encoding="utf-8")

    return moc_path
