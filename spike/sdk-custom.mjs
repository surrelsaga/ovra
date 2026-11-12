// Spike: decode a test video with ffmpeg (in memory, piped) and feed RGB frames via sendFrame().
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { SmartSpectraSDK, FrameTransform, PixelFormat, breathingMetrics, cardioMetrics, faceMetrics } from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
const file = process.argv[2]; const withFace = process.argv.includes('--face');
const W = 1280, H = 720, FPS = 30, FRAME = W * H * 3;
const sdk = new SmartSpectraSDK({ apiKey: process.env.PRESAGE_API_KEY, requestedMetrics: [...(process.argv.includes("--cardio") ? [] : breathingMetrics), ...cardioMetrics, ...(withFace ? faceMetrics : [])], enableTelemetry: false });
const t0 = Date.now(); const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const val = []; let lastVal = null; let n = 0;
const first = {}; const pulse = [], br = [], hrv = []; let face = { blinks: 0, talks: 0, lm: null, expr: {}, exprSample: null, lmSeries: [] };
sdk.on('processingStatus', (s) => console.error(`[${el()}s] status ${s}`));
sdk.on('error', (c, m, r) => console.error(`[${el()}s] ERROR ${c} ${m} ${r}`));
sdk.on('validationStatus', (code, ts, hint) => { if (code !== lastVal) { val.push(`${(ts/1e6).toFixed(1)}s:${code}:${hint}`); lastVal = code; } });
sdk.on('metrics', (buf, ts) => {
  n++; const m = decodeMetrics(buf); const vt = +(ts / 1e6).toFixed(1);
  const p = m.cardio?.pulseRate?.at(-1); if (p) { pulse.push([vt, +p.value.toFixed(1), Math.round(p.confidence), p.stable]); if (!first.pulse) first.pulse = vt; if (p.stable && !first.pulseStable) first.pulseStable = vt; }
  const b = m.breathing?.rate?.at(-1); if (b) { br.push([vt, +b.value.toFixed(1), Math.round(b.confidence), b.stable]); if (!first.br) first.br = vt; if (b.stable && !first.brStable) first.brStable = vt; }
  const h = m.cardio?.hrv?.at(-1); if (h) { hrv.push([vt, +h.rmssd.toFixed(1), +h.baevsky.toFixed(1), Math.round(h.confidence), h.stable]); if (!first.hrv) first.hrv = vt; if (h.stable && !first.hrvStable) first.hrvStable = vt; }
  if (m.face) {
    const lm = m.face.landmarks?.at(-1);
    if (lm) { if (!face.lm) face.lm = { keys: Object.keys(lm), n: lm.value?.length, p0: JSON.stringify(lm.value?.[0]) };
      const v = lm.value; if (v?.length > 300) { const a = v[33], b2 = v[263]; const roll = Math.atan2(b2.y - a.y, b2.x - a.x) * 180 / Math.PI; const nose = v[1]; face.lmSeries.push([vt, +roll.toFixed(1), +nose.x.toFixed(0), +nose.y.toFixed(0)]); } }
    for (const x of m.face.blinking ?? []) if (x.detected) face.blinks++;
    for (const x of m.face.talking ?? []) if (x.detected) face.talks++;
    const e = m.face.expression?.at(-1); if (e) { if (!face.exprSample) face.exprSample = JSON.stringify(e).slice(0, 500); }
  }
});
const cpu0 = process.cpuUsage(); let peak = 0; const iv = setInterval(() => peak = Math.max(peak, process.memoryUsage().rss), 500);
sdk.useCustomInput(FrameTransform.kNone);
await sdk.start();
const ff = spawn('ffmpeg', ['-v', 'error', '-re', ...(process.env.DUR ? ['-t', process.env.DUR] : []), '-i', file, '-vf', process.env.VF ?? `scale=${W}:${H},fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
let acc = Buffer.alloc(0); let fi = 0; const base = process.hrtime.bigint() / 1000n;
ff.stdout.on('data', (d) => { acc = Buffer.concat([acc, d]); while (acc.length >= FRAME) { const f = acc.subarray(0, FRAME); acc = acc.subarray(FRAME); sdk.sendFrame(Buffer.from(f), W, H, W * 3, PixelFormat.kRGB, Number(base) + Math.round(fi * 1e6 / FPS)); fi++; } });
await new Promise((r) => ff.on('close', r));
await sdk.stopAsync(); clearInterval(iv); const cpu = process.cpuUsage(cpu0); await sdk.destroy();
const pick = (a, k = 14) => a.filter((_, i) => i % Math.max(1, Math.floor(a.length / k)) === 0);
console.log(JSON.stringify({ file: file.split('/').pop(), frames: fi, wallSec: +el(), cpuSec: +((cpu.user + cpu.system) / 1e6).toFixed(1), peakRssMB: Math.round(peak / 1e6), metricsEvents: n, first, validation: val.slice(0, 40), pulse: pick(pulse), br: pick(br), hrv: pick(hrv), face: withFace ? { ...face, lmSeries: pick(face.lmSeries, 30) } : null }));
