#!/bin/zsh
# Spike: AppleScript control of the Spotify desktop app.
if [[ "$(osascript -e 'application "Spotify" is running' 2>/dev/null)" != true ]]; then
  print 'Spotify is not running; refusing to launch it.'
  exit 0
fi

saved_volume=$(osascript -e 'if application "Spotify" is running then tell application "Spotify" to get sound volume') || exit
saved_state=$(osascript -e 'if application "Spotify" is running then tell application "Spotify" to get player state') || exit
saved_track=$(osascript -e 'if application "Spotify" is running then tell application "Spotify" to if player state is not stopped then get spotify url of current track') || saved_track=''
restore() {
  trap - EXIT INT TERM
  [[ -n "$saved_track" ]] && osascript -e "tell application \"Spotify\" to play track \"$saved_track\"" >/dev/null 2>&1
  osascript -e "tell application \"Spotify\" to set sound volume to $saved_volume" >/dev/null 2>&1
  [[ "$saved_state" == paused ]] && osascript -e 'tell application "Spotify" to pause' >/dev/null 2>&1
}
trap restore EXIT INT TERM

q='tell application "Spotify" to if player state is not stopped then return (id of current track) & "|" & (name of current track) & "|" & (artist of current track) & "|" & (album of current track) & "|" & (duration of current track) & "|" & (player position) & "|" & (player state) & "|" & (spotify url of current track)'
osascript -e 'tell application "Spotify" to set sound volume to 15'
osascript -e "tell application \"Spotify\" to play track \"$1\""; sleep 3
osascript -e "$q"
osascript -e "tell application \"Spotify\" to play track \"$1\" in context \"$2\""; sleep 3
osascript -e "$q"
for i in 1 2 3 4 5; do osascript -e 'tell application "Spotify" to next track'; sleep 3; /usr/bin/time -p osascript -e "$q" 2>&1 | grep -v -E '^(user|sys)'; done
