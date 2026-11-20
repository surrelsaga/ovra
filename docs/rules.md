# Ovra's rules

The plain rules behind what Ovra shows. Numbers live in config files (`src/main/state/config.ts`,
`src/main/moves/config.ts`); demo mode only shortens waits (decision 28).

## States

_Owned by Job 29. Placeholder._

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

**Demo mode** (Job 31): only the tour shows exercise cards, each exactly once at a fixed step (neck
3, breathe 5, walk 6, step outside 7, stand 8). Timed reminders, mood suggestions and the return-check
breathing round are off; the rules above don't run. The walk is a 15 s at-the-desk demo version and
step outside a ~20 s away and back. See `docs/demo.md`.
