# Panda Status factory clone.
# See CLAUDE.md for standing rules and firmware/SAFETY.md before touching the device.

.DEFAULT_GOAL := help

.PHONY: help hooks check-hooks test-hook residue test-fw partitions

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

hooks: ## Point git at the committed hooks. Run once per clone.
	@git config core.hooksPath .githooks
	@chmod +x .githooks/*
	@echo "core.hooksPath = $$(git config --get core.hooksPath)"

check-hooks: ## Verify the pre-commit hook is active and executable
	@test "$$(git config --get core.hooksPath)" = ".githooks" \
		|| { echo "core.hooksPath is not set. Run: make hooks"; exit 1; }
	@test -x .githooks/pre-commit \
		|| { echo ".githooks/pre-commit is not executable. Run: make hooks"; exit 1; }
	@echo "pre-commit hook active"

test-hook: ## Run the pre-commit hook regression suite
	@bash tools/test-hook.sh

residue: ## Sweep the tracked tree for BIQU residue (element IDs, class names, their copy)
	@bash tools/residue-sweep.sh

test-fw: ## Host tests for the firmware config module (gcc, no device)
	@bash firmware/test/host/run.sh

partitions: ## Regenerate firmware/partitions.csv (PROVISIONAL; FLASH=4MB by default)
	@python3 tools/fw/gen_partitions.py --flash $${FLASH:-4MB}
