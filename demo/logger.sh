#!/bin/sh
# Fake log generator for testing tailr. MODE: slog | json | nginx | ansi | legacy | crash | flood

i=0
long=$(head -c 300 /dev/zero | tr '\0' x)

slog() {
  t=$(date -u +%FT%T.000Z)
  case $((RANDOM % 12)) in
    0) echo "time=$t level=ERROR msg=\"query failed\" err=\"pq: deadlock detected\" query=update_balance" ;;
    1) echo "time=$t level=WARN msg=\"slow request\" path=/api/orders dur=1.8s" ;;
    2) echo "time=$t level=DEBUG msg=\"cache miss\" key=user:$i" ;;
    3) echo "time=$t level=INFO msg=\"payload\" body=$long" ;;
    *) echo "time=$t level=INFO msg=\"request done\" method=GET path=/api/users/$i status=200 dur=$((RANDOM % 90))ms trace_id=$(printf %016x $(date +%s)) err=<nil>" ;;
  esac
}

json() {
  t=$(date -u +%FT%T.000Z)
  case $((RANDOM % 10)) in
    0) echo "{\"time\":\"$t\",\"level\":\"error\",\"msg\":\"job failed\",\"job\":$i,\"err\":\"context deadline exceeded\",\"attempt\":3}" >&2 ;;
    1) echo "{\"time\":\"$t\",\"level\":\"warn\",\"msg\":\"retrying job\",\"job\":$i,\"backoff\":\"2s\"}" ;;
    *) echo "{\"time\":\"$t\",\"level\":\"info\",\"msg\":\"job done\",\"job\":$i,\"dur_ms\":$((RANDOM % 500)),\"trace_id\":\"$(printf %016x $(date +%s))\",\"tags\":[\"email\",\"batch\"]}" ;;
  esac
}

nginx() {
  case $((RANDOM % 15)) in
    0) echo "$(date -u '+%Y/%m/%d %T') [error] 29#29: *$i open() \"/usr/share/nginx/html/favicon.ico\" failed (2: No such file or directory)" >&2 ;;
    *) echo "172.18.0.1 - - [$(date -u '+%d/%b/%Y:%T +0000')] \"GET /products/$i HTTP/1.1\" 200 $((RANDOM % 9000)) \"-\" \"Mozilla/5.0\"" ;;
  esac
}

ansi() {
  case $((RANDOM % 10)) in
    0) printf '\033[31merror\033[0m Failed to compile \033[1msrc/App.tsx\033[0m: Unexpected token (12:4)\n' ;;
    1) printf '\033[33mwarn\033[0m  Unused variable \033[2m(no-unused-vars)\033[0m\n' ;;
    *) printf '\033[32m✓\033[0m %s \033[36mGET\033[0m /assets/app-%d.js \033[2m%dms\033[0m\n' "$(date +%T)" "$i" $((RANDOM % 50)) ;;
  esac
}

legacy() {
  case $((RANDOM % 8)) in
    0) echo "[E] $(date +%T) lost connection to broker, reconnecting" ;;
    1) echo "[W] $(date +%T) queue depth $((RANDOM % 1000))" ;;
    *) echo "[I] $(date +%T) message $i processed" ;;
  esac
}

crash() {
  if [ "$i" -ge 30 ]; then
    cat >&2 <<'EOF'
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x4a2b3c]

goroutine 1 [running]:
main.handle(0x0)
	/app/main.go:42 +0x1c
main.main()
	/app/main.go:17 +0x85
EOF
    exit 2
  fi
  slog
}

case $MODE in
  flood) while :; do
      echo "level=INFO msg=\"flood\" n=$i"
      i=$((i + 1))
    done ;;
esac

while :; do
  "$MODE"
  i=$((i + 1))
  sleep "${DELAY:-1}"
done
