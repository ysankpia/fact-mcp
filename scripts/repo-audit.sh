#!/usr/bin/env bash
# Read-only repository audit for the release skill.
#
# Creates nothing, changes nothing. Safe to run on any git repository.
#   audit.sh            file and metadata checks, version record, module docs, CI
#   audit.sh --deep     also runs the stack's fmt/lint/test where it is safe
#   audit.sh --strict   exit 1 when a required item is missing (the CI gate)
set -uo pipefail

deep=0
strict=0
for arg in "$@"; do
  case "$arg" in
  --deep) deep=1 ;;
  --strict) strict=1 ;;
  -h | --help)
    printf 'usage: audit.sh [--deep] [--strict]\n'
    exit 0
    ;;
  *)
    printf 'unknown option: %s\n' "$arg" >&2
    exit 2
    ;;
  esac
done

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf 'audit: not a git repository\n' >&2
  exit 2
}
cd "$root" || exit 2

ok=0
miss=0
warn=0

ok() {
  ok=$((ok + 1))
  printf '  OK    %s\n' "$1"
}
miss() {
  miss=$((miss + 1))
  printf '  MISS  %s\n' "$1"
}
warn() {
  warn=$((warn + 1))
  printf '  WARN  %s\n' "$1"
}
info() { printf '  --    %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

have() { [ -e "$1" ]; }
# `has_dir` answers "is this a directory". It is called through `check`, which
# invokes its first argument as a command, so shellcheck cannot see the call.
# shellcheck disable=SC2329
has_dir() { [ -d "$1" ]; }
# `has_line PATTERN FILE`: true when the file contains a matching line.
has_line() { grep -q -- "$1" "$2" 2>/dev/null; }
# Extended-regex variant, for patterns with `+`, `?`, or alternation.
has_line_ere() { grep -Eq -- "$1" "$2" 2>/dev/null; }

# `check_line "message" PATTERN FILE`: report whether a manifest declares a key,
# without printing the raw pattern as the label.
check_line() {
  if has_line "$2" "$3"; then
    ok "$1"
  else
    miss "$1"
  fi
}

# Same, for an extended-regex pattern.
check_line_ere() {
  if has_line_ere "$2" "$3"; then
    ok "$1"
  else
    miss "$1"
  fi
}

# Same, for keys that are worth having but not required.
check_line_soft() {
  if has_line "$2" "$3"; then
    ok "$1"
  else
    warn "missing: $1"
  fi
}
have_any() {
  local path
  for path in "$@"; do
    [ -e "$path" ] && return 0
  done
  return 1
}

# `check MESSAGE COMMAND...`: report OK when the command succeeds, MISS otherwise.
# The message comes first so it is never confused with the command's arguments.
# Written as an explicit branch rather than `cmd && ok || miss`, which would
# report the same item twice if `ok` ever returned non-zero.
check() {
  local message=$1
  shift
  if "$@"; then
    ok "$message"
  else
    miss "$message"
  fi
}

# Same shape, for items that are worth mentioning but not required. The message
# reads as the OK case and the warning prefixes "missing:", so keep messages as
# short noun-or-verb phrases that still work after that prefix.
check_soft() {
  local message=$1
  shift
  if "$@"; then
    ok "$message"
  else
    warn "missing: $message"
  fi
}

# `run_check LABEL TOOL COMMAND...`: report a real command's result, or say the
# tool is missing. Used only in --deep, where running the stack's own checks is
# the whole point.
run_check() {
  local label=$1 tool=$2
  shift 2
  if ! command -v "$tool" >/dev/null 2>&1; then
    info "$tool not installed"
    return
  fi
  if "$@" >/dev/null 2>&1; then
    ok "$label"
  else
    miss "$label fails"
  fi
}

# ---------- project facts ----------
branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'detached')
commits=$(git rev-list --count HEAD 2>/dev/null || printf '0')
tags=$(git tag | wc -l | tr -d ' ')
last_tag=$(git describe --tags --abbrev=0 2>/dev/null || printf 'none')
remotes=$(git remote | wc -l | tr -d ' ')
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

section "project"
info "path       $root"
info "branch     $branch"
info "commits    $commits"
info "tags       $tags (latest: $last_tag)"
info "remotes    $remotes"
info "worktree   $dirty changed path(s)"

if [ "$commits" -eq 0 ]; then
  miss "no commits yet — nothing to publish"
fi
if [ "$remotes" -eq 0 ]; then
  miss "no git remote configured"
else
  ok "git remote configured"
fi
if [ "$dirty" -gt 0 ]; then
  warn "$dirty uncommitted change(s); commit before publishing"
fi

# ---------- stack ----------
section "stack"
stacks=""
have Cargo.toml && stacks="$stacks rust"
have package.json && stacks="$stacks node"
have pyproject.toml && stacks="$stacks python"
have go.mod && stacks="$stacks go"
have Gemfile && stacks="$stacks ruby"
[ -z "$stacks" ] && stacks=" unknown"
stacks="${stacks# }"
info "detected: $stacks"

# ---------- T0: every repository ----------
section "T0 baseline"
if have README.md; then
  ok "README.md"
  lines=$(wc -l <README.md | tr -d ' ')
  if [ "$lines" -lt 20 ]; then
    warn "README.md is only $lines lines; needs install, run, and test"
  fi
else
  miss "README.md"
fi
check "LICENSE" have_any LICENSE LICENSE.md LICENSE.txt LICENSE-MIT LICENSE-APACHE COPYING COPYING.txt

# Dual-licensed Rust projects use LICENSE-MIT plus LICENSE-APACHE and no bare
# LICENSE, which is correct rather than missing. Say which shape was found.
if have LICENSE-MIT && have LICENSE-APACHE; then
  info "dual MIT/Apache-2.0 layout"
elif have LICENSE; then
  info "single LICENSE file"
fi
check ".gitignore" have .gitignore
check "CHANGELOG" have_any CHANGELOG.md CHANGELOG HISTORY.md
if [ "$tags" -gt 0 ]; then
  ok "at least one release tag ($last_tag)"
else
  miss "no release tag"
fi

# ---------- T1: public repositories ----------
visibility="unknown"
repo_slug=""
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  repo_slug=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
  if [ -n "$repo_slug" ]; then
    visibility=$(gh api "repos/$repo_slug" --jq 'if .private then "private" else "public" end' 2>/dev/null || printf 'unknown')
  fi
fi
info "visibility: $visibility"

if [ "$visibility" != "private" ]; then
  section "T1 public repository"
  check "CONTRIBUTING.md" have CONTRIBUTING.md
  check "SECURITY.md" have SECURITY.md
  check "CODE_OF_CONDUCT" have_any CODE_OF_CONDUCT.md CODE_OF_CONDUCT
  check "PR template" have .github/PULL_REQUEST_TEMPLATE.md
  check "issue templates (.github/ISSUE_TEMPLATE)" has_dir .github/ISSUE_TEMPLATE
  check "CODEOWNERS" have_any .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS
  check "dependency updates" have_any .github/dependabot.yml .github/dependabot.yaml renovate.json
  workflows=$(find .github/workflows -maxdepth 1 \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | wc -l | tr -d ' ')
  if [ "$workflows" -gt 0 ]; then
    ok "$workflows CI workflow(s)"
  else
    miss "no CI workflow"
  fi
  check "release note categories" have .github/release.yml
fi

# ---------- T2: stack specifics ----------
section "T2 $stacks"
# One pass per detected stack: a polyglot repo must get every stack's checks,
# and `case` would only run the first matching branch.
for stack in $stacks; do
  case "$stack" in
  rust)
    check "rust-toolchain.toml" have rust-toolchain.toml
    check "rustfmt.toml" have rustfmt.toml
    check_line "Cargo.toml rust-version" '^rust-version' Cargo.toml
    check_line "Cargo.toml license" '^license' Cargo.toml
    check_line_soft "Cargo.toml repository" '^repository' Cargo.toml
    check_line_soft "Cargo.toml description" '^description' Cargo.toml
    if have deny.toml; then
      ok "deny.toml (cargo-deny)"
    else
      info "no deny.toml; optional unless you audit license/advisory policy"
    fi
    ;;
  node)
    check_line_soft "packageManager pinned" '"packageManager"' package.json
    check_line_soft "engines declared" '"engines"' package.json
    check "lockfile committed" have_any pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb
    check_line "license field" '"license"' package.json
    ;;
  python)
    if have ruff.toml; then
      ok "ruff config"
    else
      info "no ruff.toml; configure the linter explicitly if you use ruff"
    fi
    if has_line 'mypy' pyproject.toml; then
      ok "mypy config"
    else
      info "no mypy config"
    fi
    check_soft "dependency lock" have_any uv.lock poetry.lock requirements.txt
    ;;
  go)
    check "go.sum committed" have go.sum
    ;;
  ruby)
    check "Gemfile.lock committed" have Gemfile.lock
    ;;
  unknown)
    info "no stack-specific checks for an unrecognised project layout"
    ;;
  esac
done

# ---------- version record ----------
# A tag without a changelog entry is a version nobody can date; a changelog
# without a tag is a promise. Both have to exist and agree before a release.
section "version record"
changelog=""
for candidate in CHANGELOG.md CHANGELOG HISTORY.md CHANGELOG.rst; do
  if [ -f "$candidate" ]; then
    changelog=$candidate
    break
  fi
done
if [ -z "$changelog" ]; then
  miss "no changelog to record versions in"
else
  info "changelog  $changelog"
  check_line_ere "changelog has an [Unreleased] section" '^##+[[:space:]]+\[?[Uu]nreleased' "$changelog"

  # Newest released heading, e.g. `## [1.2.3] - 2026-10-23` or `## v1.2.3`.
  top=$(grep -oE '^##+[[:space:]]+\[?v?[0-9]+\.[0-9]+\.[0-9]+' "$changelog" 2>/dev/null |
    head -1 | grep -oE 'v?[0-9]+\.[0-9]+\.[0-9]+' | sed 's/^v//')
  # Highest tag by version, not by commit: `git describe` would follow graph order.
  # Highest tag by version, not by commit: `git describe` follows graph order.
  # Monorepo tags are often namespaced (`pkg@1.2.3`), and non-version tags
  # (`nightly`) must not be read as the newest release.
  tag_pattern='^([A-Za-z0-9._-]+@)?v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
  latest=""
  latest_tag=""
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    printf '%s\n' "$tag" | grep -Eq -- "$tag_pattern" || continue
    latest_tag=$tag
    latest=${tag##*@}
    latest=${latest#v}
    break
  done < <(git tag --sort=-v:refname 2>/dev/null)

  if [ -z "$top" ]; then
    info "changelog lists no released version yet"
  elif [ -z "$latest" ]; then
    info "no release tag to compare the changelog against"
  elif [ "${top%%-*}" = "${latest%%-*}" ]; then
    ok "newest tag ($latest_tag) matches the changelog ($top)"
  else
    miss "newest tag ($latest_tag) does not match the changelog ($top)"
  fi

  non_semver=$(git tag 2>/dev/null | grep -Ev -- "$tag_pattern" | head -5)
  if [ -z "$non_semver" ]; then
    ok "every tag is semver"
  else
    warn "tags that are not semver:"
    printf '%s\n' "$non_semver" | sed 's/^/          /'
  fi
fi

# ---------- module docs ----------
# The failure this catches: an agent adds a module today, nobody writes down
# what it is for, and the next agent re-invents or deletes it.
section "module docs"
modules=0
undocumented=""
undocumented_count=0
for tree in src apps packages lib crates; do
  [ -d "$tree" ] || continue
  for dir in "$tree"/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    case "$name" in
    assets | static | public | locales | i18n | styles | fonts | icons | images | img | \
      __tests__ | __snapshots__ | fixtures | testdata | migrations | node_modules | \
      dist | build | coverage)
      continue
      ;;
    esac
    modules=$((modules + 1))
    if compgen -G "$dir*.md" >/dev/null || compgen -G "$dir*.MD" >/dev/null; then
      continue
    fi
    undocumented_count=$((undocumented_count + 1))
    if [ "$undocumented_count" -le 12 ]; then
      undocumented="$undocumented $dir"
    fi
  done
done
if [ "$modules" -eq 0 ]; then
  info "no module directories under src/ apps/ packages/ lib/ crates/"
elif [ "$undocumented_count" -eq 0 ]; then
  ok "all $modules module(s) have a doc file"
else
  miss "$undocumented_count of $modules module(s) have no doc file:$undocumented"
  if [ "$undocumented_count" -gt 12 ]; then
    info "(first 12 listed; a README.md or GLOSSARY entry in each clears this)"
  fi
fi

# ---------- CI actually checks ----------
# A workflow that installs and builds but never lints or tests turns green on
# broken code, which is worse than no CI: it looks like evidence.
section "CI actually checks"
wf_total=0
wf_real=0
wf_hollow=""
gate_workflow=""
# Word-boundary anchored: bare `test` would match `ubuntu-latest`, and bare
# `format` would match a job that only reformats a JSON file.
check_tokens='(^|[^[:alnum:]_-])(fmt|format|lint|test|check|vet|clippy|pytest|ruff|eslint|prettier|tsc|typecheck|type-check|shellcheck|golangci-lint|go[[:space:]]+test|cargo[[:space:]]+test)([^[:alnum:]_-]|$)'
for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$wf" ] || continue
  wf_total=$((wf_total + 1))
  # `run:` may open a multi-line block, so the token is matched anywhere in
  # the file rather than on the `run:` line itself.
  if grep -q 'run:' "$wf" && grep -Eqi -- "$check_tokens" "$wf"; then
    wf_real=$((wf_real + 1))
  else
    wf_hollow="$wf_hollow $(basename "$wf")"
  fi
  if [ -z "$gate_workflow" ] && grep -Eq 'repo-audit\.sh|audit\.sh' "$wf"; then
    gate_workflow=$wf
  fi
done
if [ "$wf_total" -eq 0 ]; then
  miss "no workflow runs any check"
elif [ -n "$wf_hollow" ]; then
  warn "workflow(s) with no fmt/lint/test:$wf_hollow"
else
  ok "$wf_real workflow(s) run a real check"
fi
if [ -n "$gate_workflow" ]; then
  ok "release gate workflow ($(basename "$gate_workflow"))"
else
  warn "missing: a workflow that runs the repo audit (templates/standards.yml)"
fi

# ---------- test matrix ----------
section "test matrix"
matrix=scripts/test-matrix.ts
if [ -f "$matrix" ]; then
  cases=$(grep -cE '^ +name: "' "$matrix" 2>/dev/null || true)
  if [ "${cases:-0}" -gt 0 ]; then
    ok "$cases cases"
    # The count is written in the docs, and a stale count is a doc bug that no
    # other check sees. Compare instead of trusting the prose.
    for doc in README.md AGENTS.md; do
      [ -f "$doc" ] || continue
      stated=$(grep -oE '[0-9]+ cases' "$doc" | head -1 | awk '{print $1}')
      if [ -z "$stated" ]; then
        warn "$doc does not state the case count"
      elif [ "$stated" != "$cases" ]; then
        miss "$doc says $stated cases; $matrix has $cases"
      else
        ok "$doc states $cases cases"
      fi
    done
  else
    miss "$matrix has no cases"
  fi
else
  miss "$matrix"
fi

# ---------- git hygiene ----------
section "git hygiene"
check ".gitattributes" have .gitattributes
if have .editorconfig; then
  ok ".editorconfig"
else
  info "no .editorconfig; optional"
fi
if have_any .githooks/pre-commit scripts/hooks/pre-commit .husky/pre-commit; then
  ok "repository-level hook"
else
  info "no repository-level hook; local hooks do not travel with the clone"
fi

big=$(git ls-files 2>/dev/null |
  grep -Ei '\.(png|jpe?g|gif|webp|heic|mp4|mov|zip|tar|tgz|gz|7z|pdf|dmg|pkg|icns|bin|so|dylib|a|o|wasm|sqlite|db)$' |
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    sz=$(wc -c <"$f" | tr -d ' ')
    if [ "$sz" -gt 5242880 ]; then
      printf '%s (%sMB)\n' "$f" "$((sz / 1048576))"
    fi
  done)
if [ -n "$big" ]; then
  warn "tracked files over 5MB:"
  printf '%s\n' "$big" | sed 's/^/          /'
else
  ok "no large tracked file over 5MB"
fi

# Template env files are meant to be committed, so an explicit allowlist keeps
# them out of the secret list rather than making the whole check ignorable.
suspicious=$(git ls-files 2>/dev/null |
  grep -E '(^|/)(\.env$|\.env\.|.*\.pem$|.*\.key$|.*\.p12$|id_rsa$|id_ed25519$|\.netrc$|credentials\.json$)' |
  grep -Ev '(^|/)\.env\.(example|sample|template|dist|defaults)$' || true)
if [ -n "$suspicious" ]; then
  warn "tracked files that look like secrets:"
  printf '%s\n' "$suspicious" | sed 's/^/          /'
else
  ok "no tracked file that looks like a secret"
fi

# ---------- remote settings ----------
if [ -n "$repo_slug" ]; then
  section "github settings ($repo_slug)"
  # One call, tab separated: description, wiki, delete-on-merge, push protection.
  meta=$(gh api "repos/$repo_slug" --jq '[
		(.description // ""),
		(.has_wiki | tostring),
		(.delete_branch_on_merge | tostring),
		(.security_and_analysis.secret_scanning_push_protection.status // "unknown")
	] | @tsv' 2>/dev/null || true)
  if [ -n "$meta" ]; then
    IFS=$'\t' read -r desc wiki delete_on_merge pushprot <<<"$meta"

    if [ -z "$desc" ]; then
      miss "repository description is empty"
    else
      ok "description set"
    fi

    topics=$(gh api "repos/$repo_slug/topics" --jq '.names | length' 2>/dev/null || printf '0')
    case "$topics" in '' | *[!0-9]*) topics=0 ;; esac
    if [ "$topics" -gt 0 ]; then
      ok "$topics topic(s)"
    else
      warn "no topics (discovery and search suffer)"
    fi

    case "$pushprot" in
    enabled) ok "secret scanning push protection" ;;
    disabled) warn "push protection is disabled" ;;
    *) info "push protection state unknown (needs admin scope)" ;;
    esac

    [ "$wiki" = "true" ] && info "wiki is enabled (noise unless used)"
    [ "$delete_on_merge" = "false" ] && info "branches are not deleted after merge"

    protected=no
    gh api "repos/$repo_slug/branches/$branch/protection" >/dev/null 2>&1 && protected=yes
    rules=$(gh api "repos/$repo_slug/rulesets" --jq 'length' 2>/dev/null || printf '0')
    case "$rules" in '' | *[!0-9]*) rules=0 ;; esac
    [ "$rules" -gt 0 ] && protected=yes
    if [ "$protected" = yes ]; then
      ok "default branch protected"
    else
      warn "default branch has no protection or ruleset"
    fi
  fi
else
  section "github settings"
  info "skipped: gh CLI not available or not authenticated"
fi

# ---------- deep checks ----------
if [ "$deep" -eq 1 ]; then
  section "deep checks"
  for stack in $stacks; do
    case "$stack" in
    rust)
      run_check "cargo fmt --check" cargo cargo fmt --all --check
      run_check "clippy -D warnings" cargo cargo clippy --all-targets -- -D warnings
      run_check "cargo test" cargo cargo test --all-targets
      ;;
    node)
      if has_line '"test"' package.json; then
        info "package.json has a test script; run it before publishing"
      else
        warn "no test script"
      fi
      if has_line '"lint"' package.json; then
        info "package.json has a lint script; run it before publishing"
      else
        warn "no lint script"
      fi
      ;;
    python)
      run_check "ruff check" ruff ruff check .
      run_check "pytest" pytest pytest -q
      ;;
    go)
      run_check "go vet" go go vet ./...
      ;;
    esac
  done
fi

# ---------- summary ----------
printf '\n== summary ==\n'
printf '  %s ok, %s missing, %s warnings\n' "$ok" "$miss" "$warn"
if [ "$miss" -gt 0 ]; then
  printf '  fix the MISS lines for the project tier before publishing.\n'
else
  printf '  nothing required is missing for this tier.\n'
fi

if [ "$strict" -eq 1 ] && [ "$miss" -gt 0 ]; then
  exit 1
fi
exit 0
