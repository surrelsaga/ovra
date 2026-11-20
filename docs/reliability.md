# Reliability: getting the most out of a camera-based SDK

A step back, taken on 2026-11-14 after Daniel's first long live test. This note explains why Ovra's
readings drop out, which approaches we weighed, what we chose, and the new state rules ("formulas").
It is written so it can feed the DEV post directly.

## 1. The honest starting point

Presage SmartSpectra reads vitals from an ordinary webcam:

| Signal | How the SDK gets it | Warm-up | "Stable" when confidence ≥ |
|---|---|---|---|
| Pulse | tiny skin-colour changes on the face (rPPG) | ~12 s | 40 (about ±3 bpm) |
| Breathing rate | upper-chest movement | ~30 s | 45 (about ±1 breath/min) |
| HRV (RMSSD) | timing between individual beats | ~60 s | 50 (about ±5 ms) |
| Face (expressions, blinks, head roll) | face landmarks | instant | n/a |

**Breathing is the least reliable of the three.** Presage's docs say it needs the upper chest in view
and a still camera, and can still fail with the chest visible if clothing is very dark or the lighting
is poor. So Ovra leans on breathing as little as it reasonably can: it may add confidence, but it
never decides or blocks a situation on its own.

Presage's own guidance (measurement-quality and model-card pages) asks for even front lighting, the
face centred and facing the camera, the **upper chest in view**, a still camera and a still person. A
clinical or research setup can demand all of that. Ovra can't: it is a calm companion for people who
are working, slouching, reading, typing, leaning in and drinking coffee. Nobody should have to hold a
posture to listen to music.

So none of what follows is a bug in the SDK or in our code. It's the physics of reading a heartbeat
through a laptop camera. The job is to **adapt**: take what the SDK gives, never invent what it
doesn't, and fail gracefully.

## 2. The two head-scratchers: code 7 and code 12

The SDK sends a live status code with every frame. Code 0 (`kOk`) is the only one that yields vitals.
Two codes caused most of our trouble.

### Code 7: `ChestNotVisible`

- **What it means.** The SDK wants the upper chest in frame for breathing. Normal laptop framing (face
  fills the frame, camera at eye level, desk below) often cuts it off.
- **What it does.** In our logs, during code 7 the SDK still reported a face object 100% of the time
  but **landmarks 0% and no pulse**. So one breathing requirement switches off *every* reading,
  including pulse, which comes from the face and doesn't need the chest at all.
- **How it broke Ovra.**
  - No pulse and no landmarks looked exactly like "nobody there", so Ovra marked a seated person
    **away** in loops (Daniel's session 1 at 12:41, session 2 at 12:49:25).
  - Each false return restarted the SDK, which reset its 12/30/60 s warm-ups and lost more data.
  - Windows had too few pulse readings, so the situation stayed "unknown".
- **Why it's head-scratching.** Our test videos hit the same check. We fixed those by padding the frame
  (decision 7): drawing the video smaller inside a 1280×720 canvas made the SDK's chest check pass.
  The live camera has no such adapter, and the honest fix (sit further back, tilt the screen) is
  exactly the posture demand we want to avoid.

### Code 12: `ExcessiveMotion`

- **What it means.** The head or camera moved too much for the colour signal to be trusted. Typing
  hard, laughing, turning to a second screen, or a wobbly laptop hinge all trigger it.
- **What it does.** Pulse drops out while it lasts, and the SDK's rolling windows have to refill
  afterwards (Daniel's session 2: pulse gaps during code 12).
- **How it broke Ovra.** Gaps reset mood holds. A tense build-up of 2½ minutes could be wiped by
  20 s of laughing. Short gaps could also count toward away.
- **Why it's head-scratching.** Motion is a normal part of working. We can't ask people to sit still,
  and we can't use readings the SDK itself says are unreliable.

### Other evidence from the live test (2026-11-14, `npm run dev:monitor`)

- **Session 1 (demo, 15 min).** Calibration failed with "29 steady pulse readings over 25 s, need 10 over
  30 s". Demo had a *stricter* span than real mode (30 s vs 15 s) but less time (45 s window), so it
  ran the whole session with no baseline. On top of that, a 12–20 s frame-timestamp gap produced about
  300 dropped-frame warnings, and music picked Boost during calibration before switching to Calm with
  no mood known.
- **Session 2 (real, 45 min).** Calibration passed in about 94 s, then hit the same code 7 false away
  and code 12 gaps.
- **Throughput.** The camera runs at 30 fps, and the SDK sends one result per frame, each a rolling
  average. We forward 4 per second. Most results were codes 7, 12, 15, 16 and 17, so vitals read 0 most of the time.

## 3. Approaches we weighed

| # | Approach | Advantage | Tradeoff | Verdict |
|---|---|---|---|---|
| 1 | **Strict positioning throughout:** keep asking the user to fix framing | Best data | Nags. Wrong for a chill app. People stop using it | Rejected |
| 2 | **Strict once, relaxed after:** one short framing check at start (live preview until code 0 holds ~3 s, with Skip), then no posture demands | Good start, no nagging | Only fixes framing at the start; people drift later | **Chosen** |
| 3 | **Looser rules:** pulse alone can decide; breathing and HRV only strengthen or veto. Count seconds of steady pulse instead of raw reading counts | Works with what the SDK actually delivers | Noisier per window. The existing 2–3 min holds absorb single spikes | **Chosen** |
| 4 | **Rolling baseline instead of a calibration gate** | Never fails, zero wait | No mood for the first minutes; the baseline might form while stressed | **Fallback only** (when calibration can't finish) |
| 5 | **Gaps pause, never reset:** a window without enough steady pulse is "no read". It pauses holds, adds nothing, and music stays put | Bad framing means "no change", never a wrong call | Mood changes surface later when signal is patchy | **Chosen** |
| 6 | **Event-based away (fix B) + keep the SDK running on return (fix C)** | Ends false away and restart gaps | Real away takes a bit longer to confirm | **Chosen** (B already approved) |
| 7 | **Gentle in-session hint:** only after more than 2 min of the same framing code, the orb bubble shows the SDK's hint plus an optional "Show camera" (display-only preview, nothing saved) | Helps without nagging | Small UI work | **Chosen** |
| 8 | **Padded live frame:** draw the live camera smaller inside the canvas, as we do for the test videos, so code 7 stops blocking pulse | Could recover most lost pulse readings, our biggest data loss | Works around an SDK check, so breathing from a padded frame isn't trusted and is ignored. Smaller face means fewer pixels for rPPG | **Experiment first** (~30 min live test) |
| 9 | **Honest low-signal display:** the why line says "Low signal, holding steady" | Users see why nothing changes | None | **Chosen** |
| 10 | **Self-report mood tap** ("how do you feel?") | Always works | Defeats the camera premise; decision 28 bans manual mood triggers | Rejected |
| 11 | **Save a per-user baseline across sessions** | Instant calibration | Privacy rule: never store raw vitals or baseline | Rejected |
| 12 | **Slow baseline drift over long sessions** (pulse drifts with posture, caffeine, digestion) | Fewer false "low" late in the day | More logic to explain and test | Deferred. Revisit after real multi-hour sessions |

**The principle behind the choice:** *strict once, relaxed after; pulse is the backbone; missing data
means "hold", never "guess".* Ovra should be quietly right or quietly unsure, never confidently wrong.

## 4. What research says the numbers should be

- **Pulse under mental stress.** Lab stressors raise heart rate clearly: mental arithmetic about
  +8 bpm (72→80, ~11%), Stroop about +20 bpm. Everyday desk stress is milder than lab stressors, so
  **+10% (~7 bpm at 70 bpm)** is a reasonable "tense" bar. That's still 2–3× webcam pulse error.
- **rPPG accuracy.** Good webcam rPPG averages about 1.7–3 bpm absolute error. It worsens with head
  motion (nodding worst) and side views. That's why we use the **median** of steady readings per
  window (robust to motion spikes) and never act on one window.
- **HRV under stress.** Meta-analysis (Castaldo et al. 2015, 12 studies, 758 adults): time-domain HRV,
  including RMSSD, is significantly depressed during acute mental stress. One Stroop study found
  RMSSD −21 ms. A **−15%** RMSSD backer is conservative and sensible.
- **Breathing under load.** A systematic review found that mentally demanding work reliably brings
  faster breathing (rest 12–18/min, stressed around 20/min). **+15%** is about +2–3 breaths/min.
- **Low arousal (tired, bored).** Lower heart rate and more blinking go with fatigue and monotony, but
  effect sizes vary a lot between studies. Ovra keeps "low" conservative: pulse must drop, and blinks
  can only soften the pulse bar, never trigger "low" alone.

Sources:
[mental arithmetic HR](https://doi.org/10.33549/physiolres.933217),
[Stroop vs cold pressor](https://pmc.ncbi.nlm.nih.gov/articles/PMC13097317/),
[Castaldo 2015 meta-analysis](https://wrap.warwick.ac.uk/69425/),
[respiration and cognitive load review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4923594/),
[webcam rPPG with ECG ground truth](https://arxiv.org/pdf/2012.15846),
[rPPG viewpoint and motion](https://cinc.org/2026/Program/accepted/347_Preprint.pdf),
[boredom and arousal meta-analysis](https://repository.essex.ac.uk/42188/1/A%20systematic%20review%20and%20multilevel%20meta-analysis%20of%20the%20relationship%20between%20boredom%20and%20arousal.pdf).

## 5. The new rules

**Notation:**
- Δ is the change from your own baseline (e.g. Δpulse = +10% means 10% above your calm pulse).
- A **window** is the last 60 s, re-checked every 30 s (demo: 30 s, every 10 s).
- **Steady** means the SDK marked the value stable.

### 5.1 Calibration (getting to know you)

| | Old | New |
|---|---|---|
| Start | clock starts at the first good reading | **Framing check first:** a live preview with the SDK's hint until code 0 holds 3 s, then the clock starts. Skip is always available |
| Bar | 5 steady pulse readings over 15 s (demo 10 over 30 s) | **30 s of steady pulse**, counted only while the SDK says OK, same bar in demo and real mode |
| Baseline pulse | median of steady readings | same |
| Breathing / HRV baseline | only if they appear during calibration | taken during calibration if steady; otherwise **filled in later** from the first 60 s of steady values seen in a calm (focused) window |
| Max wait | 180 s (demo 120 s) | 180 s (demo 90 s) |
| On failure | session runs blind ("timer only") | the reason is shown, plus **Try again** or **Start anyway**. Start anyway builds the baseline from the first 30 s of steady pulse during the session (rolling baseline, approach 4). Mood stays "getting to know you" until then |

**Refining pulse baseline:** for the first **10 min after the baseline exists** (demo: **2 min**),
pulse is the median of the calibration pulse and each subsequent calm window's median steady pulse,
with equal weight per window. Only a **steady** window outside both near-miss bands can contribute;
tense, low, near-miss, unclear and no-read windows never teach Ovra what is usual, even before a hold
completes. Each window is classified against the existing baseline before it can contribute. After
the deadline the pulse baseline stays fixed for the session. This adjusts a still-sitting calibration
toward normal desk activity without learning a stressed stretch. All values stay in memory, are
never saved or sent, and are dropped when the session ends.

### 5.2 A window counts only with enough signal

- **Old:** at least 3 steady pulse readings (under 1 s of data at 4 readings per second).
- **New:** at least **10 s of steady pulse** in the window.
  - A window below that is **no read**. It pauses every hold (adds no time, resets nothing), keeps
    music unchanged, and the why line says "Couldn't see you clearly · no change".
  - Short gaps keep the current situation. If trailing no-read windows span **3 min** (demo **1 min**),
    **tense, crashing or low becomes unknown**; focused/good stay. The span is the last no-read `t`
    minus the first trailing no-read `start`, not time since the last read. A long camera-off gap
    before a single failed check-in cannot trigger it; two failed normal check-ins in a row can.
    The why line then says **"Lost track of you for a bit · checking again"** until a real reading
    returns. Music keeps its last choice, and missing readings cannot revive the forgotten mood.

### 5.3 Situations

In every rule, **pulse decides**. HRV, when available, **backs up** a call (confidence 0.6 → 0.9)
or **vetoes** it when it clearly points the other way. Breathing is used even less (see §1): it can
only add confidence, never decide, block or veto.

The pulse-only tense bar is now +15%: normal talking, shifting and coffee can clear +10% after a
still-sitting calibration. The +10% bar remains available when a steady RMSSD drop backs it.

| Situation | Old rule | New rule |
|---|---|---|
| **Focused** | Δpulse within ±8% and Δbreathing within ±15% (if present) | Δpulse within ±8%. Breathing ignored |
| **Good** | Focused + happy is the top expression in more than half the face frames | same, but needs at least 10 s of face frames with expressions. Without them it's just Focused |
| **Tense** | Δpulse ≥ +10% **and** (RMSSD ≤ −15% **or** Δbreathing ≥ +20%) when either exists; pulse alone otherwise. Held 3 min (demo 30 s) | Δpulse ≥ **+15%** alone, or **+10% with ΔRMSSD ≤ −15%**. Breathing ≥ +15% adds confidence only, never lowers the pulse bar. **Veto:** ΔRMSSD ≥ +15% (body says relaxed). Held **3 min** (demo **45 s**), or **2 check-ins** |
| **Crashing out** | tense held 10 min (demo 2), or Δpulse ≥ +20% with an angry/sad/disgust majority | same |
| **Low** | Δpulse ≤ −8% **and** Δbreathing ≤ −15% when breathing exists; or blink rate ≥ +50% with Δpulse ≤ −4%. Held 2 min (demo 30 s) | Δpulse ≤ **−8%**, or blink rate ≥ +50% with Δpulse ≤ −4%. Breathing ignored. Held **2 min** (demo **60 s**) |
| **Near miss** | within 3% of the tense/low bar pauses the hold | within **3 percentage points** of the active tense bar (+15% alone, +10% with HRV backing) or the low bar pauses the hold; adds no qualifying time |
| **No read** | window skipped; the next real window could reset holds | **pauses** holds; after 3 min (demo 1 min), forgets tense/crashing/low |

Why the backers changed from "required" to "optional":
- Breathing needs the chest (code 7) plus decent clothing contrast and light. HRV needs 60 s of clean
  beats, which code 12 breaks.
- So in real use they're absent most of the time. Under the old rules, when they *did* show up, a single
  noisy breathing value could block a clear pulse signal.
- Now HRV can strengthen or stop a call, and breathing can only add confidence.

**Same in every mode.** Demo mode uses these exact rules and bars; it only shortens waits (windows,
holds, max calibration wait). Dev tools (monitor, harness, video source) run the same code.

**Demo accuracy (Job 15).** A 30 s hold equalled the demo window, so a short dip could confirm Tired
using overlapping windows even after fresh readings stopped. Holds now outlast that window (45 s
tense, 60 s low); no signal bars changed. Prolonged no-reads forget a held mood so standing up for
its reminder cannot keep it alive indefinitely. The rest hint waits 150 s, and the full walk-through
takes about 16 min. These changes follow the Job 13 replay; no recorded readings are kept in the repo.

### 5.4 Presence and away

- **Evidence**, per fresh SDK frame (the SDK's own timestamp must move forward):
  - a **face box** (from landmarks, face consent only) of plausible size near the calibrated seat;
  - **code 7** (chest not visible: the normal frame's seated code, no landmarks, no pulse);
  - a **steady pulse**, or another face code (0, 3, 4, 12–17), on a frame *without* a face box.
- **A box off the seat vetoes its frame.** If the frame's own face box is implausible or away from
  the calibrated seat, that frame's pulse and code don't count either: the SDK is reading something
  that isn't you.
- **Box-less evidence ages out.** With face consent, a steady pulse or a code other than 7 keeps you
  present for at most **20 s** after the last face box at your seat (or code 7). Without face
  consent there are no boxes, so codes and pulse count as before. Not applied during calibration.
- **Away** after 20 s (demo 15 s) without evidence; code 1 clears evidence at once; code 2 blocks
  face evidence (pulse still counts). Camera off, paused or reconnecting never counts toward away.
- **Waking:** a steady pulse that passes the rules above, or face evidence in 3 of the last 4 seconds.
- **On return:** the SDK keeps running (no restart, no fresh warm-up).

**Why (Job 10, 2026-11-15).** In Daniel's 42-min live session he was out of frame for 20+ min and
away never fired, while the why line kept showing heart-rate lines. A window only shows heart-rate
text with at least 10 s of steady pulse, so the SDK must have been sending fresh frames with face
codes and steady pulse from an empty chair. The old rule took any steady pulse or face code as
presence.

What real SDK runs on the dev video source showed (continuous, face metrics on):

| Clip, frame | Seated | Empty frame |
|---|---|---|
| leave-and-return, shrunk (pad 0.4) | code 0, ~30 payloads/s, face box every second (size 0.25–0.28), steady pulse most seconds | code 15 every frame, **0 payloads**; away at exactly 20 s, woke 2 s after return |
| leave-and-return, normal (pad 0) | codes 7/16, face object every payload, **0 landmarks, no pulse** (same as live code 7) | code 2 every frame, **0 payloads** |
| calm-working, shrunk | 139 s: a face box in every second (size 0.23–0.35, centre 0.48–0.54, 0.39–0.43), code 0 except 1-frame 17s and a few seconds of 11 | none in the clip |

So on video an empty frame simply stops the SDK, and the old rule already worked. The live ghost
is something the clips don't contain. The rule above is built from what does separate the cases:
a seated face gives a box every second with the shrunk frame (the default), and a seated code 7
gives no box at all. A steady pulse needs code 0, which comes with landmarks, so a ghost pulse
almost always brings a box we can check against the seat.

**Timing for an empty chair:** no frames, or a ghost box off the seat: away 20 s after you leave
(demo 15). A ghost with no box (codes 15/17, empty face objects, steady pulse): away within 40 s
(demo 35). A seated person whose face box disappears for a while (looking down, turning) keeps 40 s
of grace; code 7 has none of these limits.

**Known limits.** A ghost box *at* the calibrated seat (for example a headrest) still counts, as in
decision 29. A ghost giving code 7 without a box can't be told apart from a seated code 7. Without
face consent, ghost codes or pulse still count. The real-room empty-chair test checks which of
these happens (see the Job 10 report).

### 5.5 In-session framing hint

- **Trigger:** the same framing code (7, 12, 13–17) for more than 2 min.
- **What shows:** the orb bubble shows the SDK's own advice once (e.g. "Lean back a little so your
  shoulders show"), plus **Show camera**, which opens a small display-only preview.
- **Rate:** at most once per 15 min. Nothing is recorded.

### 5.6 Experiment: padded live frame (code 7)

- **Test:** draw the live camera at about 80% scale inside the 1280×720 canvas.
- **Measure:** the share of code 0 and steady pulse over 10 min of normal work, with and without padding.
- **Keep it if** steady-pulse time at least doubles and pulse stays within ±3 bpm of an unpadded
  still-sitting reference.
- **While padded,** breathing is ignored, since the chest isn't really in view.

## 6. Session-tab camera and orb button labels (queued UI task)

- **Camera in the Session tab during a session.**
  - **What:** the preview the Session tab already shows before a session stays available during one,
    so people can check their framing themselves.
  - **How:** a second `getUserMedia` on the same camera in the main window, shown in a `<video>`.
    It's display only: no frames are copied, saved or sent.
  - **Cost:** small. Chromium shares the camera between the two streams, and drawing a `<video>` is done
    on the GPU. The stream stops when the tab is hidden or the window is closed, so it costs nothing
    when nobody's looking. Don't send frames over IPC from the capture window; that would be slow.
- **Orb control labels.**
  - **What:** hovering a button in the orb's control row (camera, music, end, main window) shows a
    short label.
  - **Why custom:** the buttons already have `title`, but native tooltips don't appear in the
    frameless, unfocused orb window, so it needs a small CSS tooltip.

## 7. For the DEV post (short version)

> Presage reads your pulse from the colour of your skin and your breathing from your chest, through
> an ordinary webcam. That's magic, and also fragile: a slouch hides the chest (code 7), laughing or
> typing hard blurs the signal (code 12), and the SDK goes quiet. A clinic can tell patients to sit
> still. A focus app can't. So we stepped back and designed for patchy data:
> one gentle framing check at the start and none after; pulse as the backbone, with breathing and HRV
> as backup; a mood only after minutes of agreement; and when the signal drops, Ovra holds still and
> says so instead of guessing.

## 8. Status

- **Decided 2026-11-14 (decision 39).** Implementation not started; Daniel picks the order.
- **Superseded once built:** decision 26 (already replaced by 29), the presence part of 29 (by 5.4),
  and calibration bars in `src/main/state/config.ts` and `src/main/session/config.ts`.

## 9. Implementation notes (workarounds, for the post)

- **Missing data never picks music (Job 5, decision 40).** Before the first real mood, music stays on Steady with the activity's lean; it never picks Boost or Calm from missing data. The first real mood switches at once (skipping the 3 min gap once). A dropout keeps the last known mood.
- **"Visible but unmeasurable" counts as present (Job 2, decision 41).**
  - **The rule:** codes 7/12/13–17 on a *fresh* SDK frame mean someone is there. We trust the SDK's raw code, not an empty face object (which it also sends for an empty chair).
  - **Frozen feeds:** freshness uses the SDK's own frame timestamps, so a repeated or frozen frame can't fake presence.
  - **Returning:** coming back no longer restarts the SDK. The return check is a logical phase on the same running stream, so the 12/30/60 s warm-ups aren't thrown away.
- **Padded live frame (Job 4, decision 42).**
  - **The trick:** the same padding that fixed our test videos, behind a switch that's off until measured.
  - **Breathing:** dropped while padded, because the padding gets past the chest check without the chest really being in view. We won't use a reading we know isn't real.
  - **The A/B:** compares the share of time at code 0 and the seconds of steady pulse, the exact quantities the new window rule needs.
- **Seconds, not readings (Job 1, decision 43).**
  - **Why:** the SDK's ~4 results a second arrive in bursts, so "30 readings" can be 8 s of signal. Every bar counts distinct seconds with a steady value.
  - **No-read windows** stay in the history so holds pause rather than reset.
  - **Late baselines:** breathing and HRV baselines are only learned from calm (focused) windows, so a stressed minute can't become "your normal".
  - **Never blind:** a failed calibration offers Try again or Start anyway (rolling baseline), never a blind session.
- **Self-serve framing (Job 3, decision 44).**
  - **Preview:** instead of nagging, a display-only camera preview is one click away during a session. It's a second stream of the same camera, shown and never copied.
  - **Hint:** the SDK's own hint appears only after 2 min stuck on one framing code, once per episode.
- **Code 7 solved by the shrunk frame (decision 48).** Live A/B, same seat: code 0 went from 7–27% to ~75%, steady pulse from 0 s to 36 s, and calibration passed in 83 s instead of failing. It's now the default.
- **The SDK can die silently (Job 9, decision 49).**
  - **What happens:** twice in live runs the SDK went into a dead state and refused every frame. Once was after its usage check failed behind a VPN.
  - **How Ovra copes:** it watches for this, restarts the SDK up to 3 times, and says "Camera reconnecting" instead of marking the user away. If it still can't connect, it says plainly "Couldn't reach Presage. Check your internet or VPN".
- **The wind-down "freeze" was the main thread blocked, not wind-down (Job 32).**
  - **What Daniel saw:** in a 12-min Unwind demo, at "2:00 remaining" the clock stuck at 1:58, the stretch card at 0:05, and the 5 s monitor lines stopped. Electron's main process stayed alive at ~2% CPU and exited with code 1 when closed.
  - **Why it isn't Ovra's music or session code:** a busy JS loop would show ~100% CPU, and a promise that never resolves can't stop other timers. Only a *synchronous* call that never returns freezes every timer at once while using no CPU. Ovra's own main-process code has no synchronous child processes (every `osascript` is async with a 4 s timeout). The log shows wind-down did almost nothing: the song had already been judged, so it was kept with no Spotify command. Replaying the same moment with mocks (wind-down while a Tired preview ends, a stretch runs and a ducked skip starts, in demo and in normal mode) reaches 0:00 and the summary every time.
  - **The likely cause:** the SDK's main-process bridge calls the native `send_frame` *synchronously* on the main thread for every camera frame (~30 a second). The SDK's own source says its worker threads block while they hand a callback (metrics, status) to that same thread. If `send_frame` ever waits on such a worker, each waits for the other forever: a deadlock with no CPU use and nothing logged. It can happen at any moment, so landing on wind-down was most likely a coincidence. We can't confirm it without the SDK's native code.
  - **What we added:** with `OVRA_MONITOR=1`, a small worker thread watches a heartbeat from the main thread and writes `[monitor] main thread blocked for 3.0s ...` straight to stderr when it stops, and `main thread resumed after Ns` if it recovers. It can report even while the main thread is stuck. The next freeze will show in the log as a block, not just as silence.
  - **Not done (needs a decision):** move the SDK bridge into an Electron `utilityProcess`, so a stuck SDK can only stop the readings and never the clock, music or cards. Also report it to Presage.
