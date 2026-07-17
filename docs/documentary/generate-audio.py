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


def extract_narration(md_text: str) -> str:
    """Keep only narration paragraphs: drop headings, metadata bullets, scene cues."""
    lines = []
    for raw in md_text.splitlines():
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        if line.startswith("#"):
            continue
        if line.startswith("- ") or line.startswith("* "):
            continue
        if line.startswith("[SCENE") or line.startswith("[scene"):
            continue
        lines.append(line)
    text = "\n".join(lines)
    # Collapse blank runs; join wrapped lines within a paragraph.
    paragraphs = [
        " ".join(p.split("\n")) for p in re.split(r"\n\s*\n", text) if p.strip()
    ]
    return "\n\n".join(paragraphs)


async def render_episode(md_path: Path) -> None:
    ep_id = md_path.stem.split("-")[0]  # e.g. "e01"
    narration = extract_narration(md_path.read_text(encoding="utf-8"))
    if not narration:
        print(f"  {ep_id}: no narration text found, skipping")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mp3_path = OUT_DIR / f"{ep_id}.mp3"
    cues_path = OUT_DIR / f"{ep_id}.cues.json"

    communicate = edge_tts.Communicate(narration, VOICE)
    cues = []
    with open(mp3_path, "wb") as f:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                cues.append(
                    {
                        "text": chunk["text"],
                        "offsetMs": chunk["offset"] / 10_000,
                        "durationMs": chunk["duration"] / 10_000,
                    }
                )

    cues_path.write_text(json.dumps(cues), encoding="utf-8")
    words = len(narration.split())
    end_s = (cues[-1]["offsetMs"] + cues[-1]["durationMs"]) / 1000 if cues else 0
    print(f"  {ep_id}: {words} words -> {mp3_path.name} ({end_s / 60:.1f} min)")


async def main() -> None:
    wanted = {a.lower() for a in sys.argv[1:]}
    episodes = sorted(SCRIPT_DIR.glob("e[0-9][0-9]-*.md"))
    if wanted:
        episodes = [p for p in episodes if p.stem.split("-")[0] in wanted]
    if not episodes:
        print("No matching episode scripts found.")
        return
    print(f"Rendering {len(episodes)} episode(s) with voice {VOICE}")
    for md_path in episodes:
        await render_episode(md_path)


if __name__ == "__main__":
    asyncio.run(main())
