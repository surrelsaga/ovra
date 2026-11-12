#!/bin/zsh
# Spike: AppleScript control of the Spotify desktop app.
q='tell application "Spotify" to if player state is not stopped then return (id of current track) & "|" & (name of current track) & "|" & (artist of current track) & "|" & (album of current track) & "|" & (duration of current track) & "|" & (player position) & "|" & (player state) & "|" & (spotify url of current track)'
osascript -e 'tell application "Spotify" to set sound volume to 15'
osascript -e "tell application \"Spotify\" to play track \"$1\"" ; sleep 3
osascript -e "$q"
osascript -e "tell application \"Spotify\" to play track \"$1\" in context \"$2\"" ; sleep 3
osascript -e "$q"
for i in 1 2 3 4 5; do osascript -e 'tell application "Spotify" to next track'; sleep 3; /usr/bin/time -p osascript -e "$q" 2>&1 | grep -v -E '^(user|sys)'; done
osascript -e 'tell application "Spotify" to pause'
