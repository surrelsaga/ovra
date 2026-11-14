# Demo mode (judge reference)

Demo mode is a switch on the New session screen. It runs a 15 minute session with the camera on the
whole time. Ovra still reads your real pulse and breathing with the same SDK and the **same thresholds**.
The only change is how long it waits before it reacts. Nothing is scripted and you can't force a mood: every
state below only shows up if your body actually changes.

On screen, a demo session looks the same as a real one, with three differences:

- a small **Demo** badge on the orb,
- shorter waits,
- a one-line next-step hint in the orb's speech bubble, starting with "Demo:". Each hint shows only after
  the previous state really happened.

The demo timings live in memory for that one session. They are never saved to your settings, and the next
normal session uses the normal timings.

## Real vs demo timings

| What | Real use | Demo |
| --- | --- | --- |
| Thresholds (how far from your usual counts as tense, low, steady) | as tuned | **the same** |
| Calibration | 90 s (cap 180 s), 5 steady pulse readings over 15 s | 45 s (cap 120 s), 10 steady pulse readings over 30 s |
| Reading window / update (camera always on) | 60 s / every 30 s | 30 s / every 10 s |
| Sustained change before tense or low | 3 min (tense), 2 min (low) | 30 s |
| Tense before crashing out | 10 min | 2 min |
| No one in view before away | 20 s | 15 s |
| Return check after a break | 30 s | 20 s |
| Music changes at most every | 3 min | 20 s |
| Nudges at most every | 20 min | 1 min |
| Seated nudges (neck / stand / walk) | 45 / 60 / 90 min | 3 / 4 / 5 min |

## The 9 steps

| # | Do this | You should see |
| --- | --- | --- |
| 1 | **Calibrate:** sit still and quiet for about 45 s. | The moon fills as it gets to know you. Hint: "work normally for a minute." |
| 2 | **Work normally** for a minute. | The orb settles on calm, music on Focus. Hint: "smile or laugh at something funny." |
| 3 | **Smile or laugh** (a funny video works). Needs face analysis turned on. | Good mood: the orb brightens. Hint: "try 40 s of squats off camera, then sit down." |
| 4 | **Get your pulse up:** about 40 s of squats or jumping jacks next to the desk, then sit back, still and quiet. | The why line under the orb says "Pulse above your usual" and fills. Then tense: amber orb, music eases to Calm. |
| 5 | **Breathe along** with the orb when the nudge appears. | The orb grows and shrinks with your breath. As your pulse comes back down, Ovra returns to focused. Hint: "push harder for about 2 minutes." |
| 6 | **Push harder for about 2 min** (keep moving, or stay worked up). | Tense keeps building ("1 of 2 min"), then crashing out: orange-red, a short walk suggested. Hint: "step away from the camera for 20 s." |
| 7 | **Step away** from the camera for about 20 s, then come back. | "Can't see you · away in …", then the eclipsed away orb and paused music. Coming back starts a short return check. |
| 8 | **Breathe slowly** (about 6 a minute) and blink often. | Low energy: dim orb, brighter music. **This one may not trigger**: slow breathing barely moves the pulse. After about 2 min the next hint shows anyway. |
| 9 | **Wind down** and let the session end (or press end). | The summary: mood timeline, moves, songs. Nothing about your vitals is stored. |

If a later state shows up early (for example crashing out right after the squats), the hints skip ahead.

The why line shows only while something is changing (a hold building, the away countdown, a notable
signal), and on hover. It uses plain words and coarse time steps, never pulse or breathing numbers, and
it's never saved.

## Real use

Real use is slower and more authentic: a 90 s calibration, about 3 minutes of a sustained change before
tense or low, 10 minutes of tense before crashing out, music changes at most every 3 minutes, nudges at
most every 20 minutes, and seated nudges at 45, 60 and 90 minutes. Real moods build over minutes, and Ovra
shouldn't react to a single spike. Demo mode compresses those waits so you can see every state in about 15
minutes; it works the same as real use, it just reacts sooner.
