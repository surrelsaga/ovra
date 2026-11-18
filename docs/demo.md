# Demo mode (judge reference)

Turn Demo on in New session. It presets **20 minutes**, with the camera on the whole time.
Allow about **15 minutes** for the tour. If no moods appear at all, calibration (up to 90 s), the
step limits and the 5-second pauses take **15 minutes 20 seconds**; every step still runs. Calibration
can take longer if you pause to fix framing or choose Try again. Press End whenever you want the summary.

Ovra uses real readings and the same mood bars. Shorter waits make demo moods less certain than
normal sessions. No mood is forced. The first 2 minutes after the starting usual exists also let
readable, non-stressed checks refine it, including low checks: this corrects a start that read high,
but can learn away a real early tired spell. Normal mode keeps its calm-only refinement.

The orb has a Demo badge and numbered hints in its speech bubble, like **Demo: 4/9**. The `Demo:`
prefix keeps hints queued after ordinary state messages. Steps stay in order; an early mood is
remembered and acknowledged when its step arrives. Each attempt has a limit and an honest fallback,
so a missing mood never blocks the tour. Hints last 25 s (preview fallbacks 6 s); after a goal or
fallback, the next step is requested 5 s later and waits for the bubble to be free. Good mood is
explained and skipped when face reading is off.

## Before Start

Optional Spotify prompt check: quit Spotify yourself, turn Demo on with music enabled, then press
Start. The “Spotify isn't open” prompt appears. Open Spotify and the session starts by itself.
Ovra never launches Spotify. To hear changes, leave “Leave my music alone” off.

Getting to know you takes about 1½ minutes: “Starting the camera…”, “Getting you in view”, then
“Getting to know you · About X s”. Sit normally. A failed attempt offers Try again or Start anyway;
with Start anyway, the tour begins when enough steady readings have formed your usual.

## The 9 tour steps

| Step | Do this                                                                               | Look for                                                                                      | Limit and fallback                                                                                         |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1    | Work normally for a minute.                                                           | Steady: a calm blue-white moon, Steady music.                                                 | 45 s: preview of Steady.                                                                                   |
| 2    | Smile for about 20 s, without big laughs. Face reading must be on.                    | Good mood: a brighter moon, Keep it going music.                                              | 60 s: preview of Good mood. With face reading off, the hint explains and skips.                            |
| 3    | A stretch card appears by itself at about 3 min seated. Press Let's go and follow it. | Neck tilts and the card's tilt feedback (face reading on).                                    | 120 s: "No stretch card yet. … Moving on."                                                                 |
| 4    | Jog in place or do squats for about 90 s, then sit still.                             | Stressed: amber, Calm down music switching right away.                                        | 150 s: preview of Stressed (amber moon, Calm down music).                                                  |
| 5    | Press Let's go on the breathing card. Breathe with the moon.                          | The moon guides your breath; back to Steady as your heart rate drops.                         | If Stressed didn't show, the step offers the Breathe along card as a labelled preview. 105 s: "Moving on." |
| 6    | Jog in place or do squats for about 2 min, then sit still and frown.                  | Very stressed: red, a fade to Quiet, and a walk card. The frown only supports the heart rate. | 150 s: preview of Very stressed (red moon, Quiet fade, walk card).                                         |
| 7    | Step out of view for 20 s, then come back.                                            | "Couldn't see you · away in …", a dimmed moon, paused music, then a return check.             | 60 s: "Ovra didn't see you leave. … Moving on."                                                            |
| 8    | Lean back and breathe slowly for about 90 s. Tired may not appear.                    | Tired: dim moon, Pick me up music, stand-and-stretch card.                                    | 100 s: preview of Tired (dim moon, Pick me up music, stand-and-stretch card).                              |
| 9    | Press End.                                                                            | Summary and History, both marked "Demo session · shorter waits".                              | Final instruction. In the last 2 min, music is Wind down unless Very stressed.                             |

## What you'll see if a mood doesn't show

Most people's heart rate settles fast, so Stressed, Very stressed and Tired often don't appear in a
short demo. Then Ovra shows a **preview of its reaction**, labelled as a preview everywhere:

- **Bubble:** for example "Stressed didn't show for you. Preview: when you're stressed, the moon turns
  amber and music plays Calm down."
- **Moon:** that mood's look for 6 seconds, while the bubble is up.
- **Music** (if on): for 30 seconds Ovra steers toward that mood's music the usual silent way
  (skipping inside the playlist; Quiet fades the volume down and back). The pill under the moon reads
  "Preview · Calm down". Then it steers back to the music for your real mood. A preview never switches
  playlist, so it never brings Spotify forward, and your volume is put back.
- **Exercise card:** Breathe along (Stressed, offered in step 5), the walk card (Very stressed) and
  Stand and stretch (Tired), each starting with "Preview:". You can try it; it's a normal guided
  exercise, and a finished one counts as a move done. Skip or "1 more min" just closes a preview card.
  A preview card never replaces a real reminder or an exercise in progress; it waits its turn by not
  showing. Press Let's go or Skip on real reminders so preview cards can appear.

A preview is never a mood: the real mood, the why line and the hold toward a mood keep running
underneath. Nothing about it is saved: no situation, no timeline or history entry, no learned song
votes, and songs heard during a music preview aren't added to the session's song list. It never marks
that mood as seen. Normal sessions never show previews. If you step away while a music preview plays,
the paused song resumes on return and the next song follows your real mood.

The exercise hints leave time to sit still for the SDK's rolling readings and the 45-second
Stressed hold. They do not lower a mood bar or guarantee Stressed/Very stressed.

Press Let's go on reminders: an ignored card keeps later reminders waiting. Stand and walk still
come from Tired and Very stressed; the tour does not force them. Neck-for-long-Stressed and Step
outside are outside this short tour. Move lengths are unchanged.

Optional “Lost track” check: while Tired or Stressed, stand up and stay out of view for 1 minute.
Enough no-read windows forget that mood; the why line says **“Lost track of you for a bit · checking
again”** and music keeps its last choice. Steady and Good mood survive those gaps.

## Real vs demo timings

| What                                                            | Normal                                              | Demo                                          |
| --------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| Mood bars and minimum readable seconds                          | As tuned                                            | The same                                      |
| Getting to know you                                             | 30 s steady heart rate, cap 180 s                   | Same 30 s, cap 90 s                           |
| Refine your usual from calm checks                              | First 10 min after it exists                        | First 2 min                                   |
| Initial readable, non-tense/non-near-tense refinement           | Off (`baselineSettleMin: 0`)                        | First 2 min (`baselineSettleMin: 2`)          |
| Reading window / update (continuous)                            | 60 s / 30 s                                         | 30 s / 10 s                                   |
| Hold before Stressed / Tired                                    | 3 min / 2 min                                       | 45 s / 60 s                                   |
| No-read span before forgetting Stressed / Very stressed / Tired | 3 min                                               | 1 min                                         |
| Stressed before Very stressed (long route)                      | 10 min                                              | 2 min                                         |
| No presence before away                                         | 20 s                                                | 15 s                                          |
| Return check                                                    | 30 s                                                | 20 s                                          |
| Music direction changes at most every                           | 3 min                                               | 20 s                                          |
| Start a song for a changed target                               | Between tracks; Quiet switches and fades right away | Right away for every target; only Quiet fades |
| Wind down                                                       | Last 600 s (10 min)                                 | Last 120 s (2 min)                            |
| Break reminders at most every                                   | 20 min                                              | 1 min                                         |
| Seated neck / stand / walk reminders                            | 45 / 60 / 90 min                                    | 3 / 60 / 60 min                               |
| Put off a reminder                                              | 5 min                                               | 1 min                                         |
| Hint / next-step delay                                          | No hints                                            | 25 s / 5 s                                    |

All overlays last one demo session in memory. They are restored on end and never written to your
settings. History stores only the demo flag with the usual labels and counts; no raw readings or
starting usual are saved. For the real experience, run a normal session while you work.

## Mocked preview screenshot

After `npm run build`, run the shell fixture with an isolated Chromium profile:

```sh
OVRA_HARNESS=shell OVRA_PREVIEW_SHOT=1 OVRA_SHOTS=/tmp/ovra-job22-shots OVRA_ENV_PATH=/tmp/ovra-no-env ./node_modules/.bin/electron . --user-data-dir=/tmp/ovra-job22-chromium
```

It uses fake bus data, temporary privacy storage, no SDK, no camera and no Spotify controller.
`demo-stressed-preview.png` shows the labelled amber preview, and `demo-preview-cleared.png` shows
the real Steady moon restored. Only rendered app UI is captured; there are no camera frames.
