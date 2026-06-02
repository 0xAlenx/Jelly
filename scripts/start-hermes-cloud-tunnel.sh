#!/bin/sh
set -eu

exec /usr/bin/ssh \
  -NT \
  -i "$HOME/.ssh/jellyai-hermes-tunnel" \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=yes \
  -R 127.0.0.1:18650:127.0.0.1:8650 \
  jellytunnel@43.165.167.204
