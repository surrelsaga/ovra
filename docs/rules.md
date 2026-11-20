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
  that it's fixed for the session. Tired uses the lower of the starting usual and this adjusted usual,
  so adjusting upward cannot turn a normal settled heart rate into Tired. Both stay in memory only.
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
  the current mood. With no mood yet, unclear checks and unfinished holds stay unknown; only a
  real near-usual check can name Steady. Music stays neutral before the first mood and keeps its
  last choice after a mood is forgotten.
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
| Known limits | A single Steady check that isn't close to their bars ends Stressed or Tired at once. Unclear checks never supply Steady as a fallback. |

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
| What blocks it | HRV 15% above its usual (`tenseRmssdVetoPct`, "body says relaxed"); any readable check more than 3 points under the bar resets the build-up; unreadable checks pause it, then clear it at the forget span |
| You see | Uneasy orb (amber, faster pulse); line "Heart rate higher than when you started · 1 of 3 min" while building, then the minutes toward Very stressed; bubble "You seem stressed." |
| You hear | Calm down (calmer songs, from the next song; demo at once) |
| Reminders | First 5 min: breathe along. Later: neck and shoulders. 15 min Stressed or Very stressed: step outside |
| Known limits | Anything that raises heart rate looks the same: coffee, climbing stairs, talking, excitement. The first minute after walking back to the desk often reads high; the hold keeps it from counting. |

### Very stressed (`crashing`)

| | |
| --- | --- |
| Signals | A held Stressed, plus time or an upset face |
| Rule | Stressed held for 10 min (`crashingTenseMin`; demo 2 min), or Stressed held and the latest check is +20% (`crashingPulsePct`) with angry, sad or disgust as the top expression in most face frames, with at least 10 s of expression frames (`goodMinFaceSec`) |
| What blocks it | Everything that blocks Stressed; it can never come straight from Steady |
| You see | Stormy orb (orange-red edge, flickery pulse); bubble "You seem very stressed. Let's slow down." |
| You hear | Quiet: fades down, skips to a calm song right away, fades back up |
| Reminders | A short walk; step outside after 15 min |
| Known limits | Presage publishes no accuracy data for expressions. The upset-face path needs a held Stressed and at least 10 s of expression frames, just like Good mood. |

### Tired (`low`)

| | |
| --- | --- |
| Signals | Heart rate; blinking can soften the bar |
| Rule | Heart rate 8% or more below the lower of your starting and adjusted usual (`lowPulsePct`), or 4% below that same usual (`lowBlinkPulsePct`) with blinking 50% above its usual (`lowBlinkPct`, face consent only). The near-miss band uses that same lower usual |
| Hold, continuous | 2 min of agreeing checks (`lowHoldMin`); demo 60 s |
| Hold, check-ins | 2 agreeing check-ins (`lowHoldCheckins`), like Stressed |
| What blocks it | Any readable check more than 3 points above the bar (or a Stressed check) resets the build-up; unreadable checks pause it, then clear it at the forget span. Breathing is ignored |
| You see | Dim orb (grey-blue, low, slow); line "Heart rate lower than when you started"; bubble "You seem tired." |
| You hear | Pick me up (brighter songs) |
| Reminders | Stand and stretch |
| Known limits | Heart rate can drift down during a long still session (sitting, evening); a low heart rate alone cannot prove tiredness. The lower usual keeps upward refinement from making Tired easier to reach; Daniel still needs to check it in a long session. |

### Couldn't see you (no read)

| | |
| --- | --- |
| Signals | Fewer than 10 s of steady heart rate in the check (`windowMinPulseSec`) |
| What it does | Short gaps keep the mood and pause any build-up (no time added), music keeps its choice |
| You see | The orb keeps its look; line "Couldn't see you clearly · no change". If a second face was in view for at least 3 s of the check (SDK code 2, `noReadFacesSec`): "Another face in view · no change" |
| After a while | When unreadable checks span 3 min (demo 1 min), Stressed, Very stressed and Tired are forgotten and their build-up clears (Steady and Good mood stay). Fresh checks must complete the hold again. Line: "Lost track of you for a bit · checking again" until a readable check. Music keeps its last choice |
| Common causes | Moving, laughing or typing hard (code 12), turning away (code 17), standing up (code 15), a second face (code 2), low frame rate (code 11) |
| Known limits | The heart-rate reading needs ~12 s to come back after it drops, so a few seconds of disturbance can cost a whole check. Camera-off time before the first unreadable check does not count toward forgetting |

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

Normal mode. Seated waits are per activity: **Focus / Reading** first, then **Creative / Everyday /
Unwind**. "Sitting" means time in front of the camera without a break of a minute or more (or session
time without the camera). Research for every length is in `docs/research.md` §3 and §4.

| Exercise | Triggered by | Length and steps | How Ovra checks you did it | Research |
|---|---|---|---|---|
| **Breathe along** | Stressed, in the first 5 min of the stress | 90 s: settle 10 s, then breathe with the moon 80 s (in as it grows, out as it shrinks, 10 s a breath = 6 a minute) | breathing rate dropping 10% from the start of the exercise, when breathing can be read; otherwise just the timer | 6 breaths/min; 1–5 min sessions help (§4) |
| **Neck and shoulder stretch** | Stressed for 5+ min, or **timed:** 30 / 25 min sitting | 90 s: tilt left, right, left, right (12 s each), shoulder rolls 27 s, look up 15 s | head tilt seen from the face (face reading on), otherwise not checked | 10–30 s holds, 10–15 s neck tilts (§4); short desk breaks for neck and shoulders (§3) |
| **Stand and stretch** | Tired, or **timed:** 60 / 50 min sitting | 2 min: stand up 15 s, reach up 35 s, side bend 40 s, bend forward 30 s | your face rises or moves away from where you sat (face reading on) | stand every 30 min guidance (§3); 10–30 s holds (§4) |
| **Walk and get water** | Very stressed, or **timed:** 90 / 75 min sitting | 5 min: get up, walk a slow lap, refill water | you leave and come back (camera sees it in whole-session mode, or you press "Okay, going" / "I'm back"), then a 30 s return check | 2–5 min walks; micro-breaks ≤10 min (§3, §4) |
| **Step outside** | Stressed or very stressed for 15+ min | 10 min: get up, step outside and look far away | same as the walk, plus the return check | 10 min outside helps mood and stress (§4) |
| **Breathing round** | After a break, if the return check still looks stressed (you choose it) | 60 s of breathing with the moon | as Breathe along | about a minute helped mood (§4) |

Every card says it gently: tilts "Gently, no pulling", shoulder rolls "Stop if anything hurts", bending
forward "only as far as feels easy". Suggestions, never medical advice.

**What blocks or delays a suggestion**
- **The shared gap:** at most one suggestion every **20 min** (Settings → nudge frequency), timed and mood
  ones alike.
- **A card is already open** (a suggestion, an exercise, a break or the return check): nothing new shows.
- **Away or on a break:** nothing shows; coming back after a minute or more starts a new sitting stretch,
  so all timed reminders start over.
- **Mood ones need the camera** and a mood the state engine has already held (Stressed 3 min, Tired 2 min,
  Very stressed 10 min). Without the camera only timed reminders run.
- **"5 more min"** brings the same card back once after 5 minutes, even inside the 20-min gap.
- **Mood order when several apply:** step outside → walk (very stressed) → timed walk → breathe → stand
  (tired) → timed stand → neck (stressed) → timed neck.

### How suggestions avoid piling up

1. **One gap for everything:** a timed reminder and a mood suggestion are never less than 20 minutes apart.
2. **Each timed reminder once per sitting stretch,** then it waits a full threshold again, whether you did
   it, skipped it or ignored it.
3. **A mood exercise counts as the matching timed reminder:** stand-and-stretch for Tired resets the stand
   reminder, the walk for Very stressed (or stepping outside) resets the walk reminder, the neck stretch
   for Stressed resets the neck reminder. Breathe along has no timed twin.
4. **One suggestion per mood episode:** once Stressed, Very stressed or Tired has had its suggestion, it
   gets no other until that mood has been gone for **10 minutes**. A mood that flickers off and back can't
   repeat it. Long stress may add one "step outside" on top, once.
5. **Only held moods count:** a short spike never reaches the exercise rules, because the state engine
   only reports a mood after its hold.

So a misread mood costs at most one card per episode, and a long stress at most two (breathe, then step
outside 20+ minutes later).

**Demo mode** keeps its own behaviour (decision 70): timed reminders are off, the gap is 1 minute, the
one-per-episode rule is off, and the tour shows its step cards.

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
  been tired, but the evidence is thin. Job 33 now judges Tired against the lower of the starting
  and adjusted usual, and requires two check-ins in check-in mode; Daniel still needs to test a long session.
- **The test videos** are short (1.5–3 min), so under normal holds they can only show Steady or
  "couldn't see you"; they're useful for checking the pipeline, not mood accuracy.

**Workarounds you can use:** sit so only your face is in view (no one behind you, no photos or
reflections), keep the lighting steady, and judge Ovra on a session of 45 minutes or more, not a
quick try-out.
