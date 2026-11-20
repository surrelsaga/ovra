// Owner: Agent E. Check-ins, nudges, advanced thresholds, and the dev video source (dev builds only).
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { AppSettings, CheckinIntervalMin } from '@shared/types'
import { ovra } from '../shared/bridge'
import { Button, ChoiceGroup } from '../ui'
import { mainConfig } from './config'
import { CameraChoice } from './CameraChoice'

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function Settings(props: {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}): React.JSX.Element {
  const { settings } = props
  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    props.onChange(await ovra().invoke('settings:set', patch))
  }
  return (
    <section className="page" aria-labelledby="settings-title">
      <header className="page__header">
        <h1 id="settings-title">Settings</h1>
      </header>
      <div className="panel stack stack--loose">
        <CameraChoice settings={settings} onChange={props.onChange} />
        <ChoiceGroup<CheckinIntervalMin>
          legend="How often to use the camera"
          description="When you choose every few minutes, the camera runs for about 90 seconds, then turns off until the next time."
          name="checkin"
          options={mainConfig.checkinIntervals.map((m) => ({ value: m, label: `Every ${m} min` }))}
          value={settings.checkinIntervalMin}
          onChange={(v) => void save({ checkinIntervalMin: v })}
        />
        <ChoiceGroup
          legend="Break reminders"
          description="The most often Ovra will suggest a stretch or a break."
          name="nudges"
          options={mainConfig.nudgeIntervalsMin.map((m) => ({
            value: m,
            label: `At most every ${m} min`
          }))}
          value={settings.nudgeMinIntervalMin}
          onChange={(v) => void save({ nudgeMinIntervalMin: v })}
        />
      </div>
      <details className="panel advanced">
        <summary>Advanced: mood rules</summary>
        <Thresholds
          overrides={settings.thresholdOverrides}
          onChange={(thresholdOverrides) => void save({ thresholdOverrides })}
        />
      </details>
      {ovra().isDev && <DevSource settings={settings} save={save} />}
    </section>
  )
}

function Thresholds(props: {
  overrides: Record<string, number>
  onChange: (o: Record<string, number>) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const entries = Object.entries(props.overrides)
  const set = (k: string, v: number | null): void => {
    const next = { ...props.overrides }
    if (v === null) delete next[k]
    else next[k] = v
    props.onChange(next)
  }
  return (
    <div className="stack">
      <p className="muted small">
        Change a mood rule by its code name, for example <code>tensePulsePct</code> = 0.12. Leave
        empty to use the defaults.
      </p>
      {entries.map(([k, v]) => (
        <div key={k} className="threshold">
          <code>{k}</code>
          <input
            className="input input--small"
            type="number"
            step="any"
            aria-label={`Value for ${k}`}
            defaultValue={v}
            onBlur={(e) =>
              Number.isFinite(e.target.valueAsNumber) && set(k, e.target.valueAsNumber)
            }
          />
          <Button
            variant="ghost"
            icon={<X />}
            aria-label={`Remove ${k}`}
            onClick={() => set(k, null)}
          />
        </div>
      ))}
      <form
        className="threshold"
        onSubmit={(e) => {
          e.preventDefault()
          const v = Number(value)
          if (!name.trim() || !Number.isFinite(v)) return
          set(name.trim(), v)
          setName('')
          setValue('')
        }}
      >
        <input
          className="input"
          aria-label="Rule name"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input input--small"
          type="number"
          step="any"
          aria-label="Rule value"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" icon={<Plus />} disabled={!name.trim() || value === ''}>
          Add
        </Button>
      </form>
    </div>
  )
}

function DevSource(props: {
  settings: AppSettings
  save: (p: Partial<AppSettings>) => Promise<void>
}): React.JSX.Element {
  const { settings, save } = props
  const [videos, setVideos] = useState<string[]>([])
  const [pad, setPad] = useState(settings.devFramingPad)
  useEffect(() => {
    ovra()
      .invoke('dev:list-videos')
      .then(setVideos)
      .catch(() => setVideos([]))
  }, [])
  const { min, max, step } = mainConfig.framingPad
  return (
    <div className="panel stack dev">
      <h2 className="panel__title">
        Developer <span className="badge">dev build only</span>
      </h2>
      <label className="field">
        <span className="field__label">Video source</span>
        <select
          className="input"
          value={settings.devVideoSource ?? ''}
          onChange={(e) => void save({ devVideoSource: e.target.value || null })}
        >
          <option value="">Live camera</option>
          {videos.map((v) => (
            <option key={v} value={v}>
              {basename(v)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">
          Space below the video{' '}
          <span className="muted">({Math.round(pad * 100)}% extra space below)</span>
        </span>
        <input
          type="range"
          className="range"
          min={min}
          max={max}
          step={step}
          value={pad}
          onChange={(e) => setPad(e.target.valueAsNumber)}
          onPointerUp={() => void save({ devFramingPad: pad })}
          onKeyUp={() => void save({ devFramingPad: pad })}
        />
      </label>
    </div>
  )
}
