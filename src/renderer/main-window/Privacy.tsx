// Owner: Agent E. Every consent answer, editable. Delete everything.
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { IpcInvoke, PrivacySettings } from '@shared/types'
import { ovra } from '../shared/bridge'
import { Button, ConfirmButton } from '../ui'
import { CONSENT_QUESTIONS, isAsked } from './consent'
import { ConsentField } from './ConsentField'

export function Privacy(props: {
  privacy: PrivacySettings
  onChange: (p: PrivacySettings) => void
  onDeletedAll: () => void
}): React.JSX.Element {
  const { privacy } = props
  const [folder, setFolder] = useState<IpcInvoke['data:folder']['res'] | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  useEffect(() => {
    void ovra()
      .invoke('data:folder')
      .then(setFolder)
      .catch(() => setFolderError('Couldn’t read the data folder path.'))
  }, [])
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
      <div className="panel stack">
        <div className="saved">
          <h2 className="panel__title">
            Stored on this {folder?.platform === 'darwin' ? 'Mac' : 'computer'}
          </h2>
          <Button
            onClick={async () => {
              setFolderError(null)
              try {
                await ovra().invoke('data:show-folder')
              } catch {
                setFolderError('Couldn’t open the data folder. Try again.')
              }
            }}
          >
            Show in{' '}
            {folder?.platform === 'win32'
              ? 'Explorer'
              : folder?.platform === 'darwin'
                ? 'Finder'
                : 'file manager'}
          </Button>
        </div>
        <p className="muted small">
          <code className="stored-path">{folder?.path}</code> · plain text files you can open in any
          text editor ·{' '}
          {folder?.platform === 'win32'
            ? 'stored in your user profile'
            : 'only your user account can open them'}
          .
        </p>
        {folderError && (
          <p className="form-error" role="alert">
            {folderError}
          </p>
        )}
        <dl className="stored-files">
          <div>
            <dt>Songs</dt>
            <dd>Title, artist, energy and mood guesses, how each song worked for you</dd>
          </div>
          <div>
            <dt>Playlists</dt>
            <dd>Links you added</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>
              Activity, length, mood words over time, moves done.
              {privacy.autoDelete !== 'never' && ` Deleted after ${privacy.autoDelete} days`}
            </dd>
          </div>
          <div>
            <dt>Settings and answers</dt>
            <dd>Your privacy choices, app settings and which camera you picked</dd>
          </div>
          <div>
            <dt>Temporary app files</dt>
            <dd>Files the app uses to run, with no personal data</dd>
          </div>
        </dl>
        <p className="small">
          <strong>Never stored:</strong>{' '}
          <span className="muted">
            video, photos, heart rate, breathing, face details or your starting readings.
          </span>
        </p>
      </div>
      <div className="panel saved">
        <div>
          <h2 className="panel__title">Delete everything</h2>
          <p className="muted small">
            Removes all session history, what Ovra learned about songs, playlists and settings from
            this Mac. You’ll see the privacy questions again.
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
