// Owner: Agent E. Main window: onboarding until answered, then sidebar + screens.
import { useEffect, useState } from 'react'
import { Clock, Music as MusicIcon, Settings as SettingsIcon, Shield, Timer } from 'lucide-react'
import type {
  AppSettings,
  MusicStatus,
  PrivacySettings,
  Session,
  SessionSummary
} from '@shared/types'
import { ovra } from '../shared/bridge'
import { MoonOrb } from '../ui'
import { History, SessionSummaryView } from './History'
import { Music } from './Music'
import { Onboarding } from './Onboarding'
import { Privacy } from './Privacy'
import { Calibration, NewSession, Running } from './Session'
import { Settings } from './Settings'
import './app.css'

type Page = 'session' | 'music' | 'history' | 'privacy' | 'settings'

const NAV: { page: Page; label: string; icon: React.JSX.Element }[] = [
  { page: 'session', label: 'Session', icon: <Timer /> },
  { page: 'music', label: 'Music', icon: <MusicIcon /> },
  { page: 'history', label: 'History', icon: <Clock /> },
  { page: 'privacy', label: 'Privacy', icon: <Shield /> },
  { page: 'settings', label: 'Settings', icon: <SettingsIcon /> }
]

interface Loaded {
  privacy: PrivacySettings
  settings: AppSettings
  music: MusicStatus
}

export default function App(): React.JSX.Element {
  const [data, setData] = useState<Loaded | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [page, setPage] = useState<Page>('session')

  const load = (): void => {
    void Promise.all([
      ovra().invoke('privacy:get'),
      ovra().invoke('settings:get'),
      ovra().invoke('music:status'),
      ovra().invoke('session:current')
    ]).then(([privacy, settings, music, current]) => {
      setData({ privacy, settings, music })
      setSession(current)
    })
  }
  useEffect(load, [])
  useEffect(() => {
    const offs = [
      ovra().on('push:privacy', (privacy) => {
        setData((d) => d && { ...d, privacy })
        if (!privacy.answeredAt) {
          setSummary(null)
          setPage('session')
        }
      }),
      ovra().on('push:settings', (settings) => setData((d) => d && { ...d, settings })),
      ovra().on('push:session', (s) => setSession(s)),
      ovra().on('push:session-summary', (s) => {
        setSummary(s)
        setPage('session')
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  if (!data) return <div className="loading" aria-busy="true" />
  if (!data.privacy.answeredAt)
    return <Onboarding initial={data.privacy} onDone={(privacy) => setData({ ...data, privacy })} />

  const active = session && session.status !== 'ended' ? session : null

  const sessionPage = (): React.JSX.Element => {
    if (active?.status === 'calibrating') return <Calibration session={active} />
    if (active) return <Running session={active} />
    if (summary)
      return (
        <SessionSummaryView
          record={summary}
          title="Session done"
          backLabel="New session"
          onBack={() => setSummary(null)}
          onDeleted={() => setSummary(null)}
        />
      )
    return <NewSession privacy={data.privacy} settings={data.settings} onStarted={setSession} />
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <MoonOrb mood="calm" listening={false} away={false} size={22} label="Ovra" />
          <span>Ovra</span>
        </div>
        <ul>
          {NAV.map((n) => (
            <li key={n.page}>
              <button
                type="button"
                className="sidebar__item"
                data-nav={n.page}
                aria-current={page === n.page ? 'page' : undefined}
                onClick={() => setPage(n.page)}
              >
                {n.icon}
                {n.label}
                {n.page === 'session' && active && (
                  <span className="sidebar__live" aria-label="Session running" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="content">
        <div className="content__drag" />
        {page === 'session' && sessionPage()}
        {page === 'music' && <Music initialStatus={data.music} />}
        {page === 'history' && <History />}
        {page === 'privacy' && (
          <Privacy
            privacy={data.privacy}
            onChange={(privacy) => setData({ ...data, privacy })}
            onDeletedAll={load}
          />
        )}
        {page === 'settings' && (
          <Settings
            settings={data.settings}
            onChange={(settings) => setData({ ...data, settings })}
          />
        )}
      </main>
    </div>
  )
}
