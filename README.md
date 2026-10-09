# lexico-api

Backend for Léxico, used by the Flutter app (`../lexico`) and the web app (`../lexico-web`).

Fastify + TypeScript, Postgres via Drizzle ORM. Postgres runs in Docker for local development.

## First run

Requires Node 22+ and Docker Desktop (running).

```sh
cp .env.example .env
npm install
npm run db:up        # start Postgres in Docker
npm run db:migrate   # create tables
npm run db:seed      # load data/decks/*.json
npm run dev          # http://localhost:3000
```

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
| GET    | `/decks`                  | `{ "decks": [DeckDto, …] }`      |
| POST   | `/decks`                  | `201 { "deck": DeckDto }`        |
| GET    | `/decks/:deckId/words`    | `{ "words": [WordDto, …] }`      |
| POST   | `/decks/:deckId/words`    | `201 { "words": [WordDto, …] }`  |
| POST   | `/words/:wordId/reviews`  | `{ "word": WordDto }`            |

`DeckDto` is `{ "id", "name", "language", "created_at" }`; `GET /decks` lists them
oldest first. `POST /decks` takes `{ "name": "Food", "language": "Español" }`, plus an
optional `id` (generated if omitted); `name` and `language` must not be blank, and an
`id` that already exists gets `409`.

`WordDto` matches `lib/features/vocabulary/data/models/word_dto.dart` in the Flutter app,
plus three counters the app doesn't read yet: `shows_count`, `successes_count` and
`failures_count`. Every word starts with all three at `0`.

`POST /words/:wordId/reviews` records one answer to a card. Send
`{ "correct": true }` or `{ "correct": false }`: it adds 1 to `shows_count` and to
`successes_count` or `failures_count`, and returns the updated word (`404` if there's
no such word).

`POST /decks/:deckId/words` takes `{ "words": [ … ] }` (1–1000 words), each in the same shape as a word in
`data/decks/*.json`. Only `question_example` and `answer_example` are required (and must
not be blank); a word without `question_short` is a sentence card, `answer_short`
defaults to null, and `id` is generated if omitted. Words are appended to
the end of the deck. If any word fails,
none are added: `404` unknown deck, `409` an `id` already exists, `400` invalid body
or a repeated `id`.

Rerunning `npm run db:seed` deletes words that aren't in a deck's JSON file, including
words added through the API. It only touches decks that have a file in `data/decks/`;
decks created through the API are left alone. A deck file can set `"name"`, which
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
| `npm run build`      | Compile to `dist/`                             |
| `npm start`          | Run the compiled API                           |
| `npm run typecheck`  | Type-check without emitting                    |
| `npm run db:up`      | Start the Postgres container                   |
| `npm run db:down`    | Stop it (data is kept in a Docker volume)      |
| `npm run db:seed`    | Upsert decks from `data/decks/`; safe to rerun |
