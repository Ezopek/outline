#!/usr/bin/env bash
# Gate 2 image smoke checks for the wiki-lint Outline image (PRD §11 Gate 2:
# "image startup and packaged-artifact smoke checks"). Runs the image against
# throwaway PostgreSQL and Redis containers on a private network and checks the
# AD-19 startup and readiness behaviour. It publishes nothing and touches no
# deployment; every container and network it creates (labelled with this run)
# is removed, each container with its anonymous volumes. It refuses an OUT_DIR that already holds
# results, so earlier evidence is never overwritten.
#
#   docs/wikilint-gate-2/gate2-smoke.sh IMAGE OUT_DIR [POSTGRES_IMAGE]
#
# IMAGE is a local tag or a digest reference; OUT_DIR receives results.txt and
# the container logs; keep OUT_DIR under $HOME (snap Docker cannot mount /tmp). POSTGRES_IMAGE defaults to the production major
# (postgres:16-alpine). Exit status is 0 only when every check passes.
set -uo pipefail

image=${1:?image}; out=${2:?out dir}; pg_image=${3:-postgres:16-alpine}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
example="$here/../../server/wikiLint/policy.example.json"
run=wl-g2-$$; net=$run-net; failed=0
mkdir -p "$out"; out=$(cd "$out" && pwd); results="$out/results.txt"
[ -e "$results" ] && { echo "refusing to overwrite existing evidence: $results"; exit 2; }
work=$(mktemp -d "$out/.work.XXXXXX"); : > "$results"
label="wikilint-gate2-smoke=$run"

# Removes only what this run created: containers and network carry its label,
# and anonymous volumes go with their containers (-v).
cleanup() {
  docker ps -aq --filter "label=$label" | xargs -r docker rm -f -v >/dev/null 2>&1
  docker network ls -q --filter "label=$label" | xargs -r docker network rm >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

record() { # id outcome detail
  echo "$1 $2 $3" | tee -a "$results"
  [ "$2" = pass ] || failed=1
}

digest=$(docker image inspect --format '{{.Id}}' "$image") || { echo "no such image: $image"; exit 2; }
echo "image $image $digest; postgres $pg_image; $(date -u +%FT%TZ)" | tee -a "$results"

docker network create --label "$label" "$net" >/dev/null
docker run -d --label "$label" --name $run-pg --network "$net" -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=outline "$pg_image" >/dev/null
docker run -d --label "$label" --name $run-redis --network "$net" redis:7-alpine >/dev/null
for i in $(seq 1 120); do
  docker exec $run-pg pg_isready -U user -d outline >/dev/null 2>&1 && \
    [ "$(docker logs $run-pg 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] && break
  [ "$i" = 120 ] && { echo "postgres not ready within 120 s" | tee -a "$results"; exit 2; }
  sleep 1
done

secret=$(openssl rand -hex 32); utils=$(openssl rand -hex 32)

# start NAME [extra docker args...]: starts the app; prints nothing.
start() {
  local name=$1; shift
  docker run -d --label "$label" --name "$run-$name" --network "$net" \
    -e NODE_ENV=production -e PGSSLMODE=disable \
    -e DATABASE_URL=postgres://user:pass@$run-pg:5432/outline -e REDIS_URL=redis://$run-redis:6379 \
    -e SECRET_KEY="$secret" -e UTILS_SECRET="$utils" -e URL=http://localhost:3000 \
    "$@" "$image" >/dev/null
}

# health NAME: waits up to 180 s for /_health, probed from inside the container
# with the image's own wget (published ports are not needed); prints
# "<status> <fingerprint> <body>", "exited" or "timeout".
health() {
  local name=$1 raw status
  for _ in $(seq 1 180); do
    [ "$(docker inspect -f '{{.State.Running}}' "$run-$name" 2>/dev/null)" = true ] || { echo "exited"; return 0; }
    raw=$(docker exec "$run-$name" wget -q -S --content-on-error -O- http://localhost:3000/_health 2>&1 || true)
    status=$(echo "$raw" | sed -n 's/^ *HTTP\/[0-9.]* \([0-9]*\).*/\1/p' | tail -1)
    if [ -n "$status" ]; then
      echo "$status $(echo "$raw" | grep -i 'x-wiki-lint-policy-set-fingerprint:' | tail -1 | sed 's/^[^:]*: *//' | tr -d '\r') $(echo "$raw" | grep -v '^ ' | tail -1 | head -c 20)"
      return 0
    fi
    sleep 1
  done
  echo "timeout"
}

stop() { docker logs "$run-$1" > "$out/$1.log" 2>&1; docker rm -f -v "$run-$1" >/dev/null; }

# S1: no policy file. Upstream behaviour, ready.
start s1; r=$(health s1); stop s1
[[ $r == "200 sha256:"*" OK" ]] && record S1-no-policy pass "$r" || record S1-no-policy fail "$r"

# S2: the generic read_only example, mounted read-only. Ready without an expected fingerprint.
start s2 -v "$example:/etc/wikilint/policy.json:ro" -e WIKI_LINT_CONFIG_PATH=/etc/wikilint/policy.json
r=$(health s2); stop s2
if [[ $r == "200 sha256:"*" OK" ]] && grep -q "Wiki lint policy configuration loaded" "$out/s2.log"; then
  record S2-read-only-example pass "$r"; else record S2-read-only-example fail "$r"; fi

# S3: the example with a wrong expected fingerprint. Not ready.
start s3 -v "$example:/etc/wikilint/policy.json:ro" -e WIKI_LINT_CONFIG_PATH=/etc/wikilint/policy.json \
  -e WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT=sha256:0000000000000000000000000000000000000000000000000000000000000000
r=$(health s3); stop s3
[[ $r == "503 sha256:"* ]] && record S3-wrong-expected-fingerprint pass "$r" || record S3-wrong-expected-fingerprint fail "$r"

# S4: the example switched to enforced. Not ready without the expected fingerprint; ready with it.
sed 's/"read_only"/"enforced"/' "$example" > "$work/enforced.json"; chmod 644 "$work/enforced.json"
start s4a -v "$work/enforced.json:/etc/wikilint/policy.json:ro" -e WIKI_LINT_CONFIG_PATH=/etc/wikilint/policy.json
r=$(health s4a); stop s4a; fingerprint=$(echo "$r" | cut -d' ' -f2)
[[ $r == "503 sha256:"* ]] && record S4a-enforced-unconfirmed pass "$r" || record S4a-enforced-unconfirmed fail "$r"
start s4b -v "$work/enforced.json:/etc/wikilint/policy.json:ro" -e WIKI_LINT_CONFIG_PATH=/etc/wikilint/policy.json \
  -e WIKI_LINT_EXPECTED_CONFIG_FINGERPRINT="$fingerprint"
r=$(health s4b); stop s4b
[[ $r == "200 $fingerprint OK" ]] && record S4b-enforced-confirmed pass "$r" || record S4b-enforced-confirmed fail "$r"

# S5: a malformed file. The process stops after logging one code and position, and no content.
printf '{"schemaVersion": 1, "collections": {"SECRET-MARKER-%s": ' "$run" > "$work/malformed.json"; chmod 644 "$work/malformed.json"
start s5 -v "$work/malformed.json:/etc/wikilint/policy.json:ro" -e WIKI_LINT_CONFIG_PATH=/etc/wikilint/policy.json
r=$(health s5); stop s5
if [[ $r == exited ]] && grep -q '"code":"POLICY_CONFIGURATION_MALFORMED"' "$out/s5.log" && \
   grep -qE '"location":[0-9]+' "$out/s5.log" && ! grep -q "SECRET-MARKER" "$out/s5.log"; then
  record S5-malformed-policy pass "$r"; else record S5-malformed-policy fail "$r"; fi

# S6: packaged artifacts. Node is the Dockerfile runner pin, the lint build and the generic example are present,
# and the image carries no policy file of its own beyond the example.
a=$(docker run --rm --entrypoint sh "$image" -c 'node --version; test -f build/server/tools/wikiLint.js && echo tools; test -d build/server/wikiLint/core && echo core; test -f server/wikiLint/policy.example.json && echo example; find /opt/outline/server/wikiLint /opt/outline/build/server/wikiLint -name "*.json" 2>/dev/null | grep -v node_modules | tr "\\n" " "' | tr '\n' ' ')
want="$(sed -n 's/^FROM node:\([0-9.]*\)-slim AS runner/v\1/p' "$here/../../Dockerfile")"
[[ $a == "$want tools core example /opt/outline/server/wikiLint/policy.example.json " ]] && record S6-packaged-artifacts pass "$a" || record S6-packaged-artifacts fail "$a"

echo "overall $([ $failed = 0 ] && echo pass || echo fail)" | tee -a "$results"
exit $failed
