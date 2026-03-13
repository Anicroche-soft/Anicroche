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

ifeq ($(mode),dev)
reset:
	@docker exec apicroche node --input-type=module -e 'import mysql from "mysql2/promise"; const connexion = await mysql.createConnection({ host: process.env.database_host || "localhost", port: parseInt(process.env.database_port || "3306"), user: process.env.database_user, password: process.env.database_pass || "", database: process.env.database_name }); const [tables] = await connexion.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"); if (!tables.length) { console.log("Base deja vide"); await connexion.end(); process.exit(0); } await connexion.query("SET FOREIGN_KEY_CHECKS = 0"); let supprimees = 0; for (const row of tables) { const nom = row.TABLE_NAME ?? row.table_name ?? ""; if (!nom) continue; await connexion.query("DROP TABLE IF EXISTS `" + nom.replace(/`/g, "``") + "`"); supprimees++; } await connexion.query("SET FOREIGN_KEY_CHECKS = 1"); await connexion.end(); const s = supprimees > 1 ? "s" : ""; console.log("Base vidée (" + supprimees + " table" + s + " supprimée" + s + ")");'
	@docker restart apicroche >/dev/null
	@echo "Base créée"
endif

.PHONY: up down build rebuild re logs ps reset
