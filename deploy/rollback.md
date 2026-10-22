# Rollback

Every `deploy/remote-up.sh` run keeps three tags on the VPS: `bazaar-companion:latest` (running),
`bazaar-companion:previous` (what was running before this deploy) and `bazaar-companion:<build-id>`
(one per deploy; `/api/health` reports the build id as `commit`). Rolling back is re-pointing `latest`
and restarting without a rebuild. All commands run on the VPS in the project directory (`/opt/bazaar`),
or prefix them with `ssh user@vps 'cd /opt/bazaar && ...'`.

## 1. Bad code deploy

```bash
cd /opt/bazaar
docker images bazaar-companion                       # pick the build id you want, or use "previous"
docker tag bazaar-companion:previous bazaar-companion:latest     # or bazaar-companion:<build-id>
docker compose up -d --no-build --force-recreate app             # add --profile proxy if you use Caddy
curl -s http://127.0.0.1:8080/api/health             # "commit" is now the old build id
```

Then run `deploy/smoke.sh <base-url>` from your machine. Note: running `remote-up.sh` again re-tags
`previous` to whatever is running at that moment, so if the second deploy was also bad, pick the build id
from `docker images` instead of `previous`.

Fix forward from git as usual afterwards: `git revert <bad-commit>` and `deploy/remote-up.sh`.

## 2. Bad data

```bash
cd /opt/bazaar/data
ls -l market.sqlite*                                 # market.sqlite.prev is the file before the last push-data
mv -f market.sqlite.prev market.sqlite               # keeps a single copy; or cp -p to keep both
cd .. && docker compose restart app                  # a running server keeps the old file open
```

Check `/api/meta` (`snapshotDate`, `dataVersion`). If `.prev` is gone, push the older database again with
`deploy/push-data.sh --file <path> --restart`.

## 3. Bad configuration

`.env` changes take effect on `docker compose up -d` (not on `restart`). Kill switch for the LLM: empty
`LLM_API_KEY` (or `LLM_RATE_LIMIT=0`) and `docker compose up -d`; the product then runs fully deterministically.

## 4. Take the site down

```bash
cd /opt/bazaar && docker compose --profile proxy down     # data, .env and certificates stay
```
