import { readFileSync } from 'node:fs'

const theme = readFileSync('src/shared/theme.css', 'utf8')
const ui = readFileSync('src/renderer/ui/ui.css', 'utf8')
const moon = readFileSync('src/renderer/ui/moon.css', 'utf8')
const token = (name: string): string => {
  const value = theme.match(new RegExp(`${name}:\\s*([^;]+);`))![1]
  return value.startsWith('var(') ? token(value.slice(4, -1)) : value
}
const luminance = (hex: string): number =>
  hex
    .slice(1)
    .match(/../g)!
    .reduce((sum, channel, i) => {
      const c = parseInt(channel, 16) / 255
      return (
        sum +
        (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
      )
    }, 0)

const hue = (hex: string): number => {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)!
    .map((c) => parseInt(c, 16))
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sector =
    max === r
      ? (g - b) / (max - min)
      : max === g
        ? (b - r) / (max - min) + 2
        : (r - g) / (max - min) + 4
  return (sector * 60 + 360) % 360
}

it('gives Away a distinct hue from every mood, with dark-surface contrast', () => {
  const away = token('--away')
  for (const mood of ['--focus', '--ok', '--warn', '--danger']) {
    const difference = Math.abs(hue(away) - hue(token(mood)))
    expect(Math.min(difference, 360 - difference)).toBeGreaterThanOrEqual(30)
  }
  for (const other of ['--focus', '--ok', '--warn', '--danger', '--text-muted', '--border'])
    expect(away).not.toBe(token(other))
  for (const surface of ['--bg', '--panel', '--panel-raised'])
    expect((luminance(away) + 0.05) / (luminance(token(surface)) + 0.05)).toBeGreaterThanOrEqual(3)
  // Both legend swatches and bar segments carry data-situation; the crescent shares the token.
  expect(ui).toMatch(/\[data-situation='away'\]\s*\{\s*background: var\(--away\)/)
  expect(moon).toMatch(/\.moon\[data-away\]\s*\{\s*--core: var\(--away\)/)
})
