# Dev sensing simulator

A dev-only stand-in for the camera. The real app runs (state engine, session, music with your real
Spotify, moves, orb, move card, privacy and storage). Only the sensing service is swapped for a fake one
that sends made-up readings for the scenario you pick. The SmartSpectra SDK is never loaded, the
camera is never opened and no Presage credits are used.

## Run

```sh
npm run dev:simulate
```

Packaged builds ignore `OVRA_SIMULATE`. A small always-on-top window opens next to Ovra, labelled
**SIMULATED — no camera**. It has:

- **Scenario** (one at a time): Calm, Tense, Crashing, Low, Good, Away. Calibration always sees calm
  readings, whatever is picked.
- **Actions** (last about 8 s): Tilt left, Tilt right, Stand up, Breathing slows. Use these to trigger
  move feedback.
- **Fast mode** (on by default).
- **What the app decided**: sensing phase, situation and confidence, orb mood, music target word
  (Calm / Focus / Boost), last nudge. The terminal logs the same lines (`[sim] …`), plus nudges, move
  feedback and return results.

Readings only flow while a sensing phase runs (`calibration`, `checkin`, `continuous`,
`return-check`), as with the real camera. In check-in mode the camera is off between check-ins, so
scenario changes show up at the next check-in and actions only count while one is running.

### Fast mode

On by default. The numbers below are **fast-mode test values, not the real thresholds**:

|                                       | Fast mode                       | Real                                       |
| ------------------------------------- | ------------------------------- | ------------------------------------------ |
| Calibration                           | 10 s                            | 90 s                                       |
| Check-in                              | 15 s every 30 s                 | 90 s every 3/5/10 min                      |
| Return check                          | 10 s                            | 30 s                                       |
| Tense / low must hold                 | 1 check-in (15 s in continuous) | 2 check-ins or 3 min / 1 check-in or 2 min |
| Tense turns into crashing after       | 3 min                           | 10 min                                     |
| Nudges at most every                  | 30 s                            | your setting (default 20 min)              |
| Seated nudges (neck / stand / walk)   | 3 / 6 / 10 min                  | 45 / 60 / 90 min                           |
| Tense counts as "early" (breathe) for | 1 min                           | 5 min                                      |
| Step outside after upset for          | 4 min                           | 15 min                                     |
| Move steps                            | at most 15 s each               | 10 s to 10 min                             |

It works through your settings (`nudgeMinIntervalMin`, `thresholdOverrides`) and a fast moves
config. Shipped defaults are not changed. Turning fast mode off puts your own nudge interval and
threshold overrides back straight away; the new sensing timing applies from the next phase or
session. Music's own rule of at most one target change every ~3 min is **not** shortened.

While the simulator runs, Settings shows the dev video source `/ovra-simulator-no-camera`. That keeps
the calibration screen from opening the camera for its preview (you'll see "Camera preview isn't
available. Calibration can continue." — expected). Your settings are put back when you quit with
**Cmd+Q**. If the app is killed instead, the next simulator start notices and resets the nudge
interval, threshold overrides and dev video source to the defaults (20 min, none, none).

## Manual test script

### 1. Onboarding (or check Privacy if already done)

- Camera: **Yes**. Safe here: the simulator replaces the camera, so no camera is opened and macOS
  won't ask for camera access.
- How often: either (you pick per session anyway).
- Face: **Vitals and face**. Needed for crashing (angry), good (happy), the low blink rate, and all
  move feedback. With "Vitals only" the face fields are dropped like the real SDK does.
- Music: **Spotify desktop app**. Have Spotify open; approve the Automation prompt once.
- AI scoring, diagnostics, auto-delete: anything.

### 2. Music

Open **Music** and paste one of your playlist links (`https://open.spotify.com/playlist/…`).

### 3. Start a check-in session

Session → Deep work, 45 min, Camera **Check-ins**, Music on → **Start session**. Leave the simulator
on **Calm**.

- Main window shows calibration for ~10 s with the preview-unavailable line. Simulator phase:
  `calibration`. The orb has its listening ring.
- Then the main window hides and the orb shows. Orb: cool white-blue, slow pulse. Bubble
  "Nice and steady." Read-out: `focused`, orb `calm`, music **Focus**. Spotify starts your playlist.
- Every 30 s the ring appears for 15 s (`checkin`), then goes away (`idle`).

### 4. Scenarios (check-in mode)

Change the scenario, then wait for the next check-in to end (up to ~45 s).

| Scenario     | Situation / orb                                                           | Bubble                                   | Music                                                                    | Nudge (move card)                                                                                                 |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Tense**    | `tense`, amber, faster pulse                                              | "You seem a bit tense."                  | **Calm**, "Easing into calmer songs" at the next track                   | "You seem tense. Want to breathe along for a minute?" After 1 min still tense: "…loosen your neck and shoulders?" |
| **Crashing** | `crashing`, orange-red edge, flickery                                     | "Rough stretch? Let's slow things down." | **Calm** (Settle): fades out and switches right away, then fades back up | "Things seem intense. A short walk might help." After 4 min upset: step outside                                   |
| **Low**      | `low`, dim grey-blue, slow                                                | "Energy dipping a little."               | **Boost**, brighter songs at the next track                              | "Energy seems low. Want to stand and stretch?"                                                                    |
| **Good**     | `good`, bright warm white                                                 | "You seem in a good mood."               | **Focus** (Let it ride), no switch                                       | none from mood                                                                                                    |
| **Calm**     | `focused`, calm                                                           | "Nice and steady."                       | **Focus**                                                                | seated nudges at 3 / 6 / 10 min (neck / stand / walk)                                                             |
| **Away**     | no change in check-in mode (the check-in sees nobody, seated time resets) | —                                        | —                                                                        | —                                                                                                                 |

Music switches respect the ~3 min target-change limit, so going straight from Tense to Crashing may
hold the old target for a bit (Settle still fades early once it's allowed). Nudges answer with
**Let's go / 5 more min / Skip**; a new nudge can come 30 s after the last one.

### 5. Guided moves with feedback

Feedback needs readings during the step. In check-in mode click the action while the phase reads
`checkin`; it's easier with a **The whole session** session (see 7).

- **Breathe along** (from a Tense nudge → Let's go): orb grows and shrinks, card shows in/out. On the
  breathe step click **Breathing slows** → "Your breathing is slowing down".
- **Neck and shoulder stretch**: on "Tilt left" click **Tilt left** → "I can see the tilt"; same on
  "Tilt right" with **Tilt right**.
- **Stand and stretch** (Low nudge): on "Stand up" click **Stand up** → "I can see you standing".

### 6. Leave-desk break and return check (check-in mode)

From the Crashing nudge → **Let's go** → on "Take a short walk" click **Okay, going**. Camera stops,
the orb goes dim/eclipsed with a time-away counter, Spotify pauses. Pick the scenario you want to come
back as, then click **I'm back** on the card. A 10 s return check runs (ring on, phase
`return-check`), then the card shows:

- Calm or Good → "You're calmer than before." (if you left tense/crashing), else "Welcome back.
  You're looking settled."
- Tense or Crashing → "Still a bit tense. Want a 1 min breathing round?"
- Away → "Welcome back." (no reading)

Music resumes and check-ins carry on.

### 7. Continuous mode and automatic away

End the session and start another with Camera **The whole session**. The ring stays on (phase
`continuous`); the read-out updates every ~3 s and a new scenario takes over within ~15–25 s.

- **Away**: after ~8 s with no face the orb goes to away by itself, the away card shows, Spotify
  pauses. Back to **Calm**: the orb wakes, a 10 s return check runs, then the return result shows.
- Repeat step 5 here; actions register right away.

### 8. Pause / resume

Hover the orb → **Pause camera**. Ring disappears, phase `idle`, no check-ins start. **Resume
camera**: continuous restarts immediately; check-ins resume at the next 30 s tick.

### 9. End of session

Orb → **End session**. The camera ring goes away, the main window shows the summary: mood timeline
(your scenarios), moves done and snoozed, songs it learned about, longest seated stretch, with a
delete button. Quit with **Cmd+Q** so your settings are restored.
