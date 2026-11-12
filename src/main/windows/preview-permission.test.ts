import { canGrantPreviewPermission } from './preview-permission'

describe('calibration preview permission', () => {
  it('allows video only for the consenting main window during calibration', () => {
    expect(canGrantPreviewPermission(1, 1, 'media', true, true, ['video'])).toBe(true)
    expect(canGrantPreviewPermission(2, 1, 'media', true, true, ['video'])).toBe(false)
    expect(canGrantPreviewPermission(1, 1, 'media', false, true, ['video'])).toBe(false)
    expect(canGrantPreviewPermission(1, 1, 'media', true, false, ['video'])).toBe(false)
    expect(canGrantPreviewPermission(1, 1, 'audio', true, true, ['video'])).toBe(false)
    expect(canGrantPreviewPermission(1, 1, 'media', true, true, ['video', 'audio'])).toBe(false)
    expect(canGrantPreviewPermission(1, 1, 'media', true, true, undefined, 'audio')).toBe(false)
  })
})
