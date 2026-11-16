# How Ovra decides

A plain review of every rule and trigger, written 2026-11-15 for Daniel and the DEV post.
The app uses the plain words below. Code words and saved values stay unchanged.
Numbers include Job 7: the stricter Stressed rule and the starting readings that keep adjusting.

## 1. What Ovra reads

- **Heart rate** (pulse), from tiny colour changes in your face. This is the main signal.
- **Changes in the time between heartbeats**. Backup only, and it needs a still minute.
- **Breathing rate.** The least reliable signal: it needs your chest in view, decent light and no very dark
  clothes. It can only make Ovra _more sure_; it never decides anything.
- **Face:** smile or frown, blinks, head tilt. It supports a call, but never decides one alone.

Nothing is saved: no video, no pictures, no heart numbers. Only the mood timeline ("Steady from 12:01")
is kept in your history.

## 2. "When you started"

1. **While getting to know you** Ovra takes 30 seconds of steady heart rate while you sit normally. That
   is your starting "usual".
2. **For the next 10 minutes** your usual keeps adjusting from calm minutes only. A 30-second snapshot
   reads low because you're sitting extra still, so a few normal minutes correct it. Stressed or tired
   minutes are never learned, so stress can't become "normal".
3. **After that it's fixed** for the rest of the session. Every session starts fresh, and nothing carries over.

**Demo only:** the first **2 minutes after your usual exists** also learn from readable checks that
look low, near-low or unclear. Checks that look Stressed or almost Stressed never teach it, and
unreadable checks never count. This lets a short start that read too high come back down. The tradeoff:
a real tired spell during those first 2 minutes may be learned as usual. After 2 minutes the usual is
fixed in demo. Normal mode has **no settle period** and keeps the calm-only 10-minute rule above.
The heart-rate bars, backup rules and minimum readable seconds are the same in both modes.

If getting to know you doesn't reach 30 s, you choose **Try again** or **Start anyway**. Start anyway learns your
usual from the first 30 s of steady heart rate during the session.

## 3. How often Ovra looks

- **Each check looks at:** the last minute.
- **How often:** every 30 seconds. Demo mode: the last 30 s, every 10 s.
- **When a check doesn't count:** if it has less than 10 seconds of steady heart rate (you moved a lot,
  turned away, or the camera couldn't see you well), it's a **"Couldn't see you"**. Any build-up pauses,
  and music keeps its last choice. Short gaps keep the mood too.
- **When Ovra forgets:** after trailing no-read windows span **3 min** (**1 min in demo**), Stressed,
  Very stressed or Tired becomes unknown. Steady and Good mood stay. This measures the last no-read
  window's end minus the first trailing no-read window's start, not time since the last good reading:
  waiting between check-ins doesn't trigger it by itself. One failed normal check-in keeps the mood;
  two in a row can forget it. No new mood is guessed from missing readings.

## 4. The moods

| Plain word           | Code word  | When                                                                                                                                            | How long before Ovra says so   |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Steady**           | focused    | heart rate within 8% of your usual                                                                                                              | at once                        |
| **Good mood**        | good       | Steady, plus smiling most of the time (needs 10 s of face)                                                                                      | at once                        |
| **Stressed**         | tense      | heart rate **15% above** usual, or **10% above** if your time between heartbeats also changes. A clear change in the other direction cancels it | **3 min** in a row (demo 45 s) |
| **Very stressed**    | crashing   | Stressed for **10 min**, or heart rate **20% above** usual with a frowning/upset face                                                           | 10 min (demo 2 min)            |
| **Tired**            | low        | heart rate **8% below** usual, or blinking a lot more with heart rate a little below (4%)                                                       | **2 min** in a row (demo 60 s) |
| **Couldn't see you** | no reading | not enough steady signal yet                                                                                                                    | —                              |
| **Away**             | away       | see §5                                                                                                                                          | 20 s (demo 15 s)               |

Things that keep it fair:

- **Almost counts:** a check that _almost_ meets the bar (within 3%) pauses the countdown instead of resetting it.
- **One odd check isn't enough:** a single check never changes the mood on its own. It must hold.
- **Unclear checks:** when a check is unclear, the previous mood stays.

The demo holds outlast its 30 s window so a short dip cannot confirm Tired by itself. Allow about
16 minutes for the full demo walk-through; the rest hint allows 150 s for Tired to appear.

## 5. Away

- **Present:** while the camera sees a face, even one it can't measure well (chest not in view,
  moving, face too high or low, turned away).
- **Away:** after 20 s of no face, or if the camera picture freezes.
- **Back:** a face for 3 of 4 seconds, or a heart reading.
- **The SDK keeps running** while you're away, so it doesn't need to warm up again.
- **Fixed, to confirm in a real room (decision 50):** a face box off your seat no longer counts, and without any face shape (except chest-out-of-view) presence lasts at most 20 s. Away never firing over 20+ min in Daniel's earlier test should be gone.
  camera kept reporting something as a face. To be checked with the empty-chair test, then fixed.

## 6. What happens for each mood

| Mood                                 | Music                                                                                                 | Break reminder (at most one every 20 min)                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Couldn't see you                     | Steady before the first mood; after a dropout, keeps its last choice                                  | reminders after sitting only                                               |
| Steady                               | your activity's default (Focus/Reading/Creative: steady; Everyday: pick me up; Unwind: keep it going) | after 45 min seated: neck stretch; 60 min: stand and stretch; 90 min: walk |
| Good mood                            | Keep it going (brighter songs)                                                                        | reminders after sitting only                                               |
| Stressed                             | Calm down (calmer songs, from the next song)                                                          | under 5 min stressed: breathe along. Later: neck and shoulders             |
| Very stressed                        | Quiet (fade down, skip right away to a calm song, fade back up)                                       | a short walk                                                               |
| Stressed or very stressed for 15 min | —                                                                                                     | step outside                                                               |
| Tired                                | Pick me up (brighter songs)                                                                           | stand and stretch                                                          |
| Last 10 min of the session           | Wind down (unless very stressed)                                                                      | —                                                                          |

Music rules:

- **How often:** the music changes direction at most once every 3 minutes. The first real mood can switch at once.
- **"Leave my music alone":** turns all of this off.
- **What plays:** songs come from your playlists, never the same song twice in a session.
- **How it plays without popping Spotify up:** asking Spotify for a specific song always brings its
  window to the front; skipping never does. So Ovra starts one of your playlists at the start (the
  one with the most songs that fit, shuffle on, while Ovra's own window is in front) and then steers
  inside it: when a new song doesn't fit, it skips to the next one, with the volume turned down
  during the skips (at most 8 in a row). Ads are left alone. Only when the playlist has nothing
  fitting left, or 8 skips didn't find one, does Ovra change playlist; Spotify then flashes up for a
  moment and Ovra puts your app straight back. That happens at most once every 3 minutes. Your
  shuffle and repeat settings come back when the session ends.

**Demo timings:** music winds down only in the last **2 minutes**, and every music direction change
is acted on right away (skips if the song doesn't fit; only Quiet fades). Changes are still at least 20 seconds apart. Break
reminders are at least 1 minute apart, and **1 more min** puts one off for 1 minute. The seated neck
stretch comes after 3 minutes; seated stand/walk waits are 60 minutes, so Tired and Very stressed
can show their own reminders during the tour. Move lengths stay the same. The ordered tour gives
each attempt a time limit and an honest fallback; early moods are remembered for their own step.
History and the summary mark these sessions **Demo session · shorter waits**.

## 7. What changed today and why

| Change                                                             | Why                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Heart rate decides; breathing only makes Ovra more sure            | breathing drops out most of the time on a laptop camera                     |
| Stressed needs 15% (10% with changes between heartbeats as backup) | 10% from heart rate alone fired too often in Daniel's 42-min Unwind session |
| Your usual keeps adjusting for 10 minutes                          | a 30-second start reads low                                                 |
| "Couldn't see you" pauses instead of resetting                     | moving or laughing shouldn't erase or invent a mood                         |
| Seen-but-not-measurable counts as present                          | slouching (chest out of view) used to look like leaving                     |

## 8. Words on screen

Music choices say **Pick me up**, **Calm down**, **Quiet**, **Keep it going**, **Steady** and
**Wind down**. The music library groups are **Calm**, **Steady**, **Pick me up** and **Not sure yet**.

The line below the moon says **"Heart rate higher than when you started"**,
**"Heart rate lower than when you started"** or **"Heart rate like when you started"**.
When the camera cannot get a clear reading it says **"Couldn't see you clearly · no change"**.
After forgetting a mood it says **"Lost track of you for a bit · checking again"** until the next real reading.
These are descriptions for everyday wellbeing, not diagnoses.
