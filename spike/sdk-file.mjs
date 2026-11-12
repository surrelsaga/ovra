// Spike: feed a test video into the SDK via useFile() and log summary stats.
// Never logs raw frames. Prints only summary numbers to stdout for spike notes.
import 'dotenv/config';
import { SmartSpectraSDK, ProcessingStatus, breathingMetrics, cardioMetrics, faceMetrics } from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

const file = process.argv[2];
const withFace = process.argv.includes('--face');
const realtime = process.argv.includes('--realtime');
const sdk = new SmartSpectraSDK({
  apiKey: process.env.PRESAGE_API_KEY,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...(withFace ? faceMetrics : [])],
  enableTelemetry: false,
});
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const first = {};
const validation = [];
let lastVal = null;
const counts = { metrics: 0 };
let sample = null;
let landmarkInfo = null;
const exprs = {};
let blinks = 0, talks = 0, lastTs = 0;
const pulse = [], br = [], hrv = [];
sdk.on('processingStatus', (s) => console.log(`[${el()}s] status`, s));
sdk.on('validationStatus', (code, ts, hint) => {
  if (code !== lastVal) { validation.push({ t: (ts / 1e6).toFixed(1), code, hint }); lastVal = code; }
});
sdk.on('error', (code, msg, r) => console.error(`[${el()}s] ERROR`, code, msg, r));
sdk.on('metrics', (buf, ts) => {
  counts.metrics++; lastTs = ts;
  const m = decodeMetrics(buf);
  const vt = (ts / 1e6).toFixed(1);
  const p = m.cardio?.pulseRate?.at(-1); if (p) { pulse.push({ t: vt, v: +p.value.toFixed(1), c: Math.round(p.confidence), s: p.stable }); if (p.stable && !first.pulseStable) first.pulseStable = vt; if (!first.pulse) first.pulse = vt; }
  const b = m.breathing?.rate?.at(-1); if (b) { br.push({ t: vt, v: +b.value.toFixed(1), c: Math.round(b.confidence), s: b.stable }); if (b.stable && !first.brStable) first.brStable = vt; if (!first.br) first.br = vt; }
  const h = m.cardio?.hrv?.at(-1); if (h) { hrv.push({ t: vt, rmssd: +h.rmssd.toFixed(1), baevsky: +h.baevsky.toFixed(1), c: Math.round(h.confidence), s: h.stable }); if (h.stable && !first.hrvStable) first.hrvStable = vt; if (!first.hrv) first.hrv = vt; }
  if (m.face) {
    const lm = m.face.landmarks?.at(-1); if (lm && !landmarkInfo) landmarkInfo = { keys: Object.keys(lm), n: lm.value?.length, first: JSON.stringify(lm.value?.[0]) };
    for (const x of m.face.blinking ?? []) if (x.detected) blinks++;
    for (const x of m.face.talking ?? []) if (x.detected) talks++;
    const e = m.face.expression?.at(-1); if (e) { if (!sample) sample = JSON.stringify(e).slice(0, 400); }
  }
});
const cpu0 = process.cpuUsage();
let peakRss = 0; const iv = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 500);
const done = new Promise((res) => { let started = false; sdk.on('processingStatus', (s) => { if (s === ProcessingStatus.kRunning) started = true; if (started && (s === ProcessingStatus.kIdle || s === ProcessingStatus.kError)) res(); }); });
sdk.useFile(file, realtime ? { interframeDelayMs: 33 } : {});
sdk.start();
await done; clearInterval(iv);
const cpu = process.cpuUsage(cpu0);
await sdk.destroy();
const pick = (a) => a.filter((_, i) => i % Math.max(1, Math.floor(a.length / 12)) === 0);
console.log(JSON.stringify({ file: file.split('/').pop(), wallSec: +el(), videoSecSeen: +(lastTs / 1e6).toFixed(1), cpuSec: +((cpu.user + cpu.system) / 1e6).toFixed(1), peakRssMB: Math.round(peakRss / 1e6), counts, first, validation: validation.slice(0, 40), pulse: pick(pulse), br: pick(br), hrv: pick(hrv), face: withFace ? { landmarkInfo, blinks, talks, exprSample: sample } : null }, null, 1));
