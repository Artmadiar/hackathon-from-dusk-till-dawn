# Презентация: 90-сек видео + 60-сек лайв (правила организатора от 9 окт)

Цель обоих форматов — за секунды показать: **агенты покупают за реальные деньги сами,
человек только пополняет кошелёк и задаёт политику**. Критерии жюри: working e2e (35%) +
value (25%) — всё время экрана тратим на работающий сквозной прогон.

## Подготовка (до записи / до выхода)

- `docker compose --profile core --profile dev up -d` — свежие магазины (заказы в памяти, чистые).
- Вкладки открыты заранее: ① Buyer home · ② Task (откроется) · ③ Back office магазина-победителя
  (обычно Papírna: http://localhost:3390/dashboard) · ④ Admin journal.
- Три identity в account switcher залогинены заранее (buyer / provider / admin).
- Кошелёк уже пополнен через Stripe (чек в видео показываем, в лайве — уже готовый баланс).
- Лайв — fake-LLM (мгновенно); видео — реальный прогон `demo:real` (честно, стабильно 3/3).

## Видео, 90 секунд (раскадровка)

| Время | Экран | Текст за кадром (EN) |
|---|---|---|
| 0–10 | Логин/лендинг → Buyer home | "AI agents can decide — but when it's time to pay, a human still pulls out a card. We built a marketplace where agents buy from agents with real money, safely." |
| 10–22 | Wallet: Stripe top-up уже сделан, баланс + policy | "You top up a wallet once — real Stripe checkout — and set a spending policy. From here on, your agent spends on its own, within limits." |
| 22–38 | Buyer home: ввод текста → Fill from text → структура → Create | "You just say what you need. The agent turns free text into a structured request — budget, deadline, categories." |
| 38–52 | Task page: степпер бежит, карточки офферов 4 магазинов с именами и ценами | "The platform discovers four independent stores; their agents quote in seconds. The buyer agent compares price, delivery and rating." |
| 52–66 | Момент решения: HELD → ORDER_PLACED; переключение на Back office магазина — заказ прилетел, invoice | "The platform — deterministic code, not the LLM — holds the funds and places the order. Here's the store's own back office: the order just arrived in *their* system." |
| 66–78 | Proof → SETTLED; степпер DONE; Admin: hold → capture в леджере | "Delivery proof comes back, the hold is captured to the store's wallet. Every cent is double-entry ledger, every event logged." |
| 78–90 | Failure-кейс 3 сек (offer withdrawn → агент к следующему) → финальный кадр с названием | "If a store fails, funds release automatically and the agent re-orders elsewhere. Humans top up; agents do the buying. [Название проекта]" |

Приёмы: курсор не ищет — всё в закладках; монтаж жмёт паузы; на 38–66 можно x1.5.

## Лайв, 60 секунд

1. **0–10** — одна фраза питча (та же, что в видео) + экран Buyer home уже открыт.
2. **10–35** — вживую: вставить текст задачи → Create → степпер и офферы на глазах →
   вкладка ③: заказ появился в бэк-офисе магазина (автообновление 5 сек).
3. **35–50** — вкладка ④ Admin: показать hold → capture, одна фраза: "money is held by the
   platform, LLMs only propose — and if a store fails, the agent switches to the next one."
4. **50–60** — закрытие: "One top-up, policy-bounded autonomous purchasing. Everything you saw
   is running live; only Stripe is test mode, marked SIMULATED where it matters."

Запасной план: если лайв падает — показать видео ещё раз с живым комментарием по вкладкам.

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
