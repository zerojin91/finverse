.PHONY: help install dev local prod stop health

help:
	@echo "make install  - Node + Python(uv) dependencies"
	@echo "make dev      - full local stack (Next.js:3000, MiroFish:5440, paper trading:5055), direct DB connection"
	@echo "make local    - same as dev, but opens the PEM SSH tunnel to the DB first (FINVERSE_DATABASE_TUNNEL=1 in .env)"
	@echo "make prod     - same as dev for now (see comment in scripts/dev_local.mjs: vinext start 503s on DB routes)"
	@echo "make stop     - kill anything still listening on 3000/5440/5055"
	@echo "make health   - curl the three local services"

install:
	npm install
	uv sync

dev:
	npm run dev

local:
	@bash -c '\
		npm run db:tunnel & \
		tunnel_pid=$$!; \
		trap "kill $$tunnel_pid 2>/dev/null" EXIT; \
		sleep 2; \
		npm run dev \
	'

prod: dev

stop:
	-lsof -ti tcp:3000 -ti tcp:5440 -ti tcp:5055 | xargs kill -9 2>/dev/null || true

health:
	@curl -sf -o /dev/null localhost:3000 && echo "3000 (web)            OK" || echo "3000 (web)            DOWN"
	@curl -sf -o /dev/null localhost:5055/health && echo "5055 (paper trading)  OK" || echo "5055 (paper trading)  DOWN"
	@nc -z localhost 5440 2>/dev/null && echo "5440 (mirofish)        OK" || echo "5440 (mirofish)        DOWN"
