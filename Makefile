.PHONY: dev test fmt clippy
dev:
	bash scripts/dev.sh
test:
	bash scripts/test-all.sh
fmt:
	cargo fmt --all
clippy:
	cargo clippy --workspace --all-targets -- -D warnings
