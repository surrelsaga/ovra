# Demo mode (judge reference)

Demo mode is a switch on the New session screen. Allow about 16 minutes for the full walk-through,
with the camera on the whole time. Ovra still reads your real heart rate and breathing with the same SDK and the **same rules**.
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

| What                                                                            | Real use                              | Demo                     |
| ------------------------------------------------------------------------------- | ------------------------------------- | ------------------------ |
| Rules (how far from your starting heart rate counts as Stressed, Tired, Steady) | as tuned                              | **the same**             |
| Getting to know you                                                             | 30 s of steady heart rate (cap 180 s) | The same 30 s (cap 90 s) |
| Reading window / update (camera always on)                                      | 60 s / every 30 s                     | 30 s / every 10 s        |
| Sustained change before Stressed or Tired                                       | 3 min (Stressed), 2 min (Tired)       | 45 s (Stressed), 60 s (Tired) |
| No readable signal before forgetting Stressed, Very stressed or Tired            | 3 min                                | 1 min                    |
| Stressed before Very stressed                                                   | 10 min                                | 2 min                    |
| No one in view before away                                                      | 20 s                                  | 15 s                     |
| Seeing how you feel after a break                                               | 30 s                                  | 20 s                     |
| Music changes at most every                                                     | 3 min                                 | 20 s                     |
| Break reminders at most every                                                   | 20 min                                | 1 min                    |
| Reminders after sitting (neck / stand / walk)                                   | 45 / 60 / 90 min                      | 3 / 4 / 5 min            |

## The 9 steps

| #   | Do this                                                                                                            | You should see                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Get to know you:** sit normally for 30 s of steady heart rate.                                                   | The moon fills as it gets to know you. Hint: "work normally for a minute."                                                                                            |
| 2   | **Work normally** for a minute.                                                                                    | The orb shows Steady, music on Steady. Hint: "smile or laugh at something funny."                                                                                     |
| 3   | **Smile or laugh** (a funny video works). Needs expressions turned on.                                             | Good mood: the orb brightens. Hint: "try 40 s of squats off camera, then sit down."                                                                                   |
| 4   | **Raise your heart rate:** about 40 s of squats or jumping jacks next to the desk, then sit back, still and quiet. | The why line under the orb says "Heart rate higher than when you started" and fills. Then Stressed: amber orb, music changes to Calm down.                            |
| 5   | **Breathe along** with the orb when the reminder appears.                                                          | The orb grows and shrinks with your breath. As your heart rate comes back down, Ovra returns to Steady. Hint: "keep moving for about 2 minutes to see Very stressed." |
| 6   | **Keep moving for about 2 min** (keep moving, or stay worked up).                                                  | Stressed keeps building ("1 of 2 min"), then Very stressed: orange-red, a short walk suggested. Hint: "step away from the camera for 20 s."                           |
| 7   | **Step away** from the camera for about 20 s, then come back.                                                      | "Couldn't see you · away in …", then the eclipsed away orb and paused music. Coming back starts a short check after your break.                                       |
| 8   | **Breathe slowly** (about 6 a minute) and blink often.                                                             | Tired: dim orb, music on Pick me up. **This mood might not appear**: slow breathing barely changes your heart rate. After 2½ min the next hint shows anyway.     |
| 9   | **Wind down** and let the session end (or press end).                                                              | The summary: mood timeline, moves, songs. Nothing about your heart rate or breathing is stored.                                                                       |

If a later state shows up early (for example Very stressed right after the squats), the hints skip ahead.

The holds now outlast the 30 s demo window, so a short dip cannot confirm Tired by itself. A sustained
change can take about 100 s after squats to show Stressed, or 100–120 s of rest to show Tired.
The session preset is still 15 minutes; the full walk-through may need longer and a mood may not appear.

After a run of no-read windows lasting 1 min (3 min in real use), Stressed, Very stressed and Tired
become unknown. The span runs from the first trailing no-read window's start to the last one's end,
not from the last good reading, so time waiting for the next check-in doesn't trigger it by itself.
Steady and Good mood stay as they are. The why line says **"Lost track of you for a bit · checking again"**
until the next real reading; music keeps its last choice meanwhile.

The why line shows only while something is changing (a change building, the away countdown, a notable
signal), and on hover. It uses plain words and coarse time steps, never heart rate or breathing numbers, and
it's never saved.

## Real use

Real use is slower and more authentic: 30 s of steady heart rate to get to know you, about 3 minutes of a sustained change before
Stressed (2 minutes for Tired), 10 minutes of Stressed before Very stressed, music changes at most every 3 minutes, break reminders at
most every 20 minutes, and reminders after sitting at 45, 60 and 90 minutes. Real moods build over minutes, and Ovra
shouldn't react to a single spike. Demo mode uses 45 s for Stressed and 60 s for Tired, compressing the waits so you can try every state in about 16
minutes; it works the same as real use, it just reacts sooner.
