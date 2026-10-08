# План тестов и среда разработки

Дополняет `docs/concept.md` (что строим). Здесь — как проверяем и как поднимаем. Номера кейсов `C..`, решений `B..`, конфликтов `R..` — из концепта.

## 1. Принципы тестирования

1. **Тест называется по кейсу**: `C07 accept_quote retry creates exactly one HOLD`. Список кейсов в концепте — это и есть чеклист покрытия.
2. **Журнал событий — главная поверхность проверки.** Почти каждый тест заканчивается `expect(events).toMatchSequence([...])`. Это дешевле, чем лезть в таблицы, и совпадает с тем, что увидит жюри в админке.
3. **LLM нигде, кроме e2e-real.** У обоих агентов интерфейс `Llm`; в тестах `FakeLlm` с табличными ответами (сопоставление по подстроке, оценка бюджета по словарю). Реальная модель — один smoke-прогон перед записью видео.
4. **Часы и случайность инжектируются.** `Clock` и `IdGen` передаются в каждый сервис; таймаут webhook в тестах 100 мс.
5. **Каждый сервис тестируется в одиночку.** Соседи заменяются фейками, построенными **из тех же Zod-схем** (`packages/contracts`), поэтому фейк не может разойтись с контрактом. Один «проводной» тест на каждый контракт — в e2e.
6. **База — настоящая.** Платформа тестируется на Postgres из compose, магазин — на SQLite в памяти. Без моков репозиториев: деньги и гонки на моках не проверяются.

## 2. Уровни и что в них входит

### 2.1 `packages/contracts` — чистые функции
| Кейсы | Что проверяем |
|---|---|
| C14, C15, C31, C32 | `validateQuote`: позиция без строки, количество не совпало, срок позже дедлайна **по дате** (R4), `validUntil` истёк, `total > budget` как ошибка при `source: user` и предупреждение при `estimated` |
| C21 | `validateProof`: количество меньше, сумма больше, срок позже, пустой счёт |
| R5 | схемы принимают только целые центы |
| — | enum категорий; `Req` с пустым `items` не проходит |

### 2.2 `apps/platform` — на Postgres
| Группа | Кейсы | Что проверяем |
|---|---|---|
| Ledger | C01, C02, C07, C08, C10 | `deposit / hold / release / capture` с ключом идемпотентности: повтор возвращает ту же запись; материализованные `balance/held` = сумме леджера после любой последовательности (property-style: случайные 50 операций) |
| Ledger, гонки | C09 | 10 параллельных `hold` на кошелёк с `available` на один — ровно один успех; `CHECK (available ≥ 0)` не нарушен |
| Policy | C03, C04, C05, C06, B6 | `maxPerDeal`, `maxPerDay` считает холды+списания минус релизы за день, `totalBudget`, категория вне списка; отказ не трогает леджер |
| DealService | все переходы 3.5 | таблица допустимых переходов; недопустимый → ошибка без побочных эффектов; `accept` = политика + холд в одной транзакции; `withdraw` → `HOLD_RELEASE` + `RATING_CHANGED`; `submit_proof` → `validateProof` → `CAPTURE` или `CANCELLED` + вызов `/cancel` исполнителю (через фейк K4) |
| Registry | C12, C31, C18 | discovery покрывает **все** категории задачи; рейтинг по формуле 3.3.1; сброс demo-данных (U2) |
| Events / SSE | C29, R8 | курсор `since` без дублей и пропусков; фильтр по роли **на сервере**: заказчик не получает `agent`-событий исполнителей |
| Auth | C34 | OTP: код выдан, одноразовый, с TTL; сессия с несколькими `identities`; переключение активной; раздел не по роли → 403; MCP с неверным ключом → 401 |
| Stripe | C01, C02 | обработчик webhook с фейковой подписью: `DEPOSIT` один раз на `eventId`; `SIMULATED deposit` помечен в событии |
| Диспетчер агентов | R7, K2, K4 | `POST /run` отправлен один раз на задачу; `/quote` параллельно с `allSettled` и таймаутом (U7): один «мёртвый» исполнитель не ломает остальных |

### 2.3 `apps/buyer-agent` — `FakeLlm` + `FakePlatform` (in-memory реализация K3)
| Кейсы | Что проверяем |
|---|---|
| N1 | `parse_task`: текст → `Req` с категориями из enum и абсолютным дедлайном; предположения записаны как `ASSUMPTION` |
| C35, R2 | `estimate_budget`: нет бюджета → оценка ×1.3, потолок политикой; оценка выше `maxPerDeal` → `FAILED: over_policy` до оферт; оферта выше мягкого бюджета штрафуется, выше ×2 — отброшена как аномалия |
| C14, C16 | ранжирование по формуле: нарушители вне списка с причиной; предпочтение пользователя перевешивает рейтинг |
| C19, C21 (сторона заказчика) | `/run {reason: offer_withdrawn}` → исполнитель в `excludedProviderIds`, принята следующая оферта |
| C13, C22 | все оферты с нарушениями / все исполнители отвалились → `fail_task` с причиной по каждой оферте, одно уведомление |
| R7 | второй `/run` во время работы → `202`, флаг «пересмотреть», один прогон |
| C30 | форма событий: каждый шаг — `STEP_STARTED / TOOL_CALL / TOOL_RESULT / DECISION`, с `runId` и `correlationId` |

### 2.4 `apps/provider-agent` — `FakeLlm` + `FakeStore` (K6/K7) + `FakePlatform` (K5)
| Кейсы | Что проверяем |
|---|---|
| C32, C33 | `make_quote`: нет одной позиции → отказ; живой остаток меньше → отказ; все позиции есть → `Quote` по живой цене |
| C15, B7 | `deliveryEta` из расписания магазина (вода: ближайший вт/чт) и lead time + буфер; абсолютная дата |
| правила | `minOrderTotal`, `markupPct` применяются; оферта ниже минимума → отказ с причиной |
| C11 | `/fulfil` → `POST /orders` → событие `WAITING {until}` → webhook `confirmed` → свой валидатор → `submit_proof` |
| C19 | webhook `rejected` → `withdraw_offer(out_of_stock)` |
| C20 | таймаут (100 мс) → `withdraw_offer(timeout)` + `cancel_order` в магазин |
| C08, C24 | повтор webhook по `storeOrderId` → ничего; неизвестный id / плохая подпись / старый timestamp → `4xx` + `WEBHOOK_REJECTED` |
| K4 `/cancel` | заказ в магазине отменён, связь `storeOrderId ↔ dealId` закрыта |

### 2.5 `apps/demo-store` — SQLite в памяти
| Кейсы | Что проверяем |
|---|---|
| K6 | `GET /catalog` по схеме; `GET /products/{sku}` отдаёт цену и остаток |
| B4, C23 | резерв атомарен: два параллельных заказа на последнюю пачку → один `confirmed`, один `rejected`; нехватка → `rejected`, не частичное |
| R1 | `inventoryLag: true`: `/products` отдаёт снимок, `/orders` резервирует по живому складу; «продать офлайн» меняет только живой |
| K7 | webhook подписан HMAC с timestamp и nonce; ретрай с backoff при `5xx`; отмена освобождает резерв |
| дашборд | список заказов и остатков обновляется; кнопки «подтвердить / отклонить / продать офлайн» |

### 2.6 e2e — `docker compose --profile test`, все 11 сервисов, `LLM=fake`
Проверка через публичный API платформы и журнал событий; в магазин заглядываем через его API.

| Сценарий | Кейсы | Ожидание |
|---|---|---|
| Основной | C11 + C19 + C35 | события в порядке раздела 6 схемы; баланс покупателя, кошелёк №3, рейтинг №2 −0.3; заказ в №2 `rejected`, в №3 `confirmed` |
| Лимит | C03 | `REJECTED_BY_POLICY`, леджер не изменился |
| Идемпотентность | C07, C02, C08 | повтор `accept`, повтор webhook Stripe, повтор webhook магазина → леджер не изменился, `IDEMPOTENT_REPLAY` |
| Отказ заказчика | C21 | магазин подтвердил другую сумму → `CANCELLED`, заказ в магазине отменён, переключение |
| Онбординг | C27 | новый магазин (пятый экземпляр `demo-store`) появился в discovery без перезапуска |
| Авторизация | C34 | OTP → сессия → добавить учётку админа → переключиться → админский журнал виден; заказчику → 403 |
| Мультипозиция | C31 | «бумага + ручки» → только №2 и №3 в оферте, один холд |

`e2e-real`: тот же основной сценарий с `LLM=real`, запускается вручную один раз перед записью видео. Не в CI-прогоне.

## 3. Среда разработки

### 3.1 Стек (зафиксировано)
| Слой | Выбор | Почему |
|---|---|---|
| Язык | TypeScript strict, Node 22, ESM | по CLAUDE.md |
| Монорепо | `pnpm workspaces` | одна `node_modules`, общие пакеты без публикации |
| HTTP | Fastify | быстро, схемы из Zod через `fastify-type-provider-zod` |
| Валидация | Zod | схемы контракта = валидация = JSON Schema для tool-definitions LLM (U4) |
| БД платформы | Postgres 16 + Drizzle ORM + SQL-миграции | транзакции и `FOR UPDATE` руками, типы из схемы |
| БД магазина | `better-sqlite3` | файл на экземпляр, ничего поднимать не надо |
| LLM | `@anthropic-ai/sdk`, Claude Sonnet 5.5, tool use, `temperature 0` | N3 |
| MCP | `@modelcontextprotocol/sdk`, HTTP-транспорт, в процессе платформы | 3.7 |
| Фронт | Vite + React + TS, без UI-кита, CSS-модули | B17; в проде статика из платформы |
| Магазин UI | server-rendered HTML (шаблоны в коде), без сборки | «это не мы, это магазин» |
| Тесты | Vitest + `supertest`; e2e — Vitest против compose | один раннер на всё |
| Realtime | SSE руками (`text/event-stream`), курсор `since` | B14 |

### 3.2 Структура
```
.
├── apps/
│   ├── platform/        src/{ledger,policy,deals,registry,events,auth,stripe,mcp,http}  migrations/  test/
│   ├── buyer-agent/     src/{run,tools,prompts,llm}  test/
│   ├── provider-agent/  src/{quote,fulfil,webhook,store-client,llm}  test/
│   ├── demo-store/      src/{db,api,webhook,views}  seeds/{aqua,papirna,kancelar,levny}.json  test/
│   └── web/             src/{landing,buyer,provider,admin,components}
├── packages/
│   ├── contracts/       office-supplies.v1: schemas, validate*, categories enum, store webhook schema
│   └── shared/          events (types + writer), Llm (Anthropic + Fake), Clock, jwt, hmac, http (x-request-id), logger
├── e2e/                 сценарии против compose
├── docker-compose.yml   профили: core · dev · stripe · test
├── .env.example
└── docs/
```

### 3.3 Compose и порты
Блоки 3380–3399 (концепт 10.1). При первом `docker compose up` — записать в `~/.claude/registry.md` и закоммитить.

| Профиль | Сервисы |
|---|---|
| `core` | `db` 3386 · `platform` 3380 · `buyer-agent` 3381 · `provider-agent-{1..4}` 3382–3385 · `store-{1..4}` 3390–3393 |
| `dev` | + `web` 3387 (Vite, прокси на 3380) |
| `stripe` | + `stripe-cli listen --forward-to platform:3380/webhooks/stripe` |
| `test` | `core` с `LLM=fake`, отдельная БД `platform_e2e` (`PLATFORM_DB`; `platform_test` — у юнит-тестов платформы), + `store-5` 3394 для C27 |

Один `Dockerfile` на приложение, общий базовый слой с `pnpm install --frozen-lockfile`. Экземпляры исполнителей и магазинов — один образ, разные env:
`PROVIDER_ID`, `STORE_URL`, `WEBHOOK_SECRET`, `PORT` у агента; `SEED`, `WEBHOOK_URL`, `WEBHOOK_SECRET`, `PORT` у магазина.

### 3.4 Env
`.env.example` — полный список; `.env` не коммитится.
```
ANTHROPIC_API_KEY=            # пользователь кладёт сам
LLM=real|fake                 # по умолчанию fake, чтобы всё поднималось без ключа
STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= STRIPE_PUBLISHABLE_KEY=
DATABASE_URL=postgres://app:app@db:5432/platform
AGENT_JWT_SECRET=             # платформа ↔ агенты
SESSION_SECRET=
CLOCK=real|fixed:2026-10-09T09:00:00Z   # fixed — для детерминированных прогонов и видео
```

### 3.5 Команды
| Команда | Что делает |
|---|---|
| `pnpm dev` | `compose --profile core --profile dev up` + логи всех сервисов в одном окне |
| `pnpm test` | unit всех пакетов (2.1–2.5); платформа поднимает `db` из compose сама |
| `pnpm test:e2e` | `compose --profile test up -d` → миграции → seed → сценарии 2.6 → down |
| `pnpm seed` | сброс demo-данных: пользователи, политика, 4 магазина с остатками, рейтинги, пустой журнал (U2, R3) |
| `pnpm db:migrate` | миграции платформы |
| `pnpm demo:real` | `LLM=real`, `CLOCK=fixed`, seed, основной сценарий — перед записью видео |

## 4. Порядок сборки (walking skeleton → наполнение)

Сначала тонкий срез через все 11 сервисов на фейках, потом каждый кубик до кейсов. Так к любому моменту ночи есть «что показать».

| Шаг | Что | Готово, когда |
|---|---|---|
| S1 | монорепо, compose, `.env.example`, `packages/shared` (events, Llm, Clock, jwt, hmac), `packages/contracts` с тестами 2.1 | `pnpm test` зелёный на contracts; `compose up` поднимает 11 пустых Fastify с `/health` |
| S2 | платформа: миграции, Ledger + Policy с тестами 2.2 (C01–C10) | деньги корректны и идемпотентны — критерии (б) и (в) доказаны тестами |
| S3 | платформа: Registry, DealService, Events + SSE, диспетчер K2/K4 с фейками агентов | `DealService` проходит всю таблицу переходов |
| S4 | demo-store: API, резерв, `inventoryLag`, webhook, seed ×4, тесты 2.5 | `curl` на 4 магазина отдаёт разные каталоги |
| S5 | provider-agent: quote/fulfil/webhook на `FakeLlm`, тесты 2.4 | C19/C20 зелёные |
| S6 | buyer-agent: parse/estimate/rank/accept/react на `FakeLlm`, тесты 2.3 | C13/C14/C35 зелёные |
| S7 | **e2e основной сценарий на `LLM=fake`** | первый сквозной прогон, события как в разделе 6 схемы |
| S8 | auth: OTP, сессии, переключение учёток, роли; Stripe Checkout + webhook | C34, C01 в e2e |
| S9 | web: вход, кошелёк + Stripe, форма задачи с «заполнить из текста», лента, **админка-таймлайн**, портал исполнителя с онбордингом | видно всё, что происходит, без чтения логов |
| S10 | `LLM=real` smoke, промпты, `pnpm demo:real` | основной сценарий стабилен 3 раза подряд |
| S11 | e2e остальные сценарии 2.6, кнопка сброса, replay (U3), карточка агента (U6) если успеваем | |
| S12 | лендинг-питч, README с таблицей «реально / SIMULATED / не доделано», видео, слайды | сдано до 07:14 |

Ориентир по времени: S1–S3 до ~01:30, S4–S7 до ~03:30, S8–S9 до ~05:00, S10–S12 до 07:00. Если к 03:30 нет S7 — режем S11 целиком и упрощаем S9 до ленты и админки.

## 5. Статус (обновляется в конце каждого чата сборки)

Новый чат начинает с чтения `CLAUDE.md` → `docs/concept.md` → `docs/plan.md` → этой таблицы. Здесь только факты: что зелёное, что частично, что не начато.

| Шаг | Статус | Заметки |
|---|---|---|
| S1 | готов | contracts: 25 тестов (2.1) зелёные, shared: 13; compose core: 11 сервисов healthy, `/health` отвечает на 3380–3385, 3390–3393. Порты 3380–3399 в registry.md |
| S2 | готов | Ledger + Policy на Postgres: 22 теста (C01–C10, B6) зелёные. capture = HOLD_RELEASE + CAPTURE_OUT + CAPTURE_IN, дневной лимит без двойного счёта. Миграции применяются при старте платформы |
| S3 | готов | DealService: вся таблица переходов 3.5 (18 недопустимых комбинаций отвергаются без побочных эффектов). Registry: discovery по покрытию категорий, рейтинг 3.3.1, seed U2. Events в PG + REST/SSE с курсором since и фильтром по роли на сервере (R8). Диспетчер: /quote allSettled+таймаут, /run дедуп (R7), /cancel (K4). 64 теста платформы |
| S4 | готов | demo-store: SQLite, атомарный резерв всего заказа (B4/C23), inventoryLag со снимком и «продать офлайн» (R1), webhook HMAC `t,n,v1` в `x-store-signature` + ретраи с backoff, 4xx не ретраим (K7), отмена возвращает резерв, лендинг + дашборд с кнопками. Ответ `/orders` всегда `pending`, решение — webhook. Seed ×4. 22 теста (2.5); compose: 4 магазина отдают разные каталоги |
| S5 | готов | provider-agent: make_quote (LLM подбирает sku, живая цена+markup, minOrderTotal, ETA = расписание+буфер B7), fulfil с opaque buyerRef и таймером C20, webhook-приёмник (HMAC+nonce+staleness, дедуп по storeOrderId C08, свой валидатор «подтверждение ⊇ заказ»), /cancel K4, JWT-auth от платформы. Порты: StoreClient K6 (http), PlatformPort K5 (http-клиент готов, серверные маршруты /agent/* — S7). 18 тестов (2.4), C19/C20 зелёные |
| S6 | готов | buyer-agent: parse_task (N1, ASSUMPTION-события, бюджет user/estimated, центы на границе R5), estimate_budget ×1.3 с потолком политикой и FAILED: over_policy до оферт (C35/R2, мягкий бюджет: штраф 0.2, аномалия ×2 вне списка), ранжирование в коде rating×0.5+match×0.3+цена×0.2, предпочтение +0.5 (C14/C16), fail_task один раз с причиной по каждой оферте (C13/C22), R7-guard с флагом «пересмотреть», события C30 с runId+correlationId. Порт K3 (http-клиент готов, маршруты /agent/* — S7). 16 тестов (2.3) |
| S7 | готов | Сквозной сценарий C11+C19+C35 на LLM=fake зелёный (e2e/main-scenario.test.ts, 5 тестов): оценка бюджета → 3 оферты (levny мимо по сроку) → papirna → out_of_stock → отзыв, рейтинг 4.9→4.6 → kancelar → confirmed → CAPTURE 42 $ → SETTLED; баланс 58 $, события по разделу 6. Платформа: /agent/* (K3/K5 по HTTP, JWT), публичные /tasks /wallets /providers /events, dev-маршруты /dev/seed и /dev/deposit (SIMULATED, до Stripe S8). Fake-LLM эвристики в агентах (подбор по подстроке, бюджет по словарю). e2e — на отдельной БД platform_e2e (env PLATFORM_DB, dev-данные не трогаются); platform_test остаётся юнит-тестам платформы. Отклонение от плана: таймауты в e2e штатные, не 100 мс. Команды: pnpm e2e:up / e2e:run / e2e:down или test:e2e |
| S8 | готов | Auth: OTP (код SIMULATED в ответе, одноразовый, TTL 10 мин, незнакомый email регистрируется заказчиком), сессии cookie `sid` 7 дн., несколько учёток с переключением, `/admin/events` только admin (403), фоллбэк x-role для e2e/агентов. Stripe: `POST /wallet/checkout` (Checkout Session), `/webhooks/stripe` с проверкой подписи по сырому телу, DEPOSIT по ключу `deposit:stripe:{eventId}`, события леджера несут userId владельца кошелька (для SSE-ленты, N4). MCP на `/mcp` (Streamable HTTP, stateless, API-ключ, 4 инструмента 3.7; `parseTask` в диспетчере). Seed: users с фикс. ключами `ak-buyer-demo` и т.п. 19 новых юнит-тестов, e2e auth-stripe.test.ts (7). `STRIPE_WEBHOOK_SECRET` в e2e фикс. `whsec_e2e` (в скриптах); реальный — от `stripe listen` в .env |
| S9 | готов | web (Vite+React, хэш-роутер без зависимостей, /api-прокси в платформу — cookie same-origin): вход по OTP с кодом SIMULATED, переключатель учёток «+ добавить учётку», кошелёк (Stripe Checkout + SIMULATED-фоллбэк, возврат ?topup=pending ждёт DEPOSIT по SSE — N4), форма задачи «заполнить из текста» с превью и ASSUMPTION-бейджами, страница задачи с таймлайном и офертами, лента с колокольчиком, админка (агенты сейчас, фильтры kind/actor/type/task, сброс демо), портал исполнителя (свой журнал, реестр, онбординг-форма → POST /providers/onboard, C27). SSE-хук переподключается при смене учётки (R8 не течёт между ролями). FakeLlm доучен эвристическому parse_task (помечает ASSUMPTION «LLM=fake»), /parse работает без ключа. Проверено вживую в браузере: реальный Stripe Checkout картой 4242 → webhook через stripe-cli (compose-команде добавлен --events) → DEPOSIT по SSE; задача из текста прошла C11+C19 до SETTLED, включая создание через MCP |
| S10 | готов | LLM=real smoke: `pnpm demo:real` поднимает стек с LLM=real (--build) и гоняет основной сценарий ОТ СВОБОДНОГО ТЕКСТА (e2e/demo-real.ts): parse_task настоящей моделью → оферты (select_products у 3 исполнителей) → papirna out_of_stock → kancelar SETTLED $42; инварианты: баланс $58 + заработок $42 = $100, held 0. Стабильно 3/3, ~12–15 c на прогон. Отклонения: `temperature` у claude-sonnet-5-5 deprecated — убран из AnthropicLlm; CLOCK оставлен real (fixed для видео не понадобился — ассампшены парсера привязываются к реальному «сейчас»). Промпты не менялись — хватило S5/S6 |
| S11 | готов | e2e/scenarios-s11.test.ts (+4 теста, всего e2e 16): C03 лимит — оферта $152 > maxPerDeal, accept отвергнут политикой, REJECTED_BY_POLICY, леджер нетронут; C31 мультипозиция — оферты только papirna/kancelar (покрытие категорий), ровно один HOLD_PLACED, SETTLED; C08 — повтор подписанного store-webhook в агента settled-провайдера: дедуп, баланс не изменился; C27 — POST /providers/onboard: провайдер в discovery сразу, PROVIDER_ONBOARDED, мёртвый agentUrl не ломает задачу (U7). U6: /.well-known/agent.json у provider-agent (карточка A2A-стиля). Кнопка сброса — была в админке с S9; U3 replay = таймлайн задачи в админке. Пропущено осознанно: C21 в e2e не воспроизводится без ручного вмешательства (цены живые, окна дрейфа нет) — покрыт юнитами на 3 уровнях (contracts validateQuote/validateProof, platform deals, provider confirmation-mismatch) |
| S12 | не начат | |

Блоки чатов: **A** = S1–S3 · **B** = S4–S7 · **C** = S8–S9 · **D** = S10–S12.

Stripe локально: `.env` заполнен (`STRIPE_WEBHOOK_SECRET` — от `stripe listen --print-secret`, стабилен ~90 дней для аккаунта); вебхуки доставляет профиль `stripe` (`docker compose --profile stripe`), endpoint в дашборде не нужен. Демо-учётки: buyer@demo.local / admin@demo.local / {aqua,papirna,kancelar,levny}@demo.local, MCP-ключи `ak-buyer-demo` и т.п. (seed). MCP: `POST /mcp`, Bearer-ключ.
