#!/usr/bin/env bash
# Minimal CI gate for this repository.
# - Always validates README + docs layout
# - When package.json exists, also runs make install / build / test

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "ci-check: $*" >&2
  exit 1
}

echo "ci-check: validating documentation layout"

[[ -f README.md ]] || fail "README.md is missing"

[[ -d docs/dev ]] || fail "docs/dev is missing"
[[ -d docs/user ]] || fail "docs/user is missing"

shopt -s nullglob
dev_md=(docs/dev/*.md)
user_md=(docs/user/*.md)
shopt -u nullglob

((${#dev_md[@]} > 0)) || fail "docs/dev has no Markdown files"
((${#user_md[@]} > 0)) || fail "docs/user has no Markdown files"

echo "ci-check: found ${#dev_md[@]} docs/dev file(s) and ${#user_md[@]} docs/user file(s)"

if [[ ! -f package.json ]]; then
  echo "ci-check: no package.json yet — skipping build and tests"
  echo "ci-check: OK"
  exit 0
fi

echo "ci-check: package.json present — running make install, build, and test"

command -v make >/dev/null 2>&1 || fail "make is required when package.json exists"
command -v npm >/dev/null 2>&1 || fail "npm is required when package.json exists"

make install
make build
make test

echo "ci-check: OK"
