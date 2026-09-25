# Imagem de produção (Next.js standalone)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo
RUN apk add --no-cache tzdata && addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# migrações e seed rodam com tsx a partir do código-fonte
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
USER app
EXPOSE 3000
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && node server.js"]
