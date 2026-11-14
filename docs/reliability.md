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

### 5.2 A window counts only with enough signal

- **Old:** at least 3 steady pulse readings (under 1 s of data at 4 readings per second).
- **New:** at least **10 s of steady pulse** in the window.
  - A window below that is **no read**. It pauses every hold (adds no time, resets nothing), keeps the
    current situation and music, and the why line says "Low signal, holding steady".

### 5.3 Situations

In every rule, **pulse decides**. HRV, when available, **backs up** a call (confidence 0.6 → 0.9)
or **vetoes** it when it clearly points the other way. Breathing is used even less (see §1): it can
only add confidence, never decide, block or veto.

| Situation | Old rule | New rule |
|---|---|---|
| **Focused** | Δpulse within ±8% and Δbreathing within ±15% (if present) | Δpulse within ±8%. Breathing ignored |
| **Good** | Focused + happy is the top expression in more than half the face frames | same, but needs at least 10 s of face frames with expressions. Without them it's just Focused |
| **Tense** | Δpulse ≥ +10% **and** (RMSSD ≤ −15% **or** Δbreathing ≥ +20%) when either exists; pulse alone otherwise. Held 3 min (demo 30 s) | Δpulse ≥ **+10%**. Backers: RMSSD ≤ −15% (or Δbreathing ≥ +15%, confidence only). **Veto:** RMSSD ≥ +15% (body says relaxed). Held **3 min** (demo 30 s) |
| **Crashing out** | tense held 10 min (demo 2), or Δpulse ≥ +20% with an angry/sad/disgust majority | same |
| **Low** | Δpulse ≤ −8% **and** Δbreathing ≤ −15% when breathing exists; or blink rate ≥ +50% with Δpulse ≤ −4%. Held 2 min (demo 30 s) | Δpulse ≤ **−8%**, or blink rate ≥ +50% with Δpulse ≤ −4%. Breathing ignored. Held **2 min** (demo 30 s) |
| **Near miss** | within 3% of the tense/low bar pauses the hold | same |
| **No read** | window skipped; the next real window could reset holds | **pauses** holds, like a near miss |

Why the backers changed from "required" to "optional":
- Breathing needs the chest (code 7) plus decent clothing contrast and light. HRV needs 60 s of clean
  beats, which code 12 breaks.
- So in real use they're absent most of the time. Under the old rules, when they *did* show up, a single
  noisy breathing value could block a clear pulse signal.
- Now HRV can strengthen or stop a call, and breathing can only add confidence.

**Same in every mode.** Demo mode uses these exact rules and bars; it only shortens waits (windows,
holds, max calibration wait). Dev tools (monitor, harness, video source) run the same code.

### 5.4 Presence and away

- **Present** while the SDK is reporting a face in any form, *including* codes 7, 12, 15, 16 and 17
  ("I can see you, just not well enough to measure").
- **Away** only on code 1 (no face), a blank or frozen feed, or 20 s (demo 15 s) without any face
  object.
- **On return:** the SDK keeps running (no restart, no fresh warm-up).
- **To verify:** an empty-chair test, so a "ghost" face object on an empty seat doesn't keep someone present.

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
