# Demo mode (judge reference)

Turn Demo on in New session. It presets **20 minutes**, with the camera on the whole time.
Allow about **16 minutes** for the tour; if every attempt times out, calibration (about 90 s),
all step limits and the 8-second pauses take about **19 minutes 19 seconds**. Calibration can take
longer if you pause to fix framing or choose Try again. Press End whenever you want the summary.

Ovra uses real readings and the same mood bars. Shorter waits make demo moods less certain than
normal sessions. No mood is forced. The first 2 minutes after the starting usual exists also let
readable, non-stressed checks refine it, including low checks: this corrects a start that read high,
but can learn away a real early tired spell. Normal mode keeps its calm-only refinement.

The orb has a Demo badge and numbered hints in its speech bubble, like **Demo: 4/9**. The `Demo:`
prefix keeps hints queued after ordinary state messages. Steps stay in order; an early mood is
remembered and acknowledged when its step arrives. Each attempt has a limit and an honest fallback,
so a missing mood never blocks the tour. Hints last 25 s; after a goal or fallback, the next step is
requested 8 s later and waits for the bubble to be free. Good mood is explained and skipped when
face reading is off. The breathing step is skipped if Stressed never appeared.

## Before Start

Optional Spotify prompt check: quit Spotify yourself, turn Demo on with music enabled, then press
Start. The “Spotify isn't open” prompt appears. Open Spotify and the session starts by itself.
Ovra never launches Spotify. To hear changes, leave “Leave my music alone” off.

Getting to know you takes about 1½ minutes: “Starting the camera…”, “Getting you in view”, then
“Getting to know you · About X s”. Sit normally. A failed attempt offers Try again or Start anyway;
with Start anyway, the tour begins when enough steady readings have formed your usual.

## The 9 tour steps

| Step | Do this                                                                               | Look for                                                                                                                    | Limit and fallback                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Work normally for a minute.                                                           | Steady: a calm blue-white moon, Steady music.                                                                               | 90 s: “No Steady yet. Your heart rate reads off from when you started. Moving on.”                                                            |
| 2    | Smile for about 20 s, without big laughs. Face reading must be on.                    | Good mood: a brighter moon, Keep it going music.                                                                            | 75 s: “No Good mood. It needs Steady plus a smile most of the time. Moving on.” With face reading off, the hint explains and skips.           |
| 3    | A stretch card appears by itself at about 3 min seated. Press Let's go and follow it. | Neck tilts and the card's tilt feedback (face reading on).                                                                  | 120 s: “No stretch card yet. Reminders come at most once a minute. Moving on.”                                                                |
| 4    | Do 40 s of squats off camera, then sit still.                                         | “Heart rate higher than when you started” building, then Stressed: amber, Calm down music switching right away.             | 180 s: “No Stressed. Your heart rate settled too fast. It would play Calm down.”                                                              |
| 5    | Press Let's go on the breathing card. Breathe with the moon.                          | The moon guides your breath; return to Steady as your heart rate drops.                                                     | 150 s: “Still settling. Ovra goes back to Steady once your heart rate drops.” Skipped unless Stressed was seen.                               |
| 6    | Do 60 s of jumping jacks, then sit and frown.                                         | Very stressed: red, a fade to Quiet, and a walk card. Heart rate must still clear the real bar; the frown only supports it. | 120 s: “No Very stressed (the hardest one). It would fade music to Quiet.” Without face reading, the longer Stressed route still applies.     |
| 7    | Step out of view for 20 s, then come back.                                            | “Couldn't see you · away in …”, a dimmed moon, paused music, then a return check.                                           | 120 s: “Ovra didn't see you leave. Away needs 15 s out of view. Moving on.” A box-less ghost can extend detection to 35 s (reliability §5.4). |
| 8    | Lean back and breathe slowly for 2 min. Tired may not appear.                         | Tired: dim moon, Pick me up music, stand-and-stretch card.                                                                  | 150 s: “No Tired. Resting barely lowers heart rate. It would play Pick me up.” An earlier Tired is acknowledged here.                         |
| 9    | Press End.                                                                            | Summary with mood timeline, moves and songs; open History afterwards. Both say “Demo session · shorter waits”.              | Final instruction; no mood to wait for. In the last 2 min, music is Wind down unless Very stressed.                                           |

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
| Hint / next-step delay                                          | No hints                                            | 25 s / 8 s                                    |

All overlays last one demo session in memory. They are restored on end and never written to your
settings. History stores only the demo flag with the usual labels and counts; no raw readings or
starting usual are saved. For the real experience, run a normal session while you work.
