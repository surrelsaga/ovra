import { mainWindowSize, windowsConfig } from './config'

it('opens with room for calibration and remains resizable down to the main minimum', () => {
  expect(mainWindowSize({ width: 1920, height: 1080 })).toEqual(windowsConfig.main)
})

it('fits the display work area, including displays smaller than the preferred minimum', () => {
  expect(mainWindowSize({ width: 1024, height: 768 })).toEqual({
    width: 1024,
    height: 768,
    minWidth: 900,
    minHeight: 600
  })
  expect(mainWindowSize({ width: 800, height: 550 })).toEqual({
    width: 800,
    height: 550,
    minWidth: 800,
    minHeight: 550
  })
})
