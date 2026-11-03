# Obsidian Yandex Tracker Sync — common developer targets
#
#   make help
#   make install
#   make build
#   make test
#   make ci
#   make version show
#   make version bump [patch|minor|major]
#   make release
#   make install-vault VAULT=/path/to/vault

.PHONY: help install build test ci release install-vault clean dev package version
.PHONY: show bump patch minor major

PLUGIN_ID := obsidian-yandex-tracker-sync
DIST_DIR := dist
NPM ?= npm

# Optional: make release bump=patch|minor|major
BUMP ?=

# Required for install-vault: path to an Obsidian vault root
VAULT ?=

# Secondary goals for: make version show | make version bump [patch|minor|major]
VERSION_ARGS := $(filter-out version,$(MAKECMDGOALS))
VERSION_CMD := $(firstword $(VERSION_ARGS))
VERSION_LEVEL := $(or $(word 2,$(VERSION_ARGS)),patch)

help:
	@echo "Targets:"
	@echo "  install         Install npm dependencies (npm ci)"
	@echo "  build           Typecheck and production-bundle main.js"
	@echo "  test            Run unit tests"
	@echo "  ci              Docs layout check + install + build + test"
	@echo "  version show    Print current package.json version"
	@echo "  version bump    Bump version (default patch; or patch|minor|major)"
	@echo "  release         Build and package plugin zip under $(DIST_DIR)/"
	@echo "                  Optional: bump=patch|minor|major (runs npm version)"
	@echo "  install-vault   Copy built plugin into a vault (VAULT=/path/to/vault)"
	@echo "  dev             Watch-mode esbuild"
	@echo "  clean           Remove build and release artifacts"
	@echo "  package         Alias for packaging step used by release"

install:
	$(NPM) ci

build:
	$(NPM) run build

test:
	$(NPM) test

dev:
	$(NPM) run dev

ci: ## Full local/CI gate
	./scripts/ci-check.sh

version:
ifeq ($(VERSION_CMD),show)
	@node -p "require('./package.json').version"
else ifeq ($(VERSION_CMD),bump)
ifeq ($(filter $(VERSION_LEVEL),patch minor major),)
	$(error version bump level must be patch, minor, or major (got '$(VERSION_LEVEL)'))
endif
	@$(NPM) version $(VERSION_LEVEL) --no-git-tag-version
	@echo "version: $$(node -p "require('./package.json').version")"
else
	@echo "Usage: make version show | make version bump [patch|minor|major]"; exit 1
endif

# Absorb secondary words so Make does not treat them as unknown targets
show bump patch minor major:
	@:

release:
ifneq ($(BUMP),)
	@echo "release: bumping version ($(BUMP))"
	$(NPM) version $(BUMP) --no-git-tag-version
endif
	$(MAKE) build
	$(MAKE) package
	@echo "release: done → $$(ls -1 $(DIST_DIR)/$(PLUGIN_ID)-*.zip | tail -n 1)"

package: build
	@mkdir -p $(DIST_DIR)
	@version=$$(node -p "require('./manifest.json').version"); \
	staging="$(DIST_DIR)/$(PLUGIN_ID)-$$version"; \
	zipfile="$(DIST_DIR)/$(PLUGIN_ID)-$$version.zip"; \
	rm -rf "$$staging" "$$zipfile"; \
	mkdir -p "$$staging"; \
	cp main.js manifest.json "$$staging/"; \
	if [ -f styles.css ]; then cp styles.css "$$staging/"; fi; \
	(cd $(DIST_DIR) && zip -r "$(PLUGIN_ID)-$$version.zip" "$(PLUGIN_ID)-$$version" >/dev/null); \
	rm -rf "$$staging"; \
	echo "package: $$zipfile"

install-vault: build
ifeq ($(VAULT),)
	$(error Set VAULT to your Obsidian vault root, e.g. make install-vault VAULT="$$HOME/Notes")
endif
	@dest="$(VAULT)/.obsidian/plugins/$(PLUGIN_ID)"; \
	mkdir -p "$$dest"; \
	cp main.js manifest.json "$$dest/"; \
	if [ -f styles.css ]; then cp styles.css "$$dest/"; fi; \
	echo "install-vault: installed to $$dest"

clean:
	rm -rf $(DIST_DIR) main.js main.js.map
