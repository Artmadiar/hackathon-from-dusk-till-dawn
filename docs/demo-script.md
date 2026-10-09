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

## Видео, 90 секунд — ФИНАЛ (записано 9 окт ~06:15, реальный LLM + реальный Stripe test-mode)

Видеоряд записан скриптом (Playwright), файл: scratchpad/demo-silent.mp4 (немой мастер).
Голос пишет Азамат на телефон 7 блоками; блоки выравниваются по началу отрезков при склейке.

| Сек | Экран | Текст блока (EN) |
|---|---|---|
| 0–10 | Слайд-схема Shop Elf | "This is Shop Elf: your personal buying agent. You tell it what you need — and it buys from other agents on the marketplace, with real money." |
| 10–20 | Кошелёк: $100, история с бейджем Stripe | "Your part is simple. Top up the wallet — one real Stripe payment — and set a spending limit. That is the elf's budget." |
| 20–36 | Stores (витрина) → ввод текста → драфт → start the agent | "These are the stores on the marketplace, with live catalogs. Now you just type what you need, in plain words. The elf turns it into a real order — items, budget, deadline — and gets to work." |
| 36–47 | Офферы 3 магазинов; Papírna отваливается out-of-stock | "Three stores answer with offers in seconds. The elf compares price, delivery and rating — and picks the best deal." |
| 47–57 | Бэк-офис Kancelář Plus: заказ прилетел, confirmed | "The elf chooses — but money moves only through the platform: plain code, not AI. And this is the store's own system: the order just arrived." |
| 57–76 | SETTLED + зелёный степпер; админ: hold → capture, deposit via Stripe | "The store confirms delivery — and the money goes to its wallet. Every cent is tracked in the ledger. And if a store fails? The money comes back, and the elf simply orders from the next one." |
| 76–90 | Финальный слайд с названием | "Everything you saw ran live. Stripe is in test mode. And the stores are our own demo shops — connected like real external businesses. Shop Elf: you set the budget, your elf does the buying." |

Запись голоса: тихо, телефон близко, пауза 1–2 сек между блоками; сбился — повтори блок, лишнее вырежется.

## Питч, 60 секунд — ФИНАЛ (три слайда: docs/pitch-slides.html, стрелки/клик, фуллскрин)

| Сек | Слайд | Текст (EN) |
|---|---|---|
| 0–10 | 1 · «Your agent can choose. It can't pay.» | "Ask an AI agent to buy something. It finds the product, compares prices — and then it stops. A human pulls out the card. Agents can choose — they can't pay." |
| 10–30 | 2 · Карта: You → Elf → Platform → Store agents → Stores | "We built Shop Elf: a marketplace where your agent buys from store agents — with real money. You top up a wallet and say what you need. Your elf compares offers and completes the deal. Stores plug in with a public API and one webhook." |
| 30–45 | 3 · «Agents propose. The platform decides.» | "What makes it safe: agents propose, the platform decides. No human presses any buttons. Spending caps are enforced in code, not in the prompt — and nothing ever pays twice: escrow, ledger, automatic failover." |
| 45–60 | 3 (остаёмся) | "Built overnight, running live: real Stripe checkout, four stores, settled deals — it's all in our video. You set the budget. Your elf does the buying. Shop Elf." |

~145 слов. Репетировать вслух с таймером; переключение слайдов: → / пробел / клик.
Блок 3 дословно бьёт в «What wins this topic» со страницы кейса: no human pressing buttons · caps hold (enforced in code) · nothing pays twice.

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
