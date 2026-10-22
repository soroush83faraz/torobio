#!/usr/bin/env bash
# Smoke test of a running deployment (read-only, sends about ten small requests).
#
#   deploy/smoke.sh <base-url> [--insecure] [--text "<persian shopping text>"]
#   deploy/smoke.sh http://127.0.0.1:8080
#   deploy/smoke.sh https://bazaar.example.com
#
# Checks: /api/health (status ok, db true), /api/meta (snapshot + counts), the chain
# parse -> resolve -> plan on a sample list, and that the Persian page and its assets load.
# Exit code: 0 all passed, 1 a check failed, 2 usage / missing tool.
set -euo pipefail

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

BASE=""
TEXT="یک لپ تاپ و یک ماوس"
CURL_EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help) usage ;;
    --insecure) CURL_EXTRA+=(-k) ;;
    --text)
      [[ $# -ge 2 ]] || usage
      TEXT="$2"
      shift
      ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) [[ -z "$BASE" ]] || usage; BASE="${1%/}" ;;
  esac
  shift
done
[[ -n "$BASE" ]] || usage
for tool in curl jq; do
  command -v "$tool" > /dev/null || { echo "smoke: '$tool' is required (apt install $tool)" >&2; exit 2; }
done

echo "smoke: target $BASE"
FAILS=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

CURL=(curl -sS --max-time 15 ${CURL_EXTRA[@]+"${CURL_EXTRA[@]}"})
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# get <path>  -> body in $TMP, prints HTTP status
get() { "${CURL[@]}" -o "$TMP" -w '%{http_code}' "$BASE$1" 2> /dev/null || echo 000; }
# post <path> <json>
post() { "${CURL[@]}" -o "$TMP" -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$2" "$BASE$1" 2> /dev/null || echo 000; }

# 1. health ---------------------------------------------------------------------------------
code="$(get /api/health)"
if [[ "$code" == 200 ]] && jq -e '.status == "ok" and .db == true' "$TMP" > /dev/null 2>&1; then
  pass "GET /api/health -> $(jq -c '{status,db,llm,commit}' "$TMP")"
else
  fail "GET /api/health (http $code): $(head -c 200 "$TMP") -- db:false means market.sqlite is missing in ./data"
fi

# 2. meta -----------------------------------------------------------------------------------
code="$(get /api/meta)"
if [[ "$code" == 200 ]] && jq -e '.data.snapshotDate != "" and .data.counts.products > 0' "$TMP" > /dev/null 2>&1; then
  pass "GET /api/meta -> $(jq -c '.data | {snapshotDate, dataVersion, products: .counts.products, offers: .counts.offers, shops: .counts.shops}' "$TMP")"
else
  fail "GET /api/meta (http $code)"
fi

# 3. parse -> resolve -> plan ----------------------------------------------------------------
PARSE_BODY="$(jq -cn --arg t "$TEXT" '{text: $t}')"
code="$(post /api/parse "$PARSE_BODY")"
STATE=""
if [[ "$code" == 200 ]] && jq -e '(.data.items | length) >= 1' "$TMP" > /dev/null 2>&1; then
  pass "POST /api/parse -> $(jq -c '{items: (.data.items | length), source: .data.source, title: .data.title}' "$TMP")"
  # The parser's items go to the next calls verbatim (the API is stateless: the whole state travels with every
  # call). Every item is "settled" (the visible default rule), so the plan has real stops and a total.
  STATE="$(jq -c '{state: ({requirements: .data.items, settled: (.data.items | map({key: .id, value: true}) | from_entries)}
    + (if .data.preference then {preference: .data.preference} else {} end))}' "$TMP")"
else
  fail "POST /api/parse (http $code): $(head -c 200 "$TMP")"
fi

if [[ -n "$STATE" ]]; then
  code="$(post /api/resolve "$STATE")"
  if [[ "$code" == 200 ]] && jq -e '(.data.items | length) >= 1' "$TMP" > /dev/null 2>&1; then
    pass "POST /api/resolve -> $(jq -c '{items: (.data.items | length), pendingItemCount: .data.pendingItemCount}' "$TMP")"
  else
    fail "POST /api/resolve (http $code): $(head -c 200 "$TMP")"
  fi
  code="$(post /api/plan "$STATE")"
  if [[ "$code" == 200 ]] && jq -e '(.data.stops | length) >= 1 and .data.totalToman > 0' "$TMP" > /dev/null 2>&1; then
    pass "POST /api/plan -> $(jq -c '.data | {stopCount, shopCount, totalToman, complete}' "$TMP")"
  else
    fail "POST /api/plan (http $code): $(head -c 200 "$TMP")"
  fi
else
  fail "POST /api/resolve and /api/plan skipped (no parse result)"
fi

# 4. the Persian page and its assets --------------------------------------------------------
code="$(get /)"
if [[ "$code" == 200 ]] && grep -q 'lang="fa"' "$TMP" && grep -q 'dir="rtl"' "$TMP"; then
  pass "GET / -> Persian page (lang=fa, dir=rtl, $(wc -c < "$TMP" | tr -d ' ') bytes)"
  mapfile -t ASSETS < <(grep -oE '(src|href)="/assets/[^"]+"' "$TMP" | sed -E 's/^[a-z]+="//; s/"$//' | sort -u)
  if [[ ${#ASSETS[@]} -eq 0 ]]; then
    fail "page references no /assets/* files: the web app was not built into the image (placeholder page?)"
  else
    bad=0
    for a in "${ASSETS[@]}"; do
      c="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$a" 2> /dev/null || echo 000)"
      [[ "$c" == 200 ]] || { fail "asset $a -> http $c"; bad=1; }
    done
    [[ "$bad" == 0 ]] && pass "${#ASSETS[@]} asset(s) load (200)"
  fi
else
  fail "GET / (http $code): expected the Persian page (lang=\"fa\" dir=\"rtl\")"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "smoke: PASSED"
else
  echo "smoke: FAILED ($FAILS check(s))"
  exit 1
fi
