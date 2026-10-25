#!/usr/bin/env bash
# AD-17 reference stack on this host: PostgreSQL 14.2, Redis and the locally built app image,
# each in its own container with pinned cores and limits. Usage: ad17-stack.sh up|run ARGS...|down
set -euo pipefail
repo=/home/ezop/repos/outline
commit=${AD17_COMMIT:?}; img=outline:wikilint-$commit
digest=$(docker inspect --format '{{.Id}}' "$img")
net=ad17-net; ev=${AD17_EVIDENCE:?}
case "$1" in
  up)
    docker network create $net >/dev/null
    docker volume create ad17-pgdata >/dev/null
    docker run -d --name ad17-pg --network $net --cpus=2 --cpuset-cpus=2,3 --memory=4g --memory-swap=4g --shm-size=1g \
      -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=outline-bench \
      -v ad17-pgdata:/var/lib/postgresql/data postgres:14.2 >/dev/null
    docker run -d --name ad17-redis --network $net --cpus=1 --cpuset-cpus=6 --memory=512m redis:7.4.2 >/dev/null
    until docker exec ad17-pg pg_isready -U user -d outline-bench >/dev/null 2>&1; do sleep 1; done
    echo "up: pg $(docker exec ad17-pg psql -U user -d outline-bench -tAc 'show server_version'), image $digest"
    ;;
  run)
    shift
    mkdir -p "$ev"; chmod 777 "$ev"
    docker run --rm --name ad17-app --network $net --cpus=2 --cpuset-cpus=4,5 --memory=4g --memory-swap=4g -u root \
      -v $repo/yarn.lock:/opt/outline/yarn.lock:ro -v $repo/.yarnrc.yml:/opt/outline/.yarnrc.yml:ro \
      -v $repo/Dockerfile:/opt/outline/Dockerfile:ro -v "$ev":/evidence \
      -e NODE_ENV=production -e PGSSLMODE=disable \
      -e DATABASE_URL=postgres://user:pass@ad17-pg:5432/outline-bench -e REDIS_URL=redis://ad17-redis:6379 \
      -e SECRET_KEY=$(openssl rand -hex 32) -e UTILS_SECRET=$(openssl rand -hex 32) -e URL=http://localhost:3000 \
      -e WIKILINT_BENCH_POSTGRES_CPUS=2 -e WIKILINT_BENCH_POSTGRES_MEMORY_BYTES=4294967296 \
      -e WIKILINT_BENCH_IMAGE_DIGEST=$digest -e WIKILINT_BENCH_SOURCE_COMMIT=$commit \
      ${AD17_ATTEST:+-e WIKILINT_BENCH_ATTEST_SAME_HOST=yes -e WIKILINT_BENCH_ATTEST_LOCAL_SSD=yes -e WIKILINT_BENCH_ATTEST_NO_ARTIFICIAL_LATENCY=yes -e WIKILINT_BENCH_ATTEST_NO_COMPETING_TRAFFIC=yes} \
      "$img" sh -c 'set -e; npm i -g corepack >/dev/null 2>&1; cd /opt/outline;
        su nodejs -s /bin/sh -c "cd /opt/outline && node_modules/.bin/sequelize db:migrate --env production-ssl-disabled >/evidence/migrate.log 2>&1 && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack yarn node build/server/wikiLint/benchmark/run.js $*"' sh "$@"
    ;;
  down)
    docker rm -f ad17-app ad17-pg ad17-redis >/dev/null 2>&1 || true
    docker volume rm ad17-pgdata >/dev/null 2>&1 || true
    docker network rm $net >/dev/null 2>&1 || true
    echo down
    ;;
esac
