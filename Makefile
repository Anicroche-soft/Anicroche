SERVICE ?= anicroche

-include .env

ifeq ($(mode),dev)
	COMPOSE = docker compose -f docker-compose.yml -f docker-compose.dev.yml
else
	COMPOSE = docker compose
endif

up:
	@$(COMPOSE) up -d

down:
	@$(COMPOSE) down

build:
	@$(COMPOSE) build

re:
	@$(COMPOSE) up --build -d

logs:
	@$(COMPOSE) logs -f $(SERVICE)

ps:
	@$(COMPOSE) ps

.PHONY: up down build rebuild logs ps
