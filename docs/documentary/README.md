# Star-Ant: A World in the Grass — Documentary Series Bible

A 24-episode in-simulator nature documentary. Clicking **Documentary** in the app opens
the episode list; each episode plays pre-rendered narration audio while the camera
follows the episode's subject.

## Format

- **Runtime:** 5–10 minutes per episode (scripts target ~900–1,100 narration words,
  ≈ 6–8 min at the narrator's natural pace).
- **Narrator:** single voice for the whole series — Microsoft Edge TTS,
  voice **`en-US-AndrewMultilingualNeural`** ("Andrew"), default rate and pitch.
- **Tone:** classic wildlife documentary — warm, patient, quietly awed. The player is
  never addressed directly; the unseen hand that shapes the terrain, plants the
  forests, and fells the trees is referred to throughout the series as **the Gardener**.
- **Scale fiction:** the world is a meter-scale garden in which grass blades stand
  over a meter tall and the one resident human is an inch high. Narration leans into
  this miniature-giant framing constantly.

## Episode list

| # | Title | Season |
|---|-------|--------|
| 01 | The Ants | S1 · The Critters |
| 02 | The Fireflies | S1 |
| 03 | The Butterflies | S1 |
| 04 | The Ladybugs | S1 |
| 05 | The Spiders | S1 |
| 06 | The Worms | S1 |
| 07 | The Bumblebees | S1 |
| 08 | The Birds | S1 |
| 09 | The Fish | S1 |
| 10 | The Whale | S1 |
| 11 | The Visitor | S1 |
| 12 | The Grass | S2 · The Flora |
| 13 | The Flowers | S2 |
| 14 | The Trees | S2 |
| 15 | The Rocks | S2 |
| 16 | The Land | S3 · The Environment |
| 17 | The Water | S3 |
| 18 | The Sky | S3 |
| 19 | The Stars | S3 |
| 20 | The Moon and the Tides | S3 |
| 21 | The Weather | S3 |
| 22 | Web of Danger | S4 · Connections |
| 23 | When the Waters Rise | S4 |
| 24 | The Pollinators | S4 |

## Script file format

One markdown file per episode: `e01-the-ants.md` … `e24-the-pollinators.md`.

- `#` heading and the metadata bullet list at the top are **not** narrated.
- `[SHOT: …]` lines are camera cues for the in-app documentary controller —
  stripped before TTS. A cue applies to the narration paragraph(s) that follow it,
  until the next cue.
- `##` segment headings mark chapter boundaries (usable later for chapter skip) —
  stripped before TTS.
- Every other paragraph is narration, rendered verbatim.

## Shot grammar

Cues are written `[SHOT: <type> <subject> — <free-text staging notes>]`. The first
two tokens are machine-parsable; everything after the em dash is human intent the
controller may approximate. Shot types:

| Type | Camera behavior |
|------|-----------------|
| `wide` | High establishing shot; slow drift or crane move over the field |
| `orbit` | Circle the subject at close range, slight downward tilt |
| `track` | Follow a moving subject from behind/beside at fixed offset |
| `closeup` | Macro push-in, subject fills frame, shallow feel (slow dolly) |
| `low` | Ground-level, camera near terrain looking up through grass |
| `topdown` | Straight down, slow descent or rise |
| `dolly` | Straight-line glide past/through the subject area |
| `flythrough` | Fast, swooping traversal (between grass blades, tree trunks, over water) |
| `pan` | Fixed position, slow rotation across a vista |
| `crane` | Vertical rise or fall, e.g. grass floor to canopy to open sky |
| `cutaway` | Brief jump to a different subject, then return to the main subject |

Subjects: `ant`, `firefly`, `butterfly`, `ladybug`, `spider`, `web`, `worm`, `bee`,
`hive`, `birds`, `fish`, `whale`, `soldier`, `grass`, `flower`, `tree`, `stump`,
`rock`, `terrain`, `shore`, `water`, `underwater`, `sky`, `sun`, `moon`, `stars`,
`rain`, `snow`, `lightning`, `field` (whole world).

Direction: cuts land every one-to-three narration sentences — the camera should
never sit still for more than ~20 seconds. Vary altitude and distance aggressively:
macro to crane to flythrough within a single segment.

## Audio pipeline

Requires Python 3.9+ and [`edge-tts`](https://pypi.org/project/edge-tts/):

```
pip install edge-tts
python docs/documentary/generate-audio.py            # all episodes
python docs/documentary/generate-audio.py e07 e10    # specific episodes
```

Outputs, per episode, into `public/audio/documentary/`:

- `eNN.mp3` — full narration audio.
- `eNN.cues.json` — word-boundary timestamps (`{ text, offsetMs, durationMs }[]`)
  emitted by Edge TTS, for caption sync in the app.

Audio files are generated artifacts; regenerate after any script edit.
