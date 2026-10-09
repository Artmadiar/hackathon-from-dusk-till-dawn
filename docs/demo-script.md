# Презентация: 90-сек видео + 60-сек питч (правила организатора от 9 окт)

Разделение ролей (уточнение организаторов, утро 9 окт):
- **Видео 90с** — explainer для жюри: что построено за ночь, можно технично. Сюда — весь
  сквозной прогон (working e2e 35% + technical 20% + validation 10%).
- **Питч 60с** — продажа идеи: relevance, value, originality (25% + 10%). Будет 40+ питчей
  по минуте подряд — в голове жюри должны остаться **два месседжа**, а не демо.

Два месседжа (одни и те же в видео и в питче):
1. **Human funds once, agents do the buying** — человек пополняет кошелёк и задаёт политику,
   дальше агенты покупают у агентов за реальные деньги сами.
2. **Agents propose, the platform decides** — LLM не трогает деньги: холд, двойной леджер,
   автопереключение на следующий магазин — детерминированный код.

## Подготовка (до записи / до выхода)

- `docker compose --profile core --profile dev up -d` — свежие магазины (заказы в памяти, чистые).
- Вкладки открыты заранее: ⓪ слайд-схема `docs/video-slide.html` (открыть file://, фуллскрин) ·
  ① Buyer home · ② Task (откроется) · ③ Back office магазина-победителя
  (обычно Papírna: http://localhost:3390/dashboard) · ④ Admin journal.
- Три identity в account switcher залогинены заранее (buyer / provider / admin).
- Кошелёк уже пополнен через Stripe (чек в видео показываем, в лайве — уже готовый баланс).
- Видео — реальный прогон `demo:real` (честно, стабильно 3/3). Лайв-среда — запасная, fake-LLM (мгновенно).

## Видео, 90 секунд (раскадровка)

Структура с формы сабмишна (hq.agents007.ai/submit, «Show it working, not slides»):
15с проблема → 60с живое демо полного сценария → 15с «что реально / что симулировано / что дальше».
Наши слайд-кадры укладываются в первые и последние 15 секунд; середина — только живой продукт.

| Время | Экран | Текст за кадром (EN) |
|---|---|---|
| 0–10 | **Слайд-схема** (`docs/video-slide.html` фуллскрин): Buyers ↔ Platform ↔ Providers, агенты с двух сторон, флоу REQUEST→CAPTURE | "AI agents can decide — but when it's time to pay, a human still pulls out a card. We built a marketplace where agents buy from agents with real money, safely. Here's the map — now watch it run." |
| 10–22 | Wallet: Stripe top-up уже сделан, баланс + policy | "You top up a wallet once — real Stripe checkout — and set a spending policy. From here on, your agent spends on its own, within limits." |
| 22–38 | Buyer home: ввод текста → Fill from text → структура → Create | "You just say what you need. The agent turns free text into a structured request — budget, deadline, categories." |
| 38–52 | Task page: степпер бежит, карточки офферов 4 магазинов с именами и ценами | "The platform discovers four independent stores; their agents quote in seconds. The buyer agent compares price, delivery and rating." |
| 52–66 | Момент решения: HELD → ORDER_PLACED; переключение на Back office магазина — заказ прилетел, invoice | "The platform — deterministic code, not the LLM — holds the funds and places the order. Here's the store's own back office: the order just arrived in *their* system." |
| 66–78 | Proof → SETTLED; Admin: hold → capture; failure-флеш 3 сек (offer withdrawn → агент к следующему) | "Delivery proof comes back, the hold is captured to the store's wallet — double-entry ledger, every event logged. And if a store fails, funds release and the agent re-orders elsewhere." |
| 78–90 | Финальный кадр: снова слайд-схема | "Everything you saw ran live. Stripe is test mode — labeled SIMULATED; settlement is our own double-entry ledger; the four stores are demo instances wired as external businesses. Next: a new domain is just a new contract type. Shop Elf." |

Приёмы: курсор не ищет — всё в закладках; монтаж жмёт паузы; на 38–66 можно x1.5.

## Питч, 60 секунд (без лайв-демо)

Экран: один заранее открытый кадр — Task page завершённой сделки (степпер DONE, офферы
четырёх магазинов, SETTLED). Вкладки не переключаем, курсором не водим: всё время — на речь.

Текст (EN, ~140 слов, обычный темп):

> **0–8 · Hook.** "Every AI-agent demo ends the same way: the agent decides — and a human
> pulls out a credit card. The agentic economy stops at checkout."
>
> **8–25 · Что это (месседж 1).** "Shop Elf is a marketplace where agents buy
> from agents with real money. You top up a wallet once, set a spending policy — and your
> agent discovers stores, compares offers and pays on its own, within your limits."
>
> **25–42 · Почему безопасно (месседж 2).** "What makes it safe: agents propose, the
> platform decides. Money only moves through deterministic code — escrow holds, a
> double-entry ledger, automatic failover to the next store when one drops out. The LLM
> never touches a cent."
>
> **42–60 · Доказательство + закрытие.** "Built overnight and running end-to-end: a real
> Stripe top-up, four independent stores with their own back offices, settled deals and
> handled failures — it's all in our 90-second video. One top-up. Policy-bounded autonomous
> buying. Shop Elf."

Запасной план: среда остаётся поднятой (раскладка вкладок ниже) — если жюри задаст вопрос
или останутся секунды, показываем живой Task page, но питч на это не рассчитывает.

## Что честно говорим про ограничения (критерий 5, 10%)

- Stripe — test mode; расчёты между кошельками — наш леджер, не банковские переводы.
- Магазины — демо-экземпляры одного кода с разными сидами (но подключены как внешние: публичный API + webhook).
- Один домен контракта (office-supplies.v1); новый домен = новый тип контракта, ядро не трогаем.

## Репетиция на real-LLM (проверено 9 окт ~04:55)

Стек переведён на настоящую нейронку: `LLM=real` закреплён в `.env`, stripe-cli поднят
(секреты сверены). Реальный прогон воды прошёл: parse ~5 сек, aqua SETTLED $29.70.

**Раскладка вкладок** (важно: вкладки одного браузера делят одну сессию и одну активную
учётку — для одновременных ролей нужны разные окна):

| Окно | Кто | Что открыть |
|---|---|---|
| Основное | Demo Buyer | localhost:3387 — New task + Activity; после Create откроется Task со степпером |
| Инкогнито | Platform Admin (admin@demo.local, OTP покажется на экране) | localhost:3387/#/admin — Journal с чипом Money или Agents |
| Обычные вкладки (без логина) | — | бэк-офисы магазинов: aqua **:3390**, papirna :3391, kancelar :3392, levny :3393 — автообновление 5 сек |

**Про «аномальную цену»**: если заказать воду без объёма («a bottle of water»), оценщик
бюджета посчитает магазинную бутылку ($0.5–3), aqua предложит офисную 19L за $13.20, и
защита от аномалий честно отсечёт котировку (>2× оценки) — задача упадёт с понятным
объяснением в таймлайне. Это демо-годный guardrail, но в сквозном прогоне называй объём.

**Формулировка для воды** (aqua возит вт/чт; сегодня пт → ближайшая доставка вт 13-е,
поэтому срок минимум 4-5 дней, иначе честный FAIL «eta after deadline»):
`We need drinking water for the office: 2 big 19L bottles and a pack of paper cups, within 5 days`

Бумага (кейс из видео, папирна отвалится по out_of_stock, kancelar выиграет):
`Order 5 packs of A4 paper (500 sheets each), deliver within 4 days`

**Состояние сброшено**: журнал пуст, кошелёк buyer $100, магазины без заказов.
Сброс перед новым дублем **обязателен**: политика трат считает totalBudget $100 накопительно по всем задачам — второй прогон без сброса честно упадёт с over_total_budget (это, кстати, демо-годный кейс C35). Кнопка Reset demo в админке + SIMULATED deposit в Wallet
(или живой Stripe-топап картой 4242… — вебхук работает).
