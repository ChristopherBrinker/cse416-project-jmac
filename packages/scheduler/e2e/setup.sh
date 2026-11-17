#!/usr/bin/env bash
# Download the official pinned Convex local backend; never configure a cloud project.
set -euo pipefail
cd "$(dirname "$0")/../../.."
VERSION=precompiled-2026-11-16-80befbc
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) TARGET=aarch64-apple-darwin; SHA256=9e551167c421e03e4bb4aac089b353d44adb9eeb80916a6ec1ef82d0f2eb254d ;;
  Darwin/x86_64) TARGET=x86_64-apple-darwin; SHA256=0be66ee269729afd0c69ea87934b3080b516184ef40caf469fedfb982ff88c4e ;;
  Linux/aarch64|Linux/arm64) TARGET=aarch64-unknown-linux-gnu; SHA256=06c3a8b70d23f8915ce97be646a6de690c6cac8727089387cecb1a1e8bac5262 ;;
  Linux/x86_64) TARGET=x86_64-unknown-linux-gnu; SHA256=65230f5e8583c7c7f13cdf5854b140187c153c71bbc32276d60d75658214ab9e ;;
  *) echo 'Unsupported platform; set E2E_CONVEX_BINARY to a compatible backend binary.' >&2; exit 1 ;;
esac
mkdir -p .cache/e2e/bin
INSTALL_CHECKSUM=".cache/e2e/bin/convex-local-backend-$VERSION-$TARGET-$SHA256.sha256"
if [ -x .cache/e2e/bin/convex-local-backend ] && [ -f "$INSTALL_CHECKSUM" ] && \
  shasum -a 256 --check "$INSTALL_CHECKSUM" >/dev/null 2>&1; then
  printf 'Convex backend %s already installed for %s.\n' "$VERSION" "$TARGET"
  exit 0
fi
ARCHIVE=$(mktemp)
trap 'rm -f "$ARCHIVE"' EXIT
curl --fail --location --silent --show-error \
  "https://github.com/convex/convex-backend/releases/download/$VERSION/convex-local-backend-$TARGET.zip" \
  --output "$ARCHIVE"
printf '%s  %s\n' "$SHA256" "$ARCHIVE" | shasum -a 256 --check
unzip -o "$ARCHIVE" convex-local-backend -d .cache/e2e/bin
chmod +x .cache/e2e/bin/convex-local-backend
shasum -a 256 .cache/e2e/bin/convex-local-backend > "$INSTALL_CHECKSUM"
printf 'Convex backend %s installed. See docs/testing/evaluation-e2e.md for worker setup.\n' "$VERSION"
