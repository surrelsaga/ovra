# Ovra's rules

Every rule Ovra follows, in plain words, with the config name behind each number. State numbers
live in `src/main/state/config.ts`; demo overrides in `src/main/session/config.ts` (`demo.state`).
Demo mode uses the same signals and bars and only shortens waits.

## States

### How a reading is made

| Step | Normal | Demo | Config |
| --- | --- | --- | --- |
| Getting to know you: steady heart rate needed | 30 s | 30 s | `baselineMinPulseSec` |
| Longest wait for it (then Try again / Start anyway) | 180 s | 90 s | `calibrationMaxMs` (sensing) |
| Your "usual" keeps adjusting from calm checks for | 10 min | 2 min | `baselineRefineMin` |
| Any readable, not-stressed check also adjusts it for | off | 2 min | `baselineSettleMin` |
| One check looks at (continuous camera) | last 60 s, every 30 s | last 30 s, every 10 s | `continuousWindowSec`, `continuousUpdateSec` |
| One check (check-in camera, the default) | one 90 s check-in every 3/5/10 min | same | `checkinMs` (sensing), user setting |
| A check counts only with steady heart rate for at least | 10 s | 10 s | `windowMinPulseSec` |
| A held mood is forgotten after unreadable checks span | 3 min | 1 min | `noReadForgetMin` |

- **Your usual** is the median of your steady heart rate while getting to know you, then the median
  of that and each calm check (Steady, not close to Tired or Stressed) for the refine period. After
  that it's fixed for the session. It is never saved.
- **Heart rate decides.** Each check uses the median of its steady heart-rate readings, compared
  with your usual as a percentage.
- **HRV** (time between beats) can lower the Stressed bar or cancel Stressed. It needs a still
  minute, so it's usually missing.
- **Breathing** can only make Ovra more sure of Stressed. With the shrunk camera frame (the default)
  it is dropped entirely, because the chest isn't really in view. Talking in more than 10% of face
  frames (`talkingIgnoreBreathingFrac`) also drops it for that check.
- **Face** (only with face consent) can turn Steady into Good mood, help Very stressed, and soften
  the Tired bar with lots of blinking. It never makes a mood alone.
- **Almost counts:** a check within 3 points of the Stressed or Tired bar (`streakBandPct`) pauses
  the build-up instead of resetting it. A check between the bars ("a little higher/lower") keeps
  the current mood.
- **Confidence** (60% heart rate only, 90% with HRV, 70% of that on an unclear check) is shown in the
  dev monitor only. Nothing in music or reminders depends on it.

### Steady (`focused`)

| | |
| --- | --- |
| Signals | Heart rate only |
| Rule | Within ±8% of your usual (`focusedPulsePct`) |
| Hold | None: one check is enough, in both modes |
| What blocks it | A held Stressed or Tired (unless the check is clearly outside their near-miss band) |
| You see | Calm orb (cool white-blue, slow pulse); line: "Heart rate like when you started"; bubble "Nice and steady." |
| You hear | The activity's default: Steady for Focus, Reading and Creative; Pick me up for Everyday; Keep it going for Unwind |
| Reminders | Seated reminders only (neck, stand, walk), by activity |
| Known limits | Steady is also the fallback when a check is unclear and there's no mood yet, so after Ovra forgets a mood, an "a little higher" check shows Steady (a change is proposed, waiting for Daniel). A single Steady check that isn't close to their bars ends Stressed or Tired at once. |

### Good mood (`good`)

| | |
| --- | --- |
| Signals | Heart rate + face expressions (face consent only) |
| Rule | Steady, and smiling is the top expression in more than half of the face frames (`faceMajorityFrac`), with at least 10 s of face frames with expressions (`goodMinFaceSec`) |
| Hold | None, in both modes |
| What blocks it | Vitals-only consent; fewer than 10 s of expressions; heart rate outside ±8% |
| You see | Bright orb (warm white, soft sparkle); bubble "You seem in a good mood." |
| You hear | Keep it going (brighter songs) |
| Known limits | Presage publishes no accuracy data for expressions. Laughing moves the head, which can make the check unreadable (code 12) instead. "A little higher" checks keep Good mood. |

### Stressed (`tense`)

| | |
| --- | --- |
| Signals | Heart rate; HRV can back it or cancel it; breathing adds confidence only |
| Rule | Heart rate +15% or more above your usual (`tensePulsePct`), or +10% (`tenseBackedPulsePct`) when HRV is 15% below its usual (`tenseRmssdDropPct`) |
| Hold, continuous | 3 min of agreeing checks (`tenseHoldMin`); demo 45 s |
| Hold, check-ins | 2 check-ins in a row (`tenseHoldCheckins`) |
| What blocks it | HRV 15% above its usual (`tenseRmssdVetoPct`, "body says relaxed"); any readable check more than 3 points under the bar resets the build-up; unreadable checks pause it |
| You see | Uneasy orb (amber, faster pulse); line "Heart rate higher than when you started · 1 of 3 min" while building, then the minutes toward Very stressed; bubble "You seem stressed." |
| You hear | Calm down (calmer songs, from the next song; demo at once) |
| Reminders | First 5 min: breathe along. Later: neck and shoulders. 15 min Stressed or Very stressed: step outside |
| Known limits | Anything that raises heart rate looks the same: coffee, climbing stairs, talking, excitement. The first minute after walking back to the desk often reads high; the hold keeps it from counting. |

### Very stressed (`crashing`)

| | |
| --- | --- |
| Signals | A held Stressed, plus time or an upset face |
| Rule | Stressed held for 10 min (`crashingTenseMin`; demo 2 min), or Stressed held and the latest check is +20% (`crashingPulsePct`) with angry, sad or disgust as the top expression in most face frames |
| What blocks it | Everything that blocks Stressed; it can never come straight from Steady |
| You see | Stormy orb (orange-red edge, flickery pulse); bubble "You seem very stressed. Let's slow down." |
| You hear | Quiet: fades down, skips to a calm song right away, fades back up |
| Reminders | A short walk; step outside after 15 min |
| Known limits | The upset-face path has no minimum amount of face time (Good mood needs 10 s). It still needs a held Stressed first. |

### Tired (`low`)

| | |
| --- | --- |
| Signals | Heart rate; blinking can soften the bar |
| Rule | Heart rate 8% or more below your usual (`lowPulsePct`), or 4% below (`lowBlinkPulsePct`) with blinking 50% above its usual (`lowBlinkPct`, face consent only) |
| Hold, continuous | 2 min of agreeing checks (`lowHoldMin`); demo 60 s |
| Hold, check-ins | 1 check-in (`lowHoldCheckins`): a single 90 s check-in is enough |
| What blocks it | Any readable check more than 3 points above the bar (or a Stressed check) resets the build-up; unreadable checks pause it. Breathing is ignored |
| You see | Dim orb (grey-blue, low, slow); line "Heart rate lower than when you started"; bubble "You seem tired." |
| You hear | Pick me up (brighter songs) |
| Reminders | Stand and stretch |
| Known limits | Heart rate drifts down over a long still session (sitting, evening). Your usual is learned in the first 10 minutes, which in Daniel's long session read a little higher, so late in a long session a normal settled heart rate can sit right at the Tired bar and flip between Tired and Steady every few minutes (Job 29 replay). In check-in mode one check-in decides (a change is proposed, waiting for Daniel). |

### Couldn't see you (no read)

| | |
| --- | --- |
| Signals | Fewer than 10 s of steady heart rate in the check (`windowMinPulseSec`) |
| What it does | Nothing changes: the mood stays, any build-up pauses (no time added, nothing reset), music keeps its choice |
| You see | The orb keeps its look; line "Couldn't see you clearly · no change". If a second face was in view for at least 3 s of the check (SDK code 2, `noReadFacesSec`): "Another face in view · no change" |
| After a while | When unreadable checks span 3 min (demo 1 min), Stressed, Very stressed and Tired are forgotten (Steady and Good mood stay). Line: "Lost track of you for a bit · checking again" until a readable check. Music keeps its last choice |
| Common causes | Moving, laughing or typing hard (code 12), turning away (code 17), standing up (code 15), a second face (code 2), low frame rate (code 11) |
| Known limits | The heart-rate reading needs ~12 s to come back after it drops, so a few seconds of disturbance can cost a whole check. A forgotten build-up isn't cleared: one fresh Stressed check right after can bring Stressed back (a change is proposed, waiting for Daniel) |

### Away (`away`)

| | |
| --- | --- |
| Signals | Fresh SDK frames with face evidence: a face box near where you sat at the start, chest-not-visible (code 7), or a steady heart rate / face code on a frame without a box |
| Rule, continuous | Away after 20 s without evidence (`awayNoFaceSec`; demo 15 s). Code 1 (no face) clears evidence at once; a frame with two faces (code 2) counts only with a steady heart rate. A face box off your seat cancels that frame. With face consent, evidence without any face box keeps you present for at most 20 s after the last box (`presenceNoShapeSec`) |
| Rule, check-ins | You press "Okay, going" and "I'm back" |
| Back | A steady heart rate, or a face in 3 of the last 4 seconds (`wakeFaceSec`, `wakeWindowSec`) |
| Never counts | Camera paused, camera off between check-ins, SDK reconnecting ("Camera reconnecting"), repeated (frozen) frames: a frozen picture adds no evidence, so it ends in Away |
| You see | Eclipsed orb (soft cyan crescent) with time away; "Couldn't see you · away in N s" from 5 s without evidence (`whyAwaySoonSec`) |
| You hear | Music pauses, resumes on return; a 30 s return check (demo 20 s) runs on the same camera stream |
| Known limits | A face-like shape at your seat (a headrest, a photo) can keep you present. Without face consent, codes and heart rate alone count. |

## Exercises and timing

_Placeholder: owned by Job 30._

## How careful is the reading?

A webcam can't promise accurate heart rate or moods. What Ovra can promise is care: it names a mood
only after minutes of agreement, says when it can't see you instead of guessing, and a bad stretch
of readings only pauses things. Job 29 checked this against three real monitor logs (a 45-minute
normal session and two demo runs) and the test videos. In plain words:

- **The heart-rate signal itself was good when you sat normally.** In the 45-minute session the
  camera's OK code held 96–100% of the time and almost every check was readable (1 unreadable of 89).
- **No false Stressed or Very stressed** in any log. Short heart-rate rises (right after getting
  to know you, after squats in the demos) were shown as "a little higher" and never held long enough.
- **No false Away** in the 45-minute session; standing up for a stretch came close (about 13 s
  without a face) but stayed present. Real breaks were picked up in the demos.
- **Unreadable checks did what they should:** in the demo recording more than three quarters of the
  checks were unreadable while moving around, and Ovra kept the mood and said so instead of guessing.
- **The main cause of silent stretches was a second face** (code 2, "Only one face is allowed").
  Even a few such frames stop heart-rate readings for 10–60 s: steady readings dropped from almost
  every 10 s stretch to about one in four or fewer. Ovra now says "Another face in view".
- **Doubtful: Tired late in the 45-minute session.** From minute 32 Ovra said Tired for about 8 of
  the last 13 minutes, in three spells with Steady in between. Heart rate was right at the Tired
  bar against a usual that had been learned in the slightly higher first 10 minutes; against the
  very first reading it was only a little lower. It was close to midnight, so Daniel may really have
  been tired, but the evidence is thin. A fix is proposed and waits for Daniel's call.
- **The test videos** are short (1.5–3 min), so under normal holds they can only show Steady or
  "couldn't see you"; they're useful for checking the pipeline, not mood accuracy.

**Workarounds you can use:** sit so only your face is in view (no one behind you, no photos or
reflections), keep the lighting steady, and judge Ovra on a session of 45 minutes or more, not a
quick try-out.
