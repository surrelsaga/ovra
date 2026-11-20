import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { ovra } from '../shared/bridge'

/** Listing devices never opens a camera, including before consent. */
export function CameraChoice({
  settings,
  onChange
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}): React.JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const media = navigator.mediaDevices
    if (!media?.enumerateDevices) return
    let cancelled = false
    const refresh = (): void => {
      void media.enumerateDevices().then(
        (list) => {
          if (!cancelled) setDevices(list.filter((device) => device.kind === 'videoinput'))
        },
        () => {
          if (!cancelled)
            setError('Couldn’t list cameras. Try again when your camera is connected.')
        }
      )
    }
    refresh()
    media.addEventListener?.('devicechange', refresh)
    return () => {
      cancelled = true
      media.removeEventListener?.('devicechange', refresh)
    }
  }, [])
  const save = async (cameraId: string): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      onChange(
        await ovra().invoke('settings:set', {
          cameraId,
          cameraLabel: devices.find((device) => device.deviceId === cameraId)?.label ?? ''
        })
      )
    } catch {
      setError('Couldn’t save your camera choice. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <label className="field">
        <span className="field__label">Camera</span>
        <select
          className="input"
          value={settings.cameraId}
          disabled={saving}
          onChange={(event) => void save(event.target.value)}
        >
          <option value="">Default camera</option>
          {settings.cameraId &&
            !devices.some((device) => device.deviceId === settings.cameraId) && (
              <option value={settings.cameraId}>
                {settings.cameraLabel || 'Chosen camera'} (not connected)
              </option>
            )}
          {devices.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
