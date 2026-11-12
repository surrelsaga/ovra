// Spike: Last.fm tags + one OpenRouter scoring call. Never prints keys.
import 'dotenv/config';
const songs = [['Rick Astley', 'Never Gonna Give You Up'], ['Dalby', 'New Light'], ['Ludovico Einaudi', 'Nuvole Bianche'], ['Nonexistent Artist Zzq', 'Fake Song Qqq']];
const out = [];
for (const [artist, track] of songs) {
  const u = `https://ws.audioscrobbler.com/2.0/?method=track.gettoptags&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&autocorrect=1&api_key=${process.env.LASTFM_API_KEY}&format=json`;
  const t = Date.now(); const r = await fetch(u); const j = await r.json();
  const tags = (j.toptags?.tag ?? []).slice(0, 8).map((x) => `${x.name}:${x.count}`);
  let artistTags = [];
  if (!tags.length) { const a = await (await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&api_key=${process.env.LASTFM_API_KEY}&format=json`)).json(); artistTags = (a.toptags?.tag ?? []).slice(0, 8).map((x) => x.name); }
  console.log(`lastfm ${r.status} ${Date.now() - t}ms ${artist} - ${track}:`, tags.join(', ') || `(none) artist: ${artistTags.join(', ') || '(none)'} ${j.error ? 'err ' + j.error + ' ' + j.message : ''}`);
  out.push({ artist, title: track, tags: tags.map((s) => s.split(':')[0]) });
}
const models = await (await fetch('https://openrouter.ai/api/v1/models')).json();
const free = models.data.filter((m) => m.id.endsWith(':free')).map((m) => m.id);
console.log('free models:', free.length, free.slice(0, 25).join(' '));
const model = process.argv[2] ?? free.find((m) => /llama-3.3-70b|gemma|deepseek|qwen/.test(m)) ?? free[0];
const prompt = `Score each song for a focus-music app. Use the tags and what you know. Return ONLY JSON: {"songs":[{"i":number,"energy":1-5,"mood":"dark"|"neutral"|"bright","vocals":"instrumental"|"light"|"heavy","confidence":0-1}]}. If you don't know a song and there are no tags, give confidence below 0.3.\n` + out.map((s, i) => `${i}. ${s.artist} - ${s.title} | tags: ${s.tags.join(', ') || 'none'}`).join('\n');
const t = Date.now();
const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0 }) });
const j = await r.json();
console.log('openrouter', model, r.status, `${Date.now() - t}ms`, j.error ? JSON.stringify(j.error).slice(0, 300) : j.choices?.[0]?.message?.content?.slice(0, 800), 'usage', JSON.stringify(j.usage ?? {}));
const k = await (await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } })).json();
const d = k.data ?? {}; console.log('key info: is_free_tier', d.is_free_tier, 'limit', d.limit, 'usage', d.usage, 'rate_limit', JSON.stringify(d.rate_limit ?? {}));
