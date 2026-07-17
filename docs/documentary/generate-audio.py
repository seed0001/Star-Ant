#!/usr/bin/env python3
"""Render documentary episode scripts to narration audio via Edge TTS.

Reads docs/documentary/eNN-*.md, strips headings / metadata / [SCENE:] cues,
and renders the remaining narration with the series voice (Andrew). Writes
eNN.mp3 plus eNN.cues.json (word-boundary timings for caption sync) into
public/audio/documentary/.

Usage:
    pip install edge-tts
    python docs/documentary/generate-audio.py            # all episodes
    python docs/documentary/generate-audio.py e03 e10    # just these episodes
"""

import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

VOICE = "en-US-AndrewMultilingualNeural"

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR.parent.parent / "public" / "audio" / "documentary"

SHOT_RE = re.compile(r"^\[SHOT:\s*(\w+)\s+(\w+)(?:\s*[—-]+\s*(.*?))?\]$")

SEASONS = {
    range(1, 12): "Season 1 · The Critters",
    range(12, 16): "Season 2 · The Flora",
    range(16, 22): "Season 3 · The Environment",
    range(22, 25): "Season 4 · Connections",
}


def season_for(num: int) -> str:
    for r, name in SEASONS.items():
        if num in r:
            return name
    return ""


def parse_script(md_text: str):
    """Parse an episode script into (title, segments).

    Segments are narration paragraphs, each carrying the [SHOT:] cue that
    precedes it and its cumulative word offset into the full narration.
    """
    title = ""
    segments = []
    current_shot = None
    word_offset = 0
    para_lines = []

    def flush():
        nonlocal para_lines, word_offset
        text = " ".join(" ".join(para_lines).split())
        para_lines = []
        if not text:
            return
        segments.append(
            {
                "shot": current_shot,
                "text": text,
                "wordStart": word_offset,
                "wordCount": len(text.split()),
            }
        )
        word_offset += len(text.split())

    for raw in md_text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        if line.startswith("# ") and not title:
            title = re.sub(r"^Episode\s*\d+\s*[—-]+\s*", "", line[2:]).strip()
            continue
        if line.startswith("#"):
            flush()
            continue
        if line.startswith("- ") or line.startswith("* "):
            continue
        m = SHOT_RE.match(line)
        if m:
            flush()
            current_shot = {
                "type": m.group(1),
                "subject": m.group(2),
                "notes": m.group(3) or "",
            }
            continue
        para_lines.append(line)
    flush()
    return title, segments


def narration_text(segments) -> str:
    return "\n\n".join(s["text"] for s in segments)


def spoken_token_count(segments) -> int:
    """Word count using the same tokenization the in-app player uses."""
    return sum(
        1
        for s in segments
        for t in s["text"].split()
        if re.search(r"[A-Za-z0-9]", t)
    )


async def render_audio(text: str, mp3_path: Path):
    """One TTS render attempt. Returns the word-boundary cue list."""
    communicate = edge_tts.Communicate(text, VOICE, boundary="WordBoundary")
    cues = []
    with open(mp3_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                cues.append(
                    {
                        "text": chunk["text"],
                        "offsetMs": round(chunk["offset"] / 10_000),
                        "durationMs": round(chunk["duration"] / 10_000),
                    }
                )
    return cues


async def render_episode(md_path: Path, audio: bool = True):
    ep_id = md_path.stem.split("-")[0]  # e.g. "e01"
    num = int(ep_id[1:])
    title, segments = parse_script(md_path.read_text(encoding="utf-8"))
    if not segments:
        print(f"  {ep_id}: no narration text found, skipping")
        return None

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mp3_path = OUT_DIR / f"{ep_id}.mp3"
    cues_path = OUT_DIR / f"{ep_id}.cues.json"
    script_path = OUT_DIR / f"{ep_id}.script.json"

    script_path.write_text(
        json.dumps(
            {"id": ep_id, "number": num, "title": title, "segments": segments}
        ),
        encoding="utf-8",
    )

    if audio:
        # Edge TTS occasionally drops a chunk of a long stream without erroring,
        # which desyncs captions and camera cues. Validate the word-boundary
        # count against the script's own tokenization and retry on mismatch.
        expected = spoken_token_count(segments)
        cues = []
        for attempt in range(1, 6):
            cues = await render_audio(narration_text(segments), mp3_path)
            if abs(len(cues) - expected) <= 3:
                break
            print(
                f"  {ep_id}: attempt {attempt} incomplete "
                f"({len(cues)}/{expected} word cues), retrying...",
                flush=True,
            )
            await asyncio.sleep(2 * attempt)
        else:
            raise RuntimeError(
                f"{ep_id}: TTS stream stayed incomplete after 5 attempts"
            )
        cues_path.write_text(json.dumps(cues), encoding="utf-8")
        end_s = (cues[-1]["offsetMs"] + cues[-1]["durationMs"]) / 1000 if cues else 0
        words = sum(s["wordCount"] for s in segments)
        print(f"  {ep_id}: {words} words -> {mp3_path.name} ({end_s / 60:.1f} min)", flush=True)

    return {"id": ep_id, "number": num, "title": title, "season": season_for(num)}


async def main() -> None:
    args = [a.lower() for a in sys.argv[1:]]
    scripts_only = "--scripts-only" in args
    wanted = {a for a in args if a != "--scripts-only"}
    episodes = sorted(SCRIPT_DIR.glob("e[0-9][0-9]-*.md"))
    if wanted:
        episodes = [p for p in episodes if p.stem.split("-")[0] in wanted]
    if not episodes:
        print("No matching episode scripts found.")
        return
    print(f"Rendering {len(episodes)} episode(s) with voice {VOICE}", flush=True)
    entries = []
    for md_path in episodes:
        entry = await render_episode(md_path, audio=not scripts_only)
        if entry:
            entries.append(entry)
    # Manifest covers ALL episodes on disk (not just the ones re-rendered).
    all_entries = []
    for md_path in sorted(SCRIPT_DIR.glob("e[0-9][0-9]-*.md")):
        ep_id = md_path.stem.split("-")[0]
        num = int(ep_id[1:])
        title, _ = parse_script(md_path.read_text(encoding="utf-8"))
        all_entries.append(
            {"id": ep_id, "number": num, "title": title, "season": season_for(num)}
        )
    (OUT_DIR / "manifest.json").write_text(
        json.dumps({"voice": VOICE, "episodes": all_entries}), encoding="utf-8"
    )
    print(f"Wrote manifest with {len(all_entries)} episodes.")


if __name__ == "__main__":
    asyncio.run(main())
