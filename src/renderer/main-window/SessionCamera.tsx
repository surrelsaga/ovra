import { useEffect, useState } from 'react'
import { CAMERA_FALLBACK, openCamera } from '../shared/camera'

/** A display-only stream: no SDK, canvas, IPC or recording. Unmounting releases it. */
export function SessionCamera({ cameraId = '' }: { cameraId?: string }): React.JSX.Element {
  const [fallback, setFallback] = useState(false)
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const [error, setError] = useState(() => !navigator.mediaDevices?.getUserMedia)
  useEffect(() => {
    if (error) return
    let stream: MediaStream | null = null
    let cancelled = false
    const stop = (): void => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
    window.addEventListener('pagehide', stop)
    window.addEventListener('beforeunload', stop)
    void openCamera(cameraId, () => {
      if (!cancelled) setFallback(true)
    }).then(
      (result) => {
        if (cancelled) result.getTracks().forEach((track) => track.stop())
        else {
          stream = result
          setPreview(result)
        }
      },
      () => {
        if (!cancelled) setError(true)
      }
    )
    return () => {
      stop()
      window.removeEventListener('pagehide', stop)
      window.removeEventListener('beforeunload', stop)
    }
  }, [error, cameraId])
  return error ? (
    <p className="muted" role="status">
      Camera preview isn’t available. Your session can continue.
    </p>
  ) : (
    <>
      {fallback && (
        <p className="muted" role="status">
          {CAMERA_FALLBACK}
        </p>
      )}
      <div className="calibration-preview" aria-label="Live camera preview">
        <video
          ref={(video) => {
            if (video && video.srcObject !== preview) video.srcObject = preview
          }}
          autoPlay
          muted
          playsInline
          onError={() => setError(true)}
        />
        <span>Not recorded</span>
      </div>
    </>
  )
}
