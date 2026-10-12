#!/usr/bin/env bash
# SessionStart-Hook: nur in Cloud-Sessions. Installiert meine Mods, falls sie fehlen,
# und meldet in einer Zeile den echten Stand. Privater Marketplace: Token in der
# Cloud-Umgebung als CLAUDE_MODS_TOKEN setzen (GitHub-Token mit Lesezugriff auf Faabyy/claude-mods).
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "${ENSURE_MODS_FORCE:-}" = "1" ] || exit 0
command -v claude >/dev/null 2>&1 || { echo "Mods: claude-CLI nicht gefunden, nichts installiert."; exit 0; }

MARKETS=(
  "claude-mods=Faabyy/claude-mods"
  "claude-kit=JohnnyVizz/claude-kit"
  "claude-code-filetree=data-goblin/claude-code-filetree"
  "catch-me-up=oliverow/catch-me-up"
)
WANT=(
  usage-bar-de@claude-mods cache-tax@claude-mods cache-weather-bar@claude-mods next-steps-cards@claude-mods
  savvy-flow@claude-kit savvy-progress@claude-kit filetree@claude-code-filetree catch-me-up@catch-me-up
)

if [ -n "${CLAUDE_MODS_TOKEN:-}" ]; then
  git config --global url."https://x-access-token:${CLAUDE_MODS_TOKEN}@github.com/Faabyy/claude-mods".insteadOf "https://github.com/Faabyy/claude-mods"
fi

known="$(claude plugin marketplace list 2>/dev/null || true)"
for m in "${MARKETS[@]}"; do
  name="${m%%=*}"; src="${m#*=}"
  grep -q "$name" <<<"$known" || claude plugin marketplace add "$src" >/dev/null 2>&1 || true
done

have="$(claude plugin list 2>/dev/null || true)"
missing=(); added=()
for p in "${WANT[@]}"; do
  if ! grep -q "$p" <<<"$have"; then
    if claude plugin install "$p" >/dev/null 2>&1; then added+=("${p%@*}"); else missing+=("${p%@*}"); fi
  fi
done

msg="Mods: ${#WANT[@]} gewünscht"
[ ${#added[@]} -gt 0 ] && msg+=", neu installiert: ${added[*]} (wirksam nach /reload-plugins oder neuer Session)"
if [ ${#missing[@]} -gt 0 ]; then
  msg+=", FEHLEN: ${missing[*]}"
  [ -z "${CLAUDE_MODS_TOKEN:-}" ] && msg+=" (CLAUDE_MODS_TOKEN nicht gesetzt, privater Marketplace claude-mods nicht lesbar?)"
else
  msg+=", alle vorhanden"
fi
echo "$msg"
exit 0
