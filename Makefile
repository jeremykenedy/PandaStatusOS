# PandaStatusOS, a clean-room firmware for the Panda Status P2.
# See CLAUDE.md for standing rules and firmware/SAFETY.md before touching the device.

.DEFAULT_GOAL := help

.PHONY: help hooks check-hooks test-hook residue test-fw test-flash-tools preflight partitions

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

test-flash-tools: ## Prove the flash tools against a synthetic image and the mock (no device)
	@bash tools/fw/test-flash-tools.sh

preflight: ## The flash gate, read-only: is a verified stock dump in place? (tools/fw/preflight.sh)
	@bash tools/fw/preflight.sh

# There is no flash target and there never will be one. The IDF target that writes the
# bootloader, the partition table and the app together is exactly what firmware/SAFETY.md
# forbids; the install path is tools/fw/ota-install.sh, over the network.
partitions: ## Regenerate the PROVISIONAL firmware/partitions.csv for host builds only (the real one comes from the dump)
	@python3 tools/fw/gen_partitions.py --flash $${FLASH:-4MB}
