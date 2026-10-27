# Lexico API reference

HTTP API behind Léxico, a vocabulary flashcard app. This file is written for AI agents and
developers who call the API or write a client for it (`../lexico-web`, `../lexico`). It
describes behaviour as implemented in `src/routes/*.ts`, which is the source of truth: if you
change a route, update this file in the same change.

The project is in development. There is no versioning and no compatibility promise, and the
local database may be reset at any time.

## Essentials

- **Base URL:** `http://localhost:3000` in development and `http://localhost:3001` in staging
  (`PORT` in `.env.<APP_ENV>`). There is no path
  prefix: no `/v1`.
- **No authentication.** There are no users: every deck and word is visible to and writable by
  every caller.
- **JSON only.** Requests with a body must send `Content-Type: application/json`, or they get
  `415`. Bodies are limited to 1 MiB (`413`).
- **Field names are `snake_case`** in requests and responses.
- **Responses are wrapped in an envelope:** `{ "deck": … }`, `{ "decks": [ … ] }`,
  `{ "word": … }` or `{ "words": [ … ] }`. Arrays are never returned bare.
- **Every error body has a string `message`.** The rest of its shape varies, see [Errors](#errors).
- **CORS:** browsers may call the API from the origins in `CORS_ORIGIN` (in dev,
  `http://localhost:5173` and `http://localhost:4173`), using `GET`, `HEAD`, `POST`, `PATCH` and `DELETE`.
- **Unknown fields in a request body are ignored.**
- **OpenAPI:** a machine-readable OpenAPI 3.1 document is served at `/docs/openapi.json`, and
  interactive docs at `/docs`. It is generated from the route schemas and covers shapes and
  status codes. This file covers behaviour the document doesn't.

## Data types

```ts
interface DeckDto {
  id: string;
  name: string;        // shown to the learner, e.g. "Food"
  language: string;    // display label, e.g. "Español"; not a language code
  created_at: string;  // ISO 8601 in UTC with milliseconds, e.g. "2026-10-08T09:12:59.649Z"
}

interface WordDto {
  id: string;
  question_short: string | null; // null for a sentence card
  answer_short: string | null;   // null when not given
  question_example: string;      // sentence in the language being learned
  answer_example: string;        // translation of question_example
  shows_count: number;           // integer ≥ 0: times the card was answered
  successes_count: number;       // integer ≥ 0: answered correctly
  failures_count: number;        // integer ≥ 0: answered incorrectly
}
```

Every field is always present. Only `question_short` and `answer_short` can be `null`.

**Sentence cards.** A word whose `question_short` is `null` is studied as a whole sentence. Show
`question_example` where `question_short` would go and `answer_example` as its meaning.

**Counters.** Every word starts with all three counters at `0`, and only
[`POST /words/:wordId/reviews`](#post-wordswordidreviews) changes them. So
`shows_count === successes_count + failures_count` always holds.

**IDs.**

- An `id` is any non-empty string. Ids the server generates are random UUID v4s.
- **Word ids are unique across all decks**, not just within one. Deck ids are unique too.
- Ids can contain any character, including `/`, spaces and `ñ`. Always URL-encode an id
  in a path, e.g. with `encodeURIComponent`.

**Word order.** A deck's words have a fixed order, which is the order they were added in.
`GET` returns them in that order, and `POST` appends to the end. Deleting a word doesn't
change the order of the others.

## Endpoints

| Method | Path                     | Success                   | Purpose                                 |
| ------ | ------------------------ | ------------------------- | --------------------------------------- |
| GET    | `/health`                | `200 { status }`          | Liveness, including the database        |
| GET    | `/decks`                 | `200 { decks }`           | List all decks                          |
| POST   | `/decks`                 | `201 { deck }`            | Create a deck                           |
| DELETE | `/decks/:deckId`         | `204`, no body            | Delete a deck and all its words         |
| GET    | `/decks/:deckId/words`   | `200 { words }`           | All words in a deck, in order           |
| POST   | `/decks/:deckId/words`   | `201 { words }`           | Append words to a deck (all or nothing) |
| PATCH  | `/words/:wordId`         | `200 { word }`            | Edit a word's text fields               |
| DELETE | `/words/:wordId`         | `204`, no body            | Delete a word                           |
| POST   | `/words/:wordId/reviews` | `200 { word }`            | Record one answer to a card             |

### GET /health

Returns `200 { "status": "ok" }` after running a query against the database. If the database
can't be reached, it returns `500 internal_error`.

### GET /decks

Returns every deck, oldest first (by `created_at`, ties broken by `id`). There is no
pagination. With no decks it returns `{ "decks": [] }`.

```json
{
  "decks": [
    { "id": "es-food", "name": "Food", "language": "Español", "created_at": "2026-10-08T09:12:59.649Z" }
  ]
}
```

### POST /decks

Creates an empty deck.

```ts
interface CreateDeckRequest {
  id?: string;      // non-empty; generated (UUID v4) when omitted
  name: string;     // must contain a non-whitespace character
  language: string; // must contain a non-whitespace character
}
```

`name` and `language` are stored exactly as sent. They are not trimmed.

| Status | Body                                       | When                       |
| ------ | ------------------------------------------ | -------------------------- |
| `201`  | `{ "deck": DeckDto }`                      | Created                    |
| `400`  | `FST_ERR_VALIDATION`                       | Field missing, blank or wrong type |
| `409`  | `{ "error": "deck_id_taken", "message" }`  | A deck with this `id` already exists |

### DELETE /decks/:deckId

Deletes the deck and every word in it, including their counters. This cannot be undone. The
deck's `id`, and the `id`s of its words, can be used again afterwards.

Send no body and no `Content-Type`: `Content-Type: application/json` with an empty body
gets `400`.

| Status | Body                                       | When                          |
| ------ | ------------------------------------------ | ----------------------------- |
| `204`  | None                                       | Deleted, along with its words |
| `404`  | `{ "error": "deck_not_found", "message" }` | No such deck                  |

A request that is adding words to the deck at the same time finishes first, and its words
are deleted with the deck.

```sh
curl -X DELETE localhost:3000/decks/es-food
```

```sh
curl -X POST localhost:3000/decks -H 'content-type: application/json' \
  -d '{"id":"es-food","name":"Food","language":"Español"}'
```

### GET /decks/:deckId/words

Returns every word in the deck, in deck order. There is no pagination, filtering or search.
An existing deck with no words returns `{ "words": [] }`.

| Status | Body                                       | When            |
| ------ | ------------------------------------------ | --------------- |
| `200`  | `{ "words": WordDto[] }`                   | Deck exists     |
| `404`  | `{ "error": "deck_not_found", "message" }` | No such deck    |

### POST /decks/:deckId/words

Appends words to the end of a deck, in request order.

```ts
interface AddWordsRequest {
  words: NewWord[]; // 1 to 1000 items
}

interface NewWord {
  id?: string;                    // non-empty; generated (UUID v4) when omitted
  question_short?: string | null; // default null; "" is stored as null. Null makes a sentence card
  answer_short?: string | null;   // default null; "" is stored as null
  question_example: string;       // required; must contain a non-whitespace character
  answer_example: string;         // required; must contain a non-whitespace character
}
```

**All or nothing.** If any word is rejected, none are added. On success the response holds
the created words, in request order, with their final `id`s and all counters at `0`. Use
those ids for later calls.

Concurrent requests to the same deck are processed one at a time, so their positions never
collide.

Checks run in this order, and the first failure is returned:

| Status | Body                                           | When                                                    |
| ------ | ---------------------------------------------- | ------------------------------------------------------- |
| `400`  | `FST_ERR_VALIDATION`                           | Body doesn't match the schema above                     |
| `400`  | `{ "error": "duplicate_word_ids", "message" }` | The same `id` appears twice in `words`                  |
| `400`  | `{ "error": "duplicate_question_examples", "message" }` | The same `question_example` appears twice in `words` |
| `404`  | `{ "error": "deck_not_found", "message" }`     | No such deck                                            |
| `409`  | `{ "error": "question_examples_taken", "message" }` | A `question_example` already belongs to a word in this deck |
| `409`  | `{ "error": "word_ids_taken", "message" }`     | An `id` already belongs to a word, in any deck          |
| `201`  | `{ "words": WordDto[] }`                       | All words added                                         |

The `message` for `duplicate_word_ids` and `word_ids_taken` lists the ids involved, e.g.
`"Word ids already exist: es-gato, es-perro."`. The `message` for
`duplicate_question_examples` and `question_examples_taken` lists the sentences involved,
quoted, e.g. `"Question examples already in this deck: \"¿Me pasas la sal?\"."`.

`question_example` must be unique within a deck. The comparison is exact: case, spacing and
punctuation all count, so `"Hola."` and `"hola."` are different sentences. The same sentence
may appear in different decks.

```sh
curl -X POST localhost:3000/decks/es-food/words -H 'content-type: application/json' -d '{
  "words": [
    { "id": "es-pan", "question_short": "el pan", "answer_short": "bread",
      "question_example": "Compro pan cada mañana.", "answer_example": "I buy bread every morning." },
    { "question_example": "¿Me pasas la sal?", "answer_example": "Can you pass me the salt?" }
  ]
}'
```

The second word becomes a sentence card with a generated id.

### PATCH /words/:wordId

Edits a word. Send only the fields to change; omitted fields keep their value.

```ts
interface EditWordRequest {        // at least one field
  question_short?: string | null;  // null or "" makes it a sentence card
  answer_short?: string | null;    // "" is stored as null
  question_example?: string;       // must contain a non-whitespace character
  answer_example?: string;         // must contain a non-whitespace character
}
```

The rules are the same as when adding a word, including that `question_example` must be
unique within the deck. Sending the word's current `question_example` again is fine.

The `id`, deck, position and counters can't be changed. Sending `id` or a counter has no
effect, like any other unknown field, but a body with none of the four fields above gets
`400`.

Checks run in this order, and the first failure is returned:

| Status | Body                                               | When                                                        |
| ------ | -------------------------------------------------- | ----------------------------------------------------------- |
| `400`  | `FST_ERR_VALIDATION`                               | No editable field sent, or a field blank or of the wrong type |
| `404`  | `{ "error": "word_not_found", "message" }`         | No word with this id                                        |
| `409`  | `{ "error": "question_example_taken", "message" }` | Another word in the deck has this `question_example`        |
| `200`  | `{ "word": WordDto }`                              | Edited; `word` has the new values                           |

```sh
curl -X PATCH localhost:3000/words/es-pan -H 'content-type: application/json' \
  -d '{"answer_short":"bread, loaf"}'
```

### DELETE /words/:wordId

Deletes one word, including its counters. This cannot be undone. The other words in the deck
keep their order. The word's `id` and `question_example` can be used again afterwards.

Send no body and no `Content-Type`, as for [`DELETE /decks/:deckId`](#delete-decksdeckid).

| Status | Body                                       | When                 |
| ------ | ------------------------------------------ | -------------------- |
| `204`  | None                                       | Deleted              |
| `404`  | `{ "error": "word_not_found", "message" }` | No word with this id |

```sh
curl -X DELETE localhost:3000/words/es-pan
```

### POST /words/:wordId/reviews

Records one answer to a card. This is the only way the counters change, and there is no
separate endpoint for counting a show.

```ts
interface ReviewRequest {
  correct: boolean; // true: answered right; false: answered wrong
}
```

Each call adds 1 to `shows_count`, and then 1 to `successes_count` if `correct` is `true`, or 1
to `failures_count` if it is `false`. The update is a single database statement, so
concurrent calls are all counted.

**This call is not idempotent.** Every call counts. Retrying after a timeout, when the first
attempt may have reached the server, can count the same answer twice.

Send a real JSON boolean. The server also converts `"true"`, `"false"`, `1` and `0` to
booleans, but don't rely on that.

| Status | Body                                       | When                            |
| ------ | ------------------------------------------ | ------------------------------- |
| `200`  | `{ "word": WordDto }`                      | Counted; `word` has the new counts |
| `400`  | `FST_ERR_VALIDATION`                       | `correct` missing or not boolean |
| `404`  | `{ "error": "word_not_found", "message" }` | No word with this id            |

```sh
curl -X POST localhost:3000/words/es-pan/reviews -H 'content-type: application/json' \
  -d '{"correct":true}'
```

## Errors

Error bodies come in three shapes. All of them have a string `message` suitable for showing
to a developer.

**1. API errors**, returned by route handlers: `{ "error": string, "message": string }`.

| `error`              | Status | Meaning                                       |
| -------------------- | ------ | --------------------------------------------- |
| `deck_not_found`     | `404`  | The `deckId` in the path doesn't exist        |
| `word_not_found`     | `404`  | The `wordId` in the path doesn't exist        |
| `deck_id_taken`      | `409`  | `POST /decks` with an `id` already in use     |
| `word_ids_taken`     | `409`  | `POST /decks/:deckId/words` with ids already in use |
| `duplicate_word_ids` | `400`  | The same id twice in one add-words request    |
| `question_examples_taken` | `409` | `POST /decks/:deckId/words` with a `question_example` already in the deck |
| `question_example_taken` | `409` | `PATCH /words/:wordId` with a `question_example` another word in the deck has |
| `duplicate_question_examples` | `400` | The same `question_example` twice in one add-words request |
| `internal_error`     | `500`  | Unexpected failure; details are only in the server log |

**2. Request errors**, returned by the framework before a handler runs:
`{ "statusCode": number, "code": string, "error": string, "message": string }`.

| `code`                           | Status | Cause                                                  |
| -------------------------------- | ------ | ------------------------------------------------------ |
| `FST_ERR_VALIDATION`             | `400`  | Body or path doesn't match the schema                  |
| `FST_ERR_CTP_INVALID_MEDIA_TYPE` | `415`  | Missing or unsupported `Content-Type`                  |
| `FST_ERR_CTP_EMPTY_JSON_BODY`    | `400`  | `Content-Type: application/json` with an empty body    |
| `FST_ERR_CTP_INVALID_JSON_BODY`  | `400`  | Body is not valid JSON                                 |
| `FST_ERR_CTP_BODY_TOO_LARGE`     | `413`  | Body over 1 MiB                                        |

A validation `message` names the first problem only, as a path into the body, e.g.
`"body/words must NOT have fewer than 1 items"` or
`"body/words/0 must have required property 'question_example'"`.

**3. Unknown routes**, including unsupported methods such as `PUT`:
`404 { "message": "Route PUT:/decks/x not found", "error": "Not Found", "statusCode": 404 }`.

To tell the shapes apart, check for `code` (request error), then `error` with no `statusCode`
(API error).

## Not supported

Calls for any of these get a `404` (no such route), so don't try them.

- Renaming or editing decks: there is no `PUT` or `PATCH` route for decks. Words can be edited
  with [`PATCH /words/:wordId`](#patch-wordswordid), and decks and words can be deleted.
- Moving words between decks, or reordering them.
- Resetting counters, or reading a history of reviews. Only the three totals are stored.
- Pagination, filtering, search, or fetching a single deck or word by id.
- Users, accounts or authentication.

## Typical flows

**Set up a deck:**

1. `POST /decks` with `name` and `language`, and keep the returned `deck.id`.
2. `POST /decks/{id}/words` with up to 1000 words per request.

**Study session:**

1. `GET /decks` and let the learner pick a deck.
2. `GET /decks/{id}/words`, then pick the cards to show using the counters,
   e.g. those with the most `failures_count` relative to `shows_count`.
3. After each answer, `POST /words/{wordId}/reviews` with `{ "correct": … }`, and replace the
   local copy of the word with the returned `word`.

## Local environment

See `README.md` for setup. There are two environments, `development` (default) and
`staging`, each with its own database; the commands below target development, and their
`:staging` variants (e.g. `npm run db:seed:staging`) target staging. Commands that change data:

- `npm run db:migrate` applies migrations from `drizzle/`.
- `npm run db:seed` loads `data/decks/*.json`. For each deck that has a file, it
  **deletes words that aren't in the file**, including words added through the API. Decks
  without a file are not touched. Don't run it on data you want to keep.
