#!/usr/bin/env bash
# Cria e sobe a stack de um cliente.
# Uso: ./novo-cliente.sh <nome> [dominio] [porta_local]
#   nome        letras minúsculas/números/hífen (ex.: moraes)
#   dominio     ex.: moraes.exemplo.com.br (omita para testar só por túnel SSH)
#   porta_local porta no loopback da VPS (padrão 3000; use outra para cada cliente)
set -euo pipefail
NOME="${1:?uso: $0 <nome> [dominio] [porta_local]}"
DOMINIO="${2:-}"
PORTA="${3:-3000}"
[[ "$NOME" =~ ^[a-z0-9-]+$ ]] || { echo "nome inválido"; exit 1; }

BASE="$HOME"
DIR="$BASE/clientes/$NOME"
[ -e "$DIR" ] && { echo "cliente já existe em $DIR"; exit 1; }

docker network inspect web >/dev/null 2>&1 || docker network create web >/dev/null
mkdir -p "$DIR"
cp "$BASE/deploy/cliente/docker-compose.yml" "$DIR/docker-compose.yml"

rnd() { openssl rand -hex 24; }
[ -z "$DOMINIO" ] && SEM_DOMINIO=1 || SEM_DOMINIO=
cat > "$DIR/.env" <<ENV
CLIENTE=$NOME
PORTA_LOCAL=$PORTA
DB_SENHA=$(rnd)
CRON_SECRET=$(rnd)
EXPORT_TOKEN=$(rnd)
TV_TOKEN=$(rnd)
OMIE_MODO=desligado
OMIE_APP_KEY=
OMIE_APP_SECRET=
OMIE_REQ_POR_MINUTO=200
OMIE_LIMITE_DIARIO=0
OMIE_LOCAL_ESTOQUE=
OMIE_CONTRATOS_VALIDADOS=
OMIE_ETAPAS_FATURADO=60,70,80
INICIO_TURNO_HORA=7
TZ=America/Sao_Paulo
URL_PUBLICA=${DOMINIO:+https://$DOMINIO}
COOKIE_INSEGURO=${SEM_DOMINIO}
ENV
chmod 600 "$DIR/.env"

if [ -n "$DOMINIO" ]; then
  mkdir -p "$BASE/proxy/sites"
  printf '%s {\n\treverse_proxy %s-app:3000\n}\n' "$DOMINIO" "$NOME" > "$BASE/proxy/sites/$NOME.caddy"
  docker exec proxy-caddy-1 caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true
fi

( cd "$DIR" && docker compose -p "$NOME" up -d )
echo "cliente $NOME criado em $DIR (porta local $PORTA${DOMINIO:+, domínio $DOMINIO})"
