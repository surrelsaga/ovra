// Owner: Agent E. First launch: orb greeting, then the seven consent questions one at a time. No "accept all".
import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { PrivacySettings } from '@shared/types'
import { ovra } from '../shared/bridge'
import { Button, MoonOrb } from '../ui'
import { CONSENT_QUESTIONS, isAsked, missingAnswers } from './consent'
import { ConsentField } from './ConsentField'

export function Onboarding(props: {
  initial: PrivacySettings
  onDone: (p: PrivacySettings) => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState(props.initial)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const questions = CONSENT_QUESTIONS.filter((q) => isAsked(q, answers))
  const q = step > 0 ? questions[step - 1] : null
  const isLast = step === questions.length
  const unanswered = q?.required && answers[q.key] === null

  const finish = async (): Promise<void> => {
    if (missingAnswers(answers).length) return
    setSaving(true)
    setError(null)
    try {
      props.onDone(await ovra().invoke('privacy:set', { ...answers, answeredAt: Date.now() }))
    } catch {
      setError('Couldn’t save your answers. Try again.')
      setSaving(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding__drag" />
      <div className="onboarding__card">
        {q === null ? (
          <div className="onboarding__hello">
            <MoonOrb mood="calm" listening={false} away={false} size={96} label="Ovra moon" />
            <h1>Hi, I’m Ovra.</h1>
            <p>
              I sit on your screen while you work, play music that fits how you’re doing, and tell
              you when to stand up and move.
            </p>
            <p>
              First, seven quick questions about privacy. The camera stays off until you answer. You
              can change any answer later in Privacy.
            </p>
          </div>
        ) : (
          <>
            <p className="onboarding__count">
              {/* Numbered against all seven, so the total never jumps when camera questions are skipped. */}
              Question {CONSENT_QUESTIONS.indexOf(q) + 1} of {CONSENT_QUESTIONS.length}
            </p>
            <ConsentField
              key={q.key}
              question={q}
              answers={answers}
              onChange={(patch) => setAnswers((a) => ({ ...a, ...patch }))}
            />
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="onboarding__nav">
          {step > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft />} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {isLast ? (
            <Button
              variant="primary"
              disabled={!!unanswered || saving}
              onClick={() => void finish()}
            >
              Finish
            </Button>
          ) : (
            <Button variant="primary" disabled={!!unanswered} onClick={() => setStep(step + 1)}>
              {step === 0 ? 'Let’s start' : 'Next'}
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
      <p className="onboarding__note">
        Not a medical device. Ovra offers wellness suggestions only.
      </p>
    </div>
  )
}
