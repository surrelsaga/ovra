export function canGrantPreviewPermission(
  webContentsId: number,
  mainWebContentsId: number | undefined,
  permission: string,
  sessionActive: boolean,
  cameraConsent: boolean,
  mediaTypes?: string[],
  mediaType?: string
): boolean {
  return (
    permission === 'media' &&
    webContentsId === mainWebContentsId &&
    sessionActive &&
    cameraConsent &&
    (mediaType === 'video' || !!mediaTypes?.includes('video')) &&
    !mediaTypes?.includes('audio') &&
    (!mediaType || mediaType === 'video')
  )
}
