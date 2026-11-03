# lexico-api

Backend for Léxico, used by the Flutter app (`../lexico`) and the web app (`../lexico-web`).

Fastify + TypeScript, Postgres via Drizzle ORM. Postgres runs in Docker.

## First run

Requires Node 22+ and Docker Desktop (running).

```sh
cp .env.development.example .env.development
npm install
npm run db:up        # start Postgres in Docker
npm run db:migrate   # create tables
npm run dev          # http://localhost:3000

# Data belongs to an account, so create one, then load data/decks/*.json into it:
curl -X POST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"at least 8 chars"}'
npm run db:seed -- you@example.com
```

### Upgrading a database from before accounts

Migration `0008_users_and_sessions` gives the decks that already exist to a placeholder
account that can't log in. Register your account, then move them into it:

```sh
npm run db:migrate
# start the API and register you@example.com, as above
npm run db:claim -- you@example.com
```

Same for staging with `db:migrate:staging` and `db:claim:staging`.

## Environments

`APP_ENV` picks the environment, and its settings come from `.env.<APP_ENV>`; variables
already set in the shell win over the file. Without `APP_ENV` you get `development`.

| `APP_ENV`               | Env file           | API port | Database                           |
| ----------------------- | ------------------ | -------- | ---------------------------------- |
| `development` (default) | `.env.development` | 3000     | `db-dev` container, port 5433      |
| `staging`               | `.env.staging`     | 3001     | `db-staging` container, port 5432  |

Copy each `.env.<env>.example` to `.env.<env>` to set it up. `npm run db:up` starts both
databases. The plain scripts (`dev`, `start`, `db:migrate`, `db:seed`, `db:studio`) use
development. For staging, run the API with `npm run staging` (reloads on change, like
`dev`), and add `:staging` to the rest (`npm run start:staging`, `npm run db:migrate:staging`,
…). Remember to run `db:migrate:staging` too after adding a migration.

## Endpoints

The full reference (types, every status code, error shapes, edge cases) is in
[API.md](API.md), written to be handed to AI agents and client authors.

Interactive docs ([Scalar](https://scalar.com)) are at <http://localhost:3000/docs>, and
the OpenAPI 3.1 document at `/docs/openapi.json` (or `.yaml`). It is generated from the
route schemas in `src/routes/`, so add a `summary`, `tags` and error responses when you add
a route.

| Method | Path                      | Response                         |
| ------ | ------------------------- | -------------------------------- |
| GET    | `/health`                 | `{ "status": "ok" }`             |
| POST   | `/auth/register`          | `201 { user, token, expires_at }` |
| POST   | `/auth/login`             | `{ user, token, expires_at }`    |
| GET    | `/auth/me`                | `{ "user": UserDto }`            |
| POST   | `/auth/logout`            | `204`                            |
| GET    | `/decks`                  | `{ "decks": [DeckDto, …] }`      |
| POST   | `/decks`                  | `201 { "deck": DeckDto }`        |
| GET    | `/decks/:deckId/words`    | `{ "words": [WordDto, …] }`      |
| POST   | `/decks/:deckId/words`    | `201 { "words": [WordDto, …] }`  |
| POST   | `/reviews`                | `{ "words": [WordDto, …] }`      |

**Authentication.** Register or log in with `{ "email", "password" }` (8+ characters) to get
a `token`, valid for 30 days, and send `Authorization: Bearer <token>` on every call except
`/health`, register and login; without it you get `401`. Every deck (and so every word)
belongs to one user, and each user only sees their own. Deck and word ids are unique per
user, so two users can both have `es-en-core`. Passwords are hashed with scrypt, and only a
hash of each token is stored (`sessions` table), so logout revokes a token at once.

`DeckDto` is `{ "id", "name", "language", "created_at" }`; `GET /decks` lists the user's decks
oldest first. `POST /decks` takes `{ "name": "Food", "language": "Español" }`, plus an
optional `id` (generated if omitted); `name` and `language` must not be blank, and an
`id` that already exists gets `409`.

`WordDto` matches `lib/features/vocabulary/data/models/word_dto.dart` in the Flutter app,
plus three counters the app doesn't read yet: `shows_count`, `successes_count` and
`failures_count`. Every word starts with all three at `0`.

`POST /reviews` records a study session's answers in one request. Send
`{ "reviews": [{ "word_id": "es-pan", "correct": true }, …] }` (1–1000 answers): each adds 1
to its word's `shows_count` and to `successes_count` or `failures_count`. It returns the
updated words; answers to word ids that don't exist are skipped.

`POST /decks/:deckId/words` takes `{ "words": [ … ] }` (1–1000 words), each in the same shape as a word in
`data/decks/*.json`. Only `question_example` and `answer_example` are required (and must
not be blank); a word without `question_short` is a sentence card, `answer_short`
defaults to null, and `id` is generated if omitted. Words are appended to
the end of the deck. If any word fails,
none are added: `404` unknown deck, `409` an `id` already exists, `400` invalid body
or a repeated `id`.

`npm run db:seed -- <email>` loads the deck files into that account. Rerunning it deletes
words that aren't in a deck's JSON file, including words added through the API. It only
touches that account's decks that have a file in `data/decks/`; decks created through the
API, and other accounts, are left alone. A deck file can set `"name"`, which
defaults to its `deck_id`.

To point the Flutter app at your local API:

```sh
flutter run --dart-define=LEXICO_API_BASE_URL=http://localhost:3000
```

On the Android emulator use `http://10.0.2.2:3000` instead.

## Changing the schema

1. Edit `src/db/schema.ts`.
2. `npm run db:generate` writes a SQL migration to `drizzle/`.
3. `npm run db:migrate` applies it.

`npm run db:studio` opens Drizzle Studio to browse the data.

## Scripts

| Script               | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `npm run dev`        | Start the API with reload on change            |
| `npm run staging`    | Same, against the staging environment          |
| `npm run build`      | Compile to `dist/`                             |
| `npm start`          | Run the compiled API                           |
| `npm run typecheck`  | Type-check without emitting                    |
| `npm run db:up`      | Start both Postgres containers                 |
| `npm run db:down`    | Stop them (data is kept in Docker volumes)     |
| `npm run db:seed -- <email>`  | Upsert decks from `data/decks/` into that account; safe to rerun |
| `npm run db:claim -- <email>` | Move decks from before accounts into that account |
