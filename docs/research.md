# Research behind Ovra's choices

Ovra makes three kinds of judgement calls that research can inform: when your body counts as stressed or
tired, how music should vary over a work session, and when to suggest a break. For each one we looked at
what studies and real users say, then chose numbers that balance good health practice with not breaking
people's focus. The sources are small studies, guidance pages and community threads, not definitive
answers, so every number lives in a config file and can be tuned after real use.

All three point the same way: **Ovra is built for real work sessions, not a 5-minute try-out.** Moods
need minutes of evidence, music variety plays out over half an hour, and break reminders follow how long
you've actually sat. Demo mode shows how Ovra acts in about 16 minutes; judging its accuracy needs a
normal session of 45 minutes or more (decisions 57, 66).

## 1. Reading stress and tiredness from a webcam

**What we found**
- **Heart rate under mental stress:** a mental arithmetic task raised heart rate from about 72 to 80 bpm
  ([Physiological Research](https://doi.org/10.33549/physiolres.933217)). A Stroop task raised it by
  about 20 bpm and lowered RMSSD by about 21 ms
  ([crossover study](https://pmc.ncbi.nlm.nih.gov/articles/PMC13097317/)).
- **HRV under stress:** a meta-analysis of 12 studies with 758 adults found time-domain HRV drops during
  acute mental stress ([Castaldo et al. 2015](https://wrap.warwick.ac.uk/69425/)).
- **Breathing:** mentally demanding work brings faster breathing
  ([systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4923594/)). But a webcam only reads it
  with the chest in view and good light.
- **Webcam heart-rate accuracy:** about 1.7–3 bpm average error, worse with head motion and side views
  ([webcam rPPG with ECG ground truth](https://arxiv.org/pdf/2012.15846),
  [viewpoint and motion](https://cinc.org/2026/Program/accepted/347_Preprint.pdf)).
- **Low arousal (tired, bored):** usually goes with a lower heart rate and more blinking, but findings
  vary ([boredom and arousal meta-analysis](https://repository.essex.ac.uk/42188/1/A%20systematic%20review%20and%20multilevel%20meta-analysis%20of%20the%20relationship%20between%20boredom%20and%20arousal.pdf)).

**How we adapted it** (decisions 39, 46, 56)
- **Heart rate decides.** Stressed needs +15%, or +10% when HRV agrees. That's 2–3× webcam error, and
  well within real stress responses.
- **Breathing only adds confidence,** because it's the least reliable signal on a laptop camera.
- **A mood must hold for minutes** (Stressed 3 min, Tired 2 min) before Ovra says so. Real moods build
  over minutes, and a single spike shouldn't move the music. That's also why a quick demo can't show
  every mood on demand: fit people's heart rate settles in under a minute (decision 65).

## 2. How music should vary during a work session

**What we found**
- **Many people keep one familiar playlist while focusing.**
  - One developer uses [the same playlist whether working or not](https://dev.to/chill_whisper/how-you-listen-to-your-music-while-you-write-code-4ja9).
  - Others loop a focus playlist because [repetition helps them sink into a groove](https://josephmosby.bearblog.dev/the-psychology-of-a-small-playlist-on-repeat/).
  - Someone who works to Spotify all day [prefers longer playlists over switching hourly ones](https://community.spotify.com/t5/Music-Discussion/When-do-you-consider-a-playlist-too-short-or-too-long-of-songs/m-p/4474874/highlight/true).
- **Familiar music distracts less:** [familiar songs on repeat were barely distracting](https://chrisbailey.com/how-music-affects-your-productivity/),
  and people tend to pick [relaxing, familiar music for hard mental work](https://www.rareformaudio.com/blog/background-music-focus-study).
- **But familiarity wears off:** enjoyment rises with familiarity only up to a point, and some people want
  [a big library so songs don't repeat](https://dev.to/chrisachard/music-to-listen-to-while-coding-3pn1/comments).
- **Skipping is itself a context switch** that can [break flow](https://alexknepper.substack.com/p/the-magic-of-music-and-productivity).
  For scale, an older analysis of Spotify plays found people skip about
  [14.65 tracks per hour](https://www.hypebot.com/could-half-of-music-royalties-pay-for-music-we-would-rather-skip-over-than-listen-to.md).

**How we adapted it** (decisions 61, 63, 64)
- **Steer quietly inside one of your playlists:** Ovra skips songs that don't fit your mood, with the
  volume lowered during skips so you barely hear them.
- **Switch playlist after a number of played songs that depends on the activity:**
  - Focus and Reading: about 12 songs (~40 min), because familiarity helps deep work.
  - Creative, Everyday and Unwind: about 7 songs (~25 min), because variety matters more there.
- **The tradeoff:** each switch briefly brings Spotify forward, because Spotify's desktop app can't play
  a chosen song silently. So variety costs one brief flash about every 25–40 minutes, a deliberate
  balance rather than a perfect answer.

## 3. When to suggest a break

**What we found**
- **People sit for long stretches:**
  - In 496 office workers, [about half of all workplace sitting came in unbroken bouts of 30+ minutes](https://pmc.ncbi.nlm.nih.gov/articles/PMC4929063).
  - A multi-site study found [42% of work hours spent in 30+ minute sitting bouts](https://doaj.org/article/44d4e9f7f71247f695208a6c28f2ed87).
  - Even with sit-stand desks, the average sitting bout was [about 15 minutes](https://oar.baker.edu.au/F460E).
- **Short desk breaks help neck and shoulders:**
  - Computer workers with neck and shoulder complaints given [3-minute breaks every 20 minutes](https://publications.tno.nl/publication/34626157/WaDCrM/heuvel-2003-effects.pdf)
    had less discomfort, without losing productivity.
  - Prompted breaks alone helped, and [adding exercise during them didn't add much](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-556741ba-a068-4225-a4d9-f9f45b319d1b/c/Nakphet.pdf).
- **Standing up regularly:** researchers behind Stand Up Australia and the
  [NSW government](https://www.safework.nsw.gov.au/safety-starts-here/physical-safety-at-work-the-basics/sedentary-work)
  suggest standing at least every 30 minutes, even briefly.
- **Walking breaks:**
  - [5 minutes of walking every 30 minutes](https://www.medicalnewstoday.com/amp/articles/5-minute-walks-every-30-minutes-offsets-effects-too-much-sitting)
    gave the best results in a small lab study, and hourly breaks didn't give the same benefit.
  - [2 minutes of light walking every 20 minutes](https://medicalxpress.com/news/2012-03-significant-health-benefits-overweight-adults.pdf)
    also helped.
  - Office workers [reminded to move for 3 minutes every 30 minutes](https://www.thenewdaily.com.au/life/health/2021/09/20/counter-damage-from-sitting)
    saw benefits.
- **Productivity:** no single work rhythm is proven best. Shorter intervals suit distractible work and
  [longer ones suit deep work](https://wildandfreetools.com/blog/pomodoro-alternatives-50-minute-intervals/).

**How we adapted it** (decision 68)
- **The health research says "move about every 30 minutes".** Getting up and leaving every 30 minutes
  would wreck focus, though, so Ovra uses a ladder of three reminders, from small and frequent to rare
  and real:

  | Reminder | Focus / Reading | Creative / Everyday / Unwind | Before |
  |---|---|---|---|
  | Neck and shoulder stretch (at the desk, ~90 s) | 30 min sitting | 25 min | 45 min |
  | Stand and stretch (~2 min) | 60 min | 50 min | 60 min |
  | Walk and get some water (~5 min, away from the desk) | 90 min | 75 min | 90 min |

- **Deep-work activities get slightly longer gaps,** to protect flow.
- **Each reminder comes once per sitting stretch,** and leaving the desk for a minute resets the clock.
  Mood-driven suggestions (breathe along when Stressed, stand when Tired) work separately.
- **Why the change:** with the old timings, a default 45-minute session never reached the first
  reminder. Daniel's longest sitting stretch was 44 minutes.
- **Wording stays wellness-only:** suggestions, never medical advice.
