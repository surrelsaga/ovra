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

it('gives Away one palette colour, distinct from moods and missing signal, with dark-surface contrast', () => {
  const away = token('--away')
  expect(away).toBe(token('--calm'))
  for (const other of ['--focus', '--ok', '--warn', '--danger', '--text-muted', '--border'])
    expect(away).not.toBe(token(other))
  for (const surface of ['--bg', '--panel', '--panel-raised'])
    expect((luminance(away) + 0.05) / (luminance(token(surface)) + 0.05)).toBeGreaterThanOrEqual(3)
  // Both legend swatches and bar segments carry data-situation; the crescent shares the token.
  expect(ui).toMatch(/\[data-situation='away'\]\s*\{\s*background: var\(--away\)/)
  expect(moon).toMatch(/\.moon\[data-away\]\s*\{\s*--core: var\(--away\)/)
})
