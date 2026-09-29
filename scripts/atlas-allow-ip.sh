#!/bin/sh
#
# Adds this machine's current public IP to the MongoDB Atlas project's IP
# Access List through the Atlas Admin API, so a changed home/campus IP no longer
# needs to be allowed by hand in the Atlas UI. Entries expire on their own
# (ATLAS_ALLOWLIST_TTL_HOURS, max 168 = Atlas's one-week limit), so stale IPs
# don't pile up. Re-adding an IP that is already listed just refreshes it.
#
# Required env (see .env.example): ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY,
# ATLAS_PROJECT_ID. Runs as the `atlas-allowlist` service in
# docker-compose.atlas.yml, or directly: `sh scripts/atlas-allow-ip.sh`.

set -eu

: "${ATLAS_PUBLIC_KEY:?ATLAS_PUBLIC_KEY is not set}"
: "${ATLAS_PRIVATE_KEY:?ATLAS_PRIVATE_KEY is not set}"
: "${ATLAS_PROJECT_ID:?ATLAS_PROJECT_ID is not set}"
TTL_HOURS="${ATLAS_ALLOWLIST_TTL_HOURS:-168}"
COMMENT="${ATLAS_ALLOWLIST_COMMENT:-auto: $(hostname)}"

ip=$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
if [ -z "$ip" ]; then
    echo "Could not determine public IP" >&2
    exit 1
fi

expires_at=$(date -u -d "@$(( $(date +%s) + TTL_HOURS * 3600 - 60 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -r "$(( $(date +%s) + TTL_HOURS * 3600 - 60 ))" +%Y-%m-%dT%H:%M:%SZ)

echo "Allowing $ip on Atlas project $ATLAS_PROJECT_ID until $expires_at"
curl -fsS --max-time 30 --digest -u "$ATLAS_PUBLIC_KEY:$ATLAS_PRIVATE_KEY" \
    -X POST "https://cloud.mongodb.com/api/atlas/v2/groups/$ATLAS_PROJECT_ID/accessList" \
    -H 'Accept: application/vnd.atlas.2023-01-01+json' \
    -H 'Content-Type: application/json' \
    -d "[{\"ipAddress\":\"$ip\",\"comment\":\"$COMMENT\",\"deleteAfterDate\":\"$expires_at\"}]" \
    -o /dev/null
echo "Atlas access list updated"
