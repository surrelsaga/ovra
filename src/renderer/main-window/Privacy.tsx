// Owner: Agent E. Every consent answer, editable. Delete everything.
import { Trash2 } from 'lucide-react'
import type { PrivacySettings } from '@shared/types'
import { ovra } from '../shared/bridge'
import { ConfirmButton } from '../ui'
import { CONSENT_QUESTIONS, isAsked } from './consent'
import { ConsentField } from './ConsentField'

export function Privacy(props: {
  privacy: PrivacySettings
  onChange: (p: PrivacySettings) => void
  onDeletedAll: () => void
}): React.JSX.Element {
  const { privacy } = props
  const save = async (patch: Partial<PrivacySettings>): Promise<void> => {
    props.onChange(await ovra().invoke('privacy:set', patch))
  }
  return (
    <section className="page" aria-labelledby="privacy-title">
      <header className="page__header">
        <h1 id="privacy-title">Privacy</h1>
        <p>Changes save right away. The app never saves or uploads video.</p>
      </header>
      <div className="panel stack stack--loose">
        {CONSENT_QUESTIONS.filter((q) => isAsked(q, privacy)).map((q) => (
          <ConsentField
            key={q.key}
            question={q}
            answers={privacy}
            onChange={(patch) => void save(patch)}
          />
        ))}
      </div>
      <div className="panel saved">
        <div>
          <h2 className="panel__title">Delete everything</h2>
          <p className="muted small">
            Removes all session history, song scores, playlists and settings from this Mac. You’ll
            see the privacy questions again.
          </p>
        </div>
        <ConfirmButton
          label="Delete everything"
          confirmLabel="Yes, delete everything"
          icon={<Trash2 />}
          onConfirm={async () => {
            await ovra().invoke('data:delete-all')
            props.onDeletedAll()
          }}
        />
      </div>
      <p className="muted small">Not a medical device. Ovra offers wellness suggestions only.</p>
    </section>
  )
}
