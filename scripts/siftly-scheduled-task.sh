#!/bin/bash
set -u

ROOT="/Users/takahiro/Projects/Siftly"
BASE_URL="${SIFTLY_BASE_URL:-http://localhost:15000}"
MODE="${1:-}"
LOG_PREFIX="[siftly-scheduled:${MODE:-unknown}]"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$*"
}

read_env_value() {
  local key="$1"
  local value
  value=$(sed -n "s/^${key}=//p" "$ROOT/.env" 2>/dev/null | tail -n 1)
  value="${value#\"}"
  value="${value%\"}"
  printf '%s' "$value"
}

DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL-$(read_env_value DISCORD_WEBHOOK_URL)}"
SIFTLY_USERNAME="${SIFTLY_USERNAME-$(read_env_value SIFTLY_USERNAME)}"
SIFTLY_PASSWORD="${SIFTLY_PASSWORD-$(read_env_value SIFTLY_PASSWORD)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local args=(--silent --show-error --fail-with-body --max-time 1800)
  if [[ -n "$SIFTLY_USERNAME" && -n "$SIFTLY_PASSWORD" ]]; then
    args+=(--user "$SIFTLY_USERNAME:$SIFTLY_PASSWORD")
  fi
  args+=(-X "$method" "$BASE_URL$path")
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  curl "${args[@]}"
}

notify() {
  local message="$1"

  local payload
  payload=$("$NODE_BIN" -e 'console.log(JSON.stringify({content: process.argv[1]}))' "$message") || return 1
  if curl --silent --show-error --fail-with-body --max-time 30 -X POST \
    -H 'Content-Type: application/json' \
    --data "$payload" \
    "$DISCORD_WEBHOOK_URL" >/dev/null; then
    return 0
  fi
  log 'Discord notification failed'
  return 1
}

json_summary() {
  local json="$1"
  [[ -z "$NODE_BIN" ]] && { printf 'unknown\t\t?\t?\t0\ttrue\tfalse'; return 0; }
  "$NODE_BIN" -e '
    try {
      const value = JSON.parse(process.argv[1]);
      const counts = value.stageCounts ?? {};
      console.log([
        value.status ?? "unknown",
        value.runId ?? "",
        value.done ?? "?",
        value.total ?? "?",
        counts.categorized ?? 0,
        Boolean(value.lastError || value.error),
        value.error === "Stopped by user",
      ].join("\t").replace(/[\r\n]/g, " "));
    } catch {
      console.log("invalid\t\t?\t?\t0\ttrue\tfalse");
    }
  ' "$json"
}

json_import_summary() {
  local json="$1"
  [[ -z "$NODE_BIN" ]] && { printf '0\t0\t?\tfalse\tunknown\tinvalid_response'; return 0; }
  "$NODE_BIN" -e '
    try {
      const value = JSON.parse(process.argv[1]);
      const codes = Array.isArray(value.warnings)
        ? value.warnings.map((warning) => warning?.code).filter((code) => typeof code === "string" && /^[a-z_]+$/.test(code)).join(",")
        : "";
      console.log([
        Number.isFinite(value.imported) ? value.imported : 0,
        Number.isFinite(value.skipped) ? value.skipped : 0,
        Number.isFinite(value.total) ? value.total : "?",
        value.complete === true,
        value.hasMore === true ? "true" : value.hasMore === false ? "false" : "unknown",
        codes || "none",
      ].join("\t"));
    } catch {
      console.log("0\t0\t?\tfalse\tunknown\tinvalid_response");
    }
  ' "$json"
}

json_run_id() {
  local json="$1"
  [[ -z "$NODE_BIN" ]] && { printf ''; return 0; }
  "$NODE_BIN" -e '
    try { console.log(JSON.parse(process.argv[1]).runId ?? ""); }
    catch { console.log(""); }
  ' "$json"
}

run_import() {
  local response summary imported skipped total complete has_more warning_codes status
  log 'starting live import'
  if response=$(request POST /api/import/x-oauth/fetch '{"maxPages":10,"includeThreads":true,"scheduled":true}'); then
    summary=$(json_import_summary "$response")
    IFS=$'\t' read -r imported skipped total complete has_more warning_codes <<< "$summary"
    if [[ "$complete" == 'true' ]]; then
      status='完了'
    elif [[ "$warning_codes" == *cursor_invalid* ]]; then
      status='tokenを初期化。次回は先頭から再開'
    elif [[ "$warning_codes" == *quota_exceeded* ]]; then
      status='X API利用枠待ち'
    elif [[ "$warning_codes" == *reauth_required* ]]; then
      status='X OAuth再認証が必要'
    elif [[ "$has_more" == 'true' ]]; then
      status='一部取得。次回に続きから再開'
    else
      status='未完了・状態確認が必要'
    fi
    log "import $status: new=$imported skipped=$skipped processed=$total warnings=$warning_codes"
    notify $'Siftly Xライブインポート: '"$status"$'\n'"新規: $imported / 既存・除外: $skipped / 処理: $total"$'\n'"警告コード: $warning_codes" || return 1
    [[ "$complete" == 'true' ]]
    return $?
  fi

  summary=$(json_import_summary "$response")
  IFS=$'\t' read -r imported skipped total complete has_more warning_codes <<< "$summary"
  log "import request failed: new=$imported skipped=$skipped processed=$total warnings=$warning_codes"
  notify $'Siftly Xライブインポート失敗\n'"新規: $imported / 既存・除外: $skipped / 処理: $total"$'\n'"警告コード: $warning_codes"
  return 1
}

run_categorize() {
  local start_response start_run_id status_response summary pipeline_status run_id done total categorized has_error stopped timeout_seconds
  log 'starting AI categorization'
  if ! start_response=$(request POST /api/categorize '{"force":false,"language":"ja"}'); then
    log 'categorization start request failed'
    notify 'Siftly AI分類の開始に失敗しました。Siftlyのローカルログを確認してください。'
    return 1
  fi

  log 'categorization request accepted'
  start_run_id=$(json_run_id "$start_response")
  if [[ -z "$start_run_id" ]]; then
    log 'categorization start response did not include a run id'
    notify 'Siftly AI分類の実行IDを取得できませんでした。'
    return 1
  fi

  timeout_seconds="${SIFTLY_CATEGORIZE_TIMEOUT_SECONDS:-21600}"
  [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || timeout_seconds=21600
  local deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    if ! status_response=$(request GET /api/categorize); then
      log 'categorization status request failed'
      notify 'Siftly AI分類の状態確認に失敗しました。'
      return 1
    fi

    summary=$(json_summary "$status_response")
    IFS=$'\t' read -r pipeline_status run_id done total categorized has_error stopped <<< "$summary"
    if [[ -z "$run_id" ]]; then
      log 'categorization status did not include a run id'
      notify 'Siftly AI分類の実行IDを確認できませんでした。'
      return 1
    fi
    if [[ "$run_id" != "$start_run_id" ]]; then
      log 'categorization run id changed while polling'
      notify 'Siftly AI分類の実行IDが変わりました。別の実行と混同しないよう監視を停止しました。'
      return 1
    fi
    if [[ "$pipeline_status" == 'idle' ]]; then
      if [[ "$stopped" == 'true' ]]; then
        log "categorization stopped: ${done}/${total}, categorized: ${categorized}"
        notify $'Siftly AI分類は停止されました\n'"処理: ${done}/${total}"$'\n'"分類保存: ${categorized}件"
        return 1
      fi
      if [[ "$has_error" == 'true' ]]; then
        log 'categorization finished with an error or partial result'
        notify $'Siftly AI分類は一部失敗またはエラーで終了しました\n'"処理: ${done}/${total}"$'\n'"分類保存: ${categorized}件"
        return 1
      fi
      log "categorization complete: ${done}/${total}, categorized: ${categorized}"
      notify $'Siftly AI分類完了\n'"処理: ${done}/${total}"$'\n'"分類済み: ${categorized}" || return 1
      return 0
    fi
    sleep 10
  done

  log 'categorization timed out after 6 hours'
  notify 'Siftly AI分類が6時間でタイムアウトしました'
  return 1
}

if [[ "${SIFTLY_SCHEDULED_DRY_RUN:-0}" == '1' ]]; then
  log "dry-run: base URL $BASE_URL"
  log "dry-run: Discord webhook $([[ -n "$DISCORD_WEBHOOK_URL" ]] && echo configured || echo missing)"
  exit 0
fi

if [[ -z "$DISCORD_WEBHOOK_URL" || -z "$NODE_BIN" ]]; then
  log 'Discord webhook and node are required for scheduled notifications'
  exit 2
fi

case "$MODE" in
  import) run_import ;;
  categorize) run_categorize ;;
  *)
    echo "usage: $0 import|categorize" >&2
    exit 2
    ;;
esac
