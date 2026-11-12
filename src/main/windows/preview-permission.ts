export function canGrantPreviewPermission(
  webContentsId: number,
  mainWebContentsId: number | undefined,
  permission: string,
  calibrating: boolean,
  cameraConsent: boolean,
  mediaTypes?: string[],
  mediaType?: string
): boolean {
  return (
    permission === 'media' &&
    webContentsId === mainWebContentsId &&
    calibrating &&
    cameraConsent &&
    (mediaType === 'video' || !!mediaTypes?.includes('video')) &&
    !mediaTypes?.includes('audio') &&
    (!mediaType || mediaType === 'video')
  )
}
