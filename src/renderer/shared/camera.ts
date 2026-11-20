/** Shared by capture and display-only previews. This never requests microphone access. */
export function cameraConstraints(
  cameraId: string,
  video: MediaTrackConstraints | true = true
): MediaStreamConstraints {
  if (!cameraId) return { audio: false, video }
  const selected: MediaTrackConstraints = {
    ...(video === true ? {} : video),
    deviceId: { exact: cameraId }
  }
  delete selected.facingMode
  return { audio: false, video: selected }
}

export const CAMERA_FALLBACK =
  "Your chosen camera isn't connected, so Ovra is using the default one."

/** Retry only a missing selection; permission and busy-camera errors keep their real meaning. */
export async function openCamera(
  cameraId: string,
  onFallback: () => void,
  video: MediaTrackConstraints | true = true
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(cameraConstraints(cameraId, video))
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    if (!cameraId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw error
    const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints('', video))
    onFallback()
    return stream
  }
}
