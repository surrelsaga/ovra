# Demo mode (judge reference)

Turn Demo on in New session. It presets **20 minutes**, with the camera on the whole time.
Allow about **10 minutes** for the tour. Its job is to show every state, music reaction and exercise
card fast, not to judge accurately. If no moods appear at all, calibration (up to 90 s), the step
limits and the pauses between steps take **10 minutes 45 seconds**; every step still runs. Calibration
can take longer if you pause to fix framing or choose Try again. Press End whenever you want the summary.

Ovra uses real readings and the same mood bars. Shorter waits make demo moods less certain than
normal sessions. No mood is forced. The first 2 minutes after the starting usual exists also let
readable, non-stressed checks refine it, including low checks: this corrects a start that read high,
but can learn away a real early tired spell. Normal mode keeps its calm-only refinement.

The orb has a Demo badge and numbered hints in its speech bubble, like **Demo: 4/9**. The `Demo:`
prefix keeps hints queued after ordinary state messages. Steps stay in order; an early mood is
remembered and acknowledged when its step arrives. Each attempt has a limit and an honest fallback,
so a missing mood never blocks the tour. Every hint says roughly how long the step takes. Hints last
25 s (preview fallbacks 6 s); after a goal or fallback, the next step is requested 5 s later (15 s
after a step that ends by showing its exercise card, so the card can be read) and waits for the bubble
to be free. Good mood is explained and skipped when face reading is off.

**Every exercise card shows exactly once, at a fixed step, and nothing else pops up.** In demo only the
tour shows exercise cards: no mood suggestions, no sitting reminders, and no breathing round after the
return check (the Welcome back check itself still shows after an away). An early mood is acknowledged
by its step, which still shows its card.

## Before Start

Optional Spotify prompt check: quit Spotify yourself, turn Demo on with music enabled, then press
Start. The “Spotify isn't open” prompt appears. Open Spotify and the session starts by itself.
Ovra never launches Spotify. To hear changes, leave “Leave my music alone” off.

Getting to know you takes about 1½ minutes: “Starting the camera…”, “Getting you in view”, then
“Getting to know you · About X s”. Sit normally. A failed attempt offers Try again or Start anyway;
with Start anyway, the tour begins when enough steady readings have formed your usual.

## The 9 tour steps

| Step | Do this                                                                                   | Look for                                                                                                 | Limit and fallback                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Work normally.                                                                            | Steady: a calm blue-white moon, Steady music.                                                            | 30 s: preview of Steady.                                                                                                         |
| 2    | Smile for about 20 s, without big laughs. Face reading must be on.                        | Good mood: a brighter moon, Keep it going music.                                                         | 40 s: preview of Good mood. With face reading off, the hint explains and skips.                                                  |
| 3    | The neck stretch card appears at once. Press Let's go and follow it.                      | Neck tilts and the card's tilt feedback (face reading on).                                               | 100 s: "Moving on." (time for the 90 s stretch).                                                                                 |
| 4    | Jog in place or do squats for about 40 s, then sit still.                                 | Stressed: amber, Calm down music switching right away.                                                   | 60 s: preview of Stressed (amber moon, Calm down music).                                                                         |
| 5    | Press Let's go on the breathing card. Breathe with the moon.                              | The moon guides your breath; back to Steady as your heart rate drops.                                    | If Stressed didn't show, the card is a labelled preview. 100 s: "Moving on."                                                     |
| 6    | Jog or do squats again for about 40 s, then sit still and frown.                          | Very stressed: red, a fade to Quiet, and the walk card (Let's go plays a 15 s demo version at the desk). | 60 s: preview of Very stressed (red moon, Quiet fade, walk card).                                                                |
| 7    | Press Let's go on the Step outside card, step out of view for about 20 s, then come back. | The away moon, "On a break" card, paused music, then Welcome back · seeing how you feel.                 | 60 s: preview of Away (away moon, "Preview · Away · just now" pill; music not paused). Once you've left, the step waits for you. |
| 8    | Lean back and breathe slowly.                                                             | Tired: dim moon, Pick me up music, stand-and-stretch card.                                               | 45 s: preview of Tired (dim moon, Pick me up music, stand-and-stretch card).                                                     |
| 9    | Press End.                                                                                | Summary and History, both marked "Demo session · shorter waits".                                         | Final instruction. In the last 2 min, music is Wind down unless Very stressed.                                                   |

The limits are short on purpose: a real Stressed or Tired needs a 45–60 s hold on top of a 30 s
window, so in this tour they mostly appear when they were already building. Accuracy isn't the goal
of the demo; a long normal session is.

## What you'll see if a mood doesn't show

Most people's heart rate settles fast, so Stressed, Very stressed and Tired often don't appear in a
short demo. Then Ovra shows a **preview of its reaction**, labelled as a preview everywhere:

- **Bubble:** for example "Stressed didn't show. Preview: when you're stressed, the moon turns amber
  and music plays Calm down." Every demo hint is at most 120 characters so it fits the orb bubble.
- **Moon:** that mood's look for 6 seconds, while the bubble is up. For Away, the away moon and a
  "Preview · Away · just now" pill; music isn't paused for it.
- **Music** (if on): for 30 seconds Ovra steers toward that mood's music the usual silent way
  (skipping inside the playlist; Quiet fades the volume down and back). The pill under the moon reads
  "Preview · Calm down". Then it steers back to the music for your real mood. A preview never switches
  playlist, so it never brings Spotify forward, and your volume is put back.
- **Exercise card:** Breathe along (Stressed, offered in step 5), the walk card (Very stressed) and
  Stand and stretch (Tired), each starting with "Preview:". You can try it; it's a normal guided
  exercise, and a finished one counts as a move done. Skip or "1 more min" just closes a card.
  A step's card replaces the previous step's card if that one is still unanswered. It never
  interrupts an exercise, break or return check in progress; it shows right after.

A preview is never a mood: the real mood, the why line and the hold toward a mood keep running
underneath. Nothing about it is saved: no situation, no timeline or history entry, no learned song
votes, and songs heard during a music preview aren't added to the session's song list. It never marks
that mood as seen. Normal sessions never show previews. If you step away while a music preview plays,
the paused song resumes on return and the next song follows your real mood.

The exercise hints leave time to sit still for the SDK's rolling readings and the 45-second
Stressed hold. They do not lower a mood bar or guarantee Stressed/Very stressed.

**The two leave-the-desk exercises are short demo versions.** The walk's Let's go plays a 15 s version
at the desk ("Demo version: walk on the spot…", real length 5 min), so it never starts a break and
never overlaps step 7. Step outside (step 7, labelled "Preview: when you've been stressed for a long
time…") is a real away and back, shortened to about 20 s (real length 10 min). Other exercise lengths
are unchanged.

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
| Mood suggestions and sitting reminders                          | One every 20 min at most, one per mood episode      | Off: only the tour's five step cards          |
| Seated neck / stand / walk reminders                            | 30–25 / 60–50 / 90–75 min by activity               | Off (step 3 shows the stretch card)           |
| Breathing round after a still-stressed return check             | Offered                                             | Off ("You still seem a bit stressed")         |
| Walk / step outside                                             | 5 min / 10 min                                      | 15 s at the desk / about 20 s away            |
| Hint / next-step delay                                          | No hints                                            | 25 s / 5 s (15 s after a card)                |
| Step limits (1–8)                                               | No steps                                            | 30 / 40 / 100 / 60 / 100 / 60 / 60 / 45 s     |

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
