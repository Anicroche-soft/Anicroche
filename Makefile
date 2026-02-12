SERVICE ?= anicroche

up:
	@docker compose up -d

down:
	@docker compose down

build:
	@docker compose build

re:
	@docker compose up --build -d

logs:
	@docker compose logs -f $(SERVICE)

ps:
	@docker compose ps

.PHONY: up down build rebuild logs ps
