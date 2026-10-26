# Savant API — интеграция по API-ключу

Документ описывает, как внешняя система запускает аудиты смарт-контрактов в Savant
и забирает результаты, используя API-ключ. Источник — `backend/api/openapi.yaml`
и код в ветке `main` (состояние на 2026-10-26). Схемы приведены дословно из
OpenAPI-спецификации.

---

## 1. Что можно и чего нельзя делать по API-ключу

| Действие | По ключу | Эндпоинт |
| --- | --- | --- |
| Узнать тарифы (цена за строку) | ✅ | `GET /api/v1/audit-jobs/plan-rates` |
| Оценить стоимость аудита (без списания) | ✅ | `POST /api/v1/audit-jobs/estimate` |
| Загрузить вспомогательный документ заранее | ✅ | `POST /api/v1/audit-documents` |
| Запустить аудит из файлов / ZIP / TAR / TAR.GZ | ✅ | `POST /api/v1/audit-jobs` |
| Список аудитов | ✅ | `GET /api/v1/audit-jobs` |
| Статус и прогресс аудита | ✅ | `GET /api/v1/audit-jobs/{id}` |
| Структурированный отчёт (JSON) | ✅ | `GET /api/v1/audit-jobs/{id}/report` |
| Отчёт файлом (md / json / pdf / zip) | ✅ | `GET /api/v1/audit-jobs/{id}/report/download` |
| Скачать исходники аудита | ✅ | `GET /api/v1/audit-jobs/{id}/source/download` |
| Импорт из GitHub (приватный или публичный репо) | ❌ только сессия | `POST /api/v1/repo/imports`, `/repo/imports/public` |
| Импорт контракта по адресу (Etherscan и т.п.) | ❌ только сессия | `POST /api/v1/contract-imports` |
| Тестовый режим без LLM (dry run) | ❌ только админ из браузера | — |
| Создание / ротация / удаление ключей | ❌ только сессия | `/api/v1/api-keys` |
| Пополнение баланса, платежи, выплаты, KYC | ❌ только сессия | — |

Вебхуков о завершении аудита нет, статус нужно опрашивать (см. §6).

---

## 2. Базовые URL

| Окружение | Base URL |
| --- | --- |
| Production | `https://savant.chat` |
| Dev / staging | `https://dev.savant.chat` |

Все пути ниже относительны к Base URL и начинаются с `/api/v1`.

---

## 3. API-ключи

### 3.1 Получение ключа

Ключи создаются в веб-интерфейсе Savant, то есть из браузерной сессии. Программно ключом нельзя выпустить другой ключ.

Свойства ключа:

- формат: `svk_<…>`;
- полный текст показывается **один раз** при создании или ротации, в БД хранится
  только префикс и SHA-256 хеш;
- можно задать срок действия `expires_at`; просроченный или выключенный ключ
  отклоняется с `401`;
- ключ действует **от имени создавшего его пользователя** (`kind: user`):
  тот же баланс, те же лимиты, те же аудиты.

Схемы, относящиеся к управлению ключами (для справки; эти эндпоинты требуют сессию):

```yaml
ApiKeyKind:
  type: string
  enum: [user]

CreateApiKeyRequest:            # POST /api/v1/api-keys
  type: object
  additionalProperties: false
  properties:
    name:       { type: string, maxLength: 120 }
    kind:       { $ref: ApiKeyKind }
    expires_at: { type: string, format: date-time }

ApiKeyCreatedResponse:          # ответ на create и rotate
  type: object
  required: [id, prefix, plaintext]
  properties:
    id:        { type: string, format: uuid }
    prefix:    { type: string }
    plaintext: { type: string }   # полный ключ svk_…, показывается один раз

ApiKey:                         # элемент GET /api/v1/api-keys
  type: object
  required: [id, prefix, name, kind, active, created_at]
  properties:
    id:           { type: string, format: uuid }
    prefix:       { type: string }
    name:         { type: string }
    kind:         { $ref: ApiKeyKind }
    active:       { type: boolean }
    expires_at:   { type: string, format: date-time }
    last_used_at: { type: string, format: date-time }
    created_at:   { type: string, format: date-time }
```

Остальные операции: `POST /api/v1/api-keys/{id}/rotate`,
`PATCH /api/v1/api-keys/{id}` (`{"active": true|false}`), `DELETE /api/v1/api-keys/{id}`.

### 3.2 Передача ключа

Любая из трёх форм заголовка `Authorization`:

```
Authorization: Bearer svk_xxxxxxxx
Authorization: ApiKey svk_xxxxxxxx
Authorization: svk_xxxxxxxx
```

- При наличии заголовка `Authorization` cookie сессии игнорируется.
- CSRF-токен для запросов по ключу **не нужен**.
- Неверный, выключенный или просроченный ключ → `401 unauthorized`.

### 3.3 Контекст: личный или организация

По умолчанию запрос выполняется в **личном** контексте владельца ключа: списания
идут с личного баланса, видны только личные аудиты.

Чтобы работать от имени организации, в которой состоит владелец ключа:

```
X-Savant-Context: org:<organization-uuid>
```

- Аудит, созданный в контексте организации, оплачивается с баланса организации и
  виден только в контексте этой организации.
- Личные аудиты не видны в контексте организации, и наоборот: запрос «не того»
  аудита возвращает `404`, а не `403`.
- Пустой заголовок или `X-Savant-Context: personal` — личный контекст.

---

## 4. Общие соглашения

### 4.1 Деньги

```yaml
MoneyAmount:
  type: string
  description: Decimal money amount serialized as a string with exactly two fractional digits.
  pattern: ^-?\d+\.\d{2}$
  examples: ['10.00']

AuditTokenRate:
  type: string
  description: USD price per source line, preserving configured decimal precision.
  pattern: ^\d+(\.\d+)?$
  examples: ['0.12']
```

Все суммы — USD, строкой. Не парсите их во float, используйте decimal.

### 4.2 Ошибки

Все ошибки возвращаются в едином конверте:

```yaml
ErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      $ref: ErrorBody

ErrorBody:
  type: object
  required: [code, message]
  properties:
    code:    { type: string }   # стабильный машиночитаемый код
    message: { type: string }   # текст для человека
```

Пример:

```json
{ "error": { "code": "unauthorized", "message": "authentication is required" } }
```

Ветвитесь по `error.code`, а не по `message`.

Особые конверты для `402` при создании аудита:

```yaml
InsufficientFundsErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      type: object
      required: [code, message, current_balance, required, shortfall]
      properties:
        code:            { type: string, enum: [insufficient_funds] }
        message:         { type: string }
        current_balance: { $ref: MoneyAmount }
        required:        { $ref: MoneyAmount }
        shortfall:       { $ref: MoneyAmount }

MonthlyLimitExceededErrorEnvelope:
  type: object
  required: [error]
  properties:
    error:
      type: object
      required: [code, message, tier_cap, current_spend, request_cost, shortfall, reset_at, upgrade_path]
      properties:
        code:          { type: string, enum: [monthly_limit_exceeded] }
        message:       { type: string }
        tier_cap:      { $ref: MoneyAmount }
        current_spend: { $ref: MoneyAmount }
        request_cost:  { $ref: MoneyAmount }
        shortfall:     { $ref: MoneyAmount }
        reset_at:      { type: string, format: date-time }
        upgrade_path:  { type: string }
```

### 4.3 Rate limit и повторы

- Создание аудитов ограничено окном per-actor и per-IP (по умолчанию 1000 запросов
  на пользователя и 10000 на IP в час; значения настраиваются на сервере).
- `429` и `503` приходят с заголовком `Retry-After` (секунды). Повторяйте не раньше.
- `408 upload_timeout` — загрузка шла слишком медленно или слишком долго; повторите
  или уменьшите архив.

---

## 5. Запуск аудита

### 5.1 Тарифы

```
GET /api/v1/audit-jobs/plan-rates
```

```yaml
AuditPlanRatesResponse:
  type: object
  required: [plan_rates]
  properties:
    plan_rates:
      type: object
      required: [lite, advanced, pro]
      properties:
        lite:     { $ref: AuditPlanRate }
        advanced: { $ref: AuditPlanRate }
        pro:      { $ref: AuditPlanRate }

AuditPlanRate:
  type: object
  required: [rate]
  properties:
    rate:     { $ref: AuditTokenRate }        # USD за строку исходного кода
    discount: { $ref: AuditPlanRateDiscount } # есть, если к пользователю применена скидка

AuditPlanRateDiscount:
  type: object
  required: [standard_rate, percent]
  properties:
    standard_rate: { $ref: AuditTokenRate }
    percent:       { type: number, minimum: 0, maximum: 100 }
```

Тарифы (`tier`) — `AnalysisTier`:

```yaml
AnalysisTier:
  type: string
  enum: [lite, advanced, pro]
```

### 5.2 Тело запроса (общее для estimate и create)

`Content-Type: multipart/form-data`. Схема:

```yaml
AuditJobMultipartRequest:
  type: object
  additionalProperties: false
  required: [tier]
  properties:
    tier:
      $ref: AnalysisTier                  # обязательно: lite | advanced | pro
    file:                                 # повторяемая часть: отдельный файл исходников
      oneOf: [binary, array of binary]
    archive:                              # повторяемая часть: архив исходников
      oneOf: [binary, array of binary]
    document:                             # повторяемая часть: доп. документ (спецификация, whitepaper)
      oneOf: [binary, array of binary]    # документы — бесплатный контекст
    document-archive:                     # повторяемая часть: архив документов
      oneOf: [binary, array of binary]
    staged_document_ids:                  # id документов, загруженных заранее (§5.5)
      type: array
      maxItems: 500
      uniqueItems: true
      items: { type: string, format: uuid }
    promoted_document_path:               # путь ВНУТРИ архива исходников, который считать документом
      oneOf: [string, array of string]
    scope:                                # ограничить аудит выбранными путями
      oneOf: [string, array of string]
    include_excluded:                     # включить файл, исключённый автоматически (тесты, конфиги…)
      oneOf: [string, array of string]
      maxItems: 500
    agent_channel:  { $ref: AgentChannel }  # только админ-сессия — по ключу 403
    agent_image:    { type: string }        # только админ-сессия — по ключу 403
    agent_settings: { type: string }        # только админ-сессия — по ключу 403
    bypass_charge:  { type: boolean }       # только админ; для остальных игнорируется
```

«Повторяемая часть» = в multipart можно передать несколько частей с одним именем
(`-F file=@A.sol -F file=@B.sol`, `-F scope=src/A.sol -F scope=src/B.sol`).

**Архивы.** Формат определяется по содержимому (magic bytes), а не по расширению:
поддерживаются `zip`, `tar`, `tar.gz`. Лимиты на распаковку:

| Лимит | Значение |
| --- | --- |
| Файлов в архиве | 60 000 |
| Размер одного файла | 100 MiB |
| Суммарный распакованный размер | 1 GiB |
| Размер входного архива | 1152 MiB |
| Коэффициент сжатия (zip-bomb) | 200× |
| Глубина вложенности путей | 32 |

Небезопасные пути (`..`, абсолютные, NUL) отклоняются с `archive_unsafe`.

**Автоматическая классификация.** Сервер сам делит файлы на `source` (аудируется
и оплачивается), `free_context` (передаётся агенту как контекст бесплатно) и
`not_auditable`, и исключает тесты, зависимости, сгенерированный код, lock-файлы
и т.п. Результат классификации виден в ответе estimate (§5.3). Чтобы вернуть
исключённый файл в аудит — `include_excluded`; чтобы сузить аудит — `scope`.

Типичные коды `400`: `tier_invalid`, `source_binary`, `source_too_small`,
`no_source_files`, `document_empty`, `document_unsupported`,
`scope_too_many_files`, `archive_too_many_files`, `archive_too_large`,
`file_too_large`, `archive_unsafe`, `archive_invalid`.

### 5.3 Оценка стоимости (бесплатно)

```
POST /api/v1/audit-jobs/estimate[?documents_only=true]
```

Тело — то же, что в §5.2. Ничего не создаёт и не списывает. Рекомендуется
вызывать перед созданием, чтобы показать цену и проверить, какие файлы попадут
в аудит.

`documents_only=true` — оценить только документы (требует `document`/`staged_document_ids`,
запрещает `file`, `archive`, `scope`, `promoted_document_path`, `include_excluded`).

Ответ `200`:

```yaml
AuditJobEstimateResponse:
  type: object
  required: [estimated_cost, token_count, files]
  properties:
    estimated_cost:    { $ref: MoneyAmount }      # итог к списанию
    token_count:       { type: integer, minimum: 0 }
    files:
      type: array
      items: { $ref: AuditJobEstimateFile }
    discount:          { $ref: AuditJobEstimateDiscount }
    excluded_files:
      type: array
      items: { $ref: AuditJobExcludedFile }
    hidden_file_count: { type: integer, minimum: 0 }

AuditJobEstimateFile:
  type: object
  required: [path, tokens, cost, standard_cost, selection_class]
  properties:
    path:               { type: string, minLength: 1 }
    staged_document_id: { type: string, format: uuid }  # только для staged-документов
    tokens:             { type: integer, minimum: 1 }
    cost:               { $ref: MoneyAmount }
    standard_cost:      { $ref: MoneyAmount }           # цена без скидки
    selection_class:    { $ref: AuditSourceFileClass }
    tier:               { $ref: AuditSourceTier }
    reason:             { type: string }
    detail:             { type: string, maxLength: 5500 }
    default_selected:   { type: boolean }

AuditJobEstimateDiscount:
  type: object
  required: [standard_cost, amount, percent]
  properties:
    standard_cost: { $ref: MoneyAmount }
    amount:        { $ref: MoneyAmount }
    percent:       { type: number, minimum: 0, maximum: 100 }

AuditJobExcludedFile:
  type: object
  required: [path, tier, reason]
  properties:
    path:   { type: string, minLength: 1 }
    tier:   { $ref: AuditSourceTier }
    reason: { $ref: AuditSourceExclusionReason }
    detail: { type: string }

AuditSourceFileClass:
  type: string
  enum: [source, free_context, not_auditable]

AuditSourceTier:
  type: string
  enum: [checked, unchecked, disabled]

AuditSourceExclusionReason:
  type: string
  enum: [empty_file, unreadable, binary, metadata, minified, generated, lockfile, log,
         build-output, dependencies, tests, documentation, config, ci, secret-material,
         hidden, minified-likely, large]
```

Коды ответа: `200`, `400`, `401`, `408`, `409 staged_document_not_found`,
`503` (+`Retry-After`, распаковка временно перегружена).

Пример:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs/estimate \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -F tier=advanced \
  -F archive=@contracts.zip
```

### 5.4 Создание аудита

```
POST /api/v1/audit-jobs
```

Тело — §5.2. Сервер заново считает стоимость (цена из estimate не передаётся и
не фиксируется), **резервирует** сумму на балансе и ставит аудит в очередь.

Ответ `201`:

```yaml
AuditJobCreateResponse:
  type: object
  required: [job_id, state]
  properties:
    job_id: { type: string, format: uuid }
    state:  { $ref: AuditJobState }
```

Коды ответа:

| Код | Значение |
| --- | --- |
| `201` | Аудит создан, средства зарезервированы |
| `400` | Ошибка входных данных (коды в §5.2) |
| `401` | Нет/неверный ключ |
| `402` | `insufficient_funds` или `monthly_limit_exceeded` (схемы в §4.2) |
| `403` | Нет прав создавать аудиты в этом контексте, либо переданы admin-only поля (`agent_*`) |
| `408` | `upload_timeout` |
| `409` | `staged_document_not_found` |
| `429` | Rate limit, см. `Retry-After` |
| `503` | Зависимость недоступна / перегрузка распаковки / `runner_channel_unavailable`, см. `Retry-After` |

Пример — ZIP:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -F tier=lite \
  -F archive=@contracts.zip \
  -F document=@whitepaper.pdf
# → {"job_id":"7c1e…","state":"pending"}
```

Пример — отдельные файлы с ограничением scope и в контексте организации:

```bash
curl -sS https://savant.chat/api/v1/audit-jobs \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  -H "X-Savant-Context: org:$ORG_ID" \
  -F tier=pro \
  -F file=@src/Vault.sol \
  -F file=@src/Token.sol \
  -F scope=src/Vault.sol
```

**Идемпотентности нет.** Повтор запроса создаёт второй аудит и второе резервирование.
При сетевой ошибке после отправки сначала проверьте `GET /api/v1/audit-jobs`
(новый аудит будет первым в списке), а потом решайте, повторять ли.

### 5.5 Предзагрузка документов (опционально)

Для больших документов или повторного использования между estimate и create
документ можно загрузить отдельно и потом ссылаться на него по id.

```
POST /api/v1/audit-documents          (multipart: document, tier)
DELETE /api/v1/audit-documents/{id}
```

```yaml
AuditDocumentStageRequest:
  type: object
  required: [document, tier]
  properties:
    document: { type: string, format: binary }
    tier:     { $ref: AnalysisTier }

StagedAuditDocument:            # ответ 201
  type: object
  required: [id, name, size, sha256, tokens, cost, standard_cost, expires_at]
  properties:
    id:            { type: string, format: uuid }
    name:          { type: string }
    size:          { type: integer, format: int64, minimum: 1 }
    sha256:        { type: string, pattern: ^[0-9a-f]{64}$ }
    tokens:        { type: integer, minimum: 0 }
    cost:          { $ref: MoneyAmount }
    standard_cost: { $ref: MoneyAmount }
    expires_at:    { type: string, format: date-time }
```

- Документ живёт 24 часа, лимит — 2 GiB и 500 живых документов на пользователя.
- Затем передайте `-F staged_document_ids=<id>` в estimate / create.
- Документ одноразовый: после использования в аудите он «claimed», повтор → `409`.

---

## 6. Отслеживание статуса

### 6.1 Состояния аудита

```yaml
AuditJobState:
  type: string
  enum: [pending, delayed, processing_audit, completed, failed, cancelled]
```

| Состояние | Значение | Терминальное |
| --- | --- | --- |
| `pending` | В очереди | нет |
| `delayed` | Отложен сервером, ещё будет выполнен | нет |
| `processing_audit` | Выполняется | нет |
| `completed` | Готов, отчёт доступен | **да** |
| `failed` | Завершился ошибкой | **да** |
| `cancelled` | Отменён | **да** |

Длительность зависит от тарифа и объёма кода. Отмены аудита через API нет.

### 6.2 Один аудит

```
GET /api/v1/audit-jobs/{id}
```

Ответ `200` — `AuditJobDetail` (= `AuditJobSummary` + поля ниже). `404` — нет
такого аудита или он не виден в текущем контексте.

```yaml
AuditJobDetail:
  allOf:
    - $ref: AuditJobSummary
    - type: object
      required: [stage_events]
      properties:
        poc_files_available: { type: boolean }   # есть ли PoC-файлы (только для completed)
        stage_events:
          type: array
          items: { $ref: JobStageEvent }
        report: { $ref: Report }                 # присутствует, когда state = completed

AuditJobSummary:
  type: object
  required: [id, state, analysis_tier, source_name, estimated_cost, created_at, updated_at]
  properties:
    id:              { type: string, format: uuid }
    state:           { $ref: AuditJobState }
    analysis_tier:   { $ref: AnalysisTier }
    source_name:     { type: string, minLength: 1 }
    estimated_cost:  { $ref: MoneyAmount }
    finding_counts:  { $ref: FindingCounts }      # после завершения
    progress:        { type: integer, minimum: 0, maximum: 100 }  # только во время анализа
    agent_channel:   { type: string, enum: [stable, beta, alpha], nullable: true }
    agent_channel_degrade_reason:
      allOf: [{ $ref: AgentChannelDegradeReason }]
      nullable: true
    created_at:      { type: string, format: date-time }
    updated_at:      { type: string, format: date-time }

JobStageEvent:
  type: object
  required: [id, stage, status, progress, message, created_at]
  properties:
    id:         { type: string, format: uuid }
    stage:      { type: string }   # init | prepare | documents | triage | audit | finalize
    status:     { type: string, enum: [started, progress, finished, failed] }
    progress:   { type: integer, minimum: 0, maximum: 100 }
    message:    { type: string }
    created_at: { type: string, format: date-time }

FindingCounts:
  type: object
  required: [critical, high, medium, low, informational]
  properties:
    critical:      { type: integer, minimum: 0 }
    high:          { type: integer, minimum: 0 }
    medium:        { type: integer, minimum: 0 }
    low:           { type: integer, minimum: 0 }
    minor:         { type: integer, minimum: 0 }
    informational: { type: integer, minimum: 0 }
    theoretical:   { type: integer, minimum: 0 }

AgentChannelDegradeReason:
  type: string
  enum: [registry_unavailable, channel_unpublished]
```

`progress` в summary — последний процент стадии `audit`; для детального
прогресса читайте `stage_events`. Причину `failed` смотрите в последнем событии
со `status: failed` (`message`).

### 6.3 Список аудитов

```
GET /api/v1/audit-jobs?limit=50&cursor=<next_cursor>&status=<AuditJobState>
```

| Параметр | Тип | По умолчанию |
| --- | --- | --- |
| `limit` | integer 1–100 | 50 |
| `cursor` | string — `next_cursor` из предыдущей страницы | — |
| `status` | `AuditJobState` | все |

```yaml
AuditJobListResponse:
  type: object
  required: [jobs]
  properties:
    jobs:
      type: array
      items: { $ref: AuditJobSummary }
    next_cursor: { type: string }   # отсутствует на последней странице
```

### 6.4 Рекомендуемый опрос

- Интервал 30–60 секунд; при `429`/`503` уважайте `Retry-After`.
- Останавливайтесь на `completed`, `failed`, `cancelled`.
- Для пачки аудитов эффективнее один `GET /api/v1/audit-jobs?status=processing_audit`,
  чем N запросов по id.

---

## 7. Получение результата

### 7.1 Структурированный отчёт

```
GET /api/v1/audit-jobs/{id}/report
```

`200` — `Report`; `404` — аудит не завершён, отчёта нет или аудит не виден.
(Тот же объект приходит в поле `report` ответа `GET /audit-jobs/{id}`.)

```yaml
Report:
  type: object
  required: [schema_version, summary_markdown, findings, stats, generated_at]
  properties:
    schema_version:   { type: string }
    summary_markdown: { type: string }
    findings:
      type: array
      items: { $ref: ReportFinding }
    stats:            { $ref: ReportStats }
    generated_at:     { type: string, format: date-time }

ReportFinding:
  type: object
  required: [id, title, description_markdown, location]
  properties:
    id:                      { type: string }
    severity:                { $ref: FindingSeverity }
    verdict:                 { type: string, enum: [proved, partial, theoretical, unverified] }
    title:                   { type: string }
    description_markdown:    { type: string }
    code_snippet:            { type: array, items: { type: string } }
    recommendation_markdown: { type: string }
    location:                { $ref: ReportLocation }

FindingSeverity:
  type: string
  enum: [informational, minor, medium, high, critical, theoretical]

ReportLocation:
  type: object
  required: [file]
  properties:
    file:       { type: string }
    start_line: { type: integer, minimum: 1 }
    end_line:   { type: integer, minimum: 1 }

ReportStats:
  type: object
  required: [findings_count]
  properties:
    findings_count:          { type: integer, minimum: 0 }
    # Остальные — измеренные счётчики, отсутствуют, если неизвестны (cap 1 000 000):
    files_analysed:          { type: integer }
    areas_examined:          { type: integer }
    areas_skipped:           { type: integer }
    candidates_screened:     { type: integer }
    candidates_discarded:    { type: integer }
    verified_with_poc:       { type: integer }
    theoretical:             { type: integer }
    could_not_reproduce:     { type: integer }
    false_positives_removed: { type: integer }
```

`verdict`: `proved` — подтверждено PoC; `partial` — частично; `theoretical` —
теоретическая уязвимость; `unverified` — не проверялась.

### 7.2 Отчёт файлом

```
GET /api/v1/audit-jobs/{id}/report/download?format=md|json|pdf|zip
```

| `format` | Содержимое |
| --- | --- |
| `md` (по умолчанию) | Markdown-отчёт |
| `json` | JSON-отчёт |
| `pdf` | PDF |
| `zip` | Архив со всеми форматами отчёта |

Ответ `200` — бинарный поток (`application/octet-stream` или `application/zip`).
`404` — нет отчёта / не виден; `409` — этот производный формат не был сгенерирован
(например, PDF ещё не готов или не создавался).

```bash
curl -sS -o report.pdf \
  -H "Authorization: Bearer $SAVANT_API_KEY" \
  "https://savant.chat/api/v1/audit-jobs/$JOB_ID/report/download?format=pdf"
```

### 7.3 Исходники аудита

```
GET /api/v1/audit-jobs/{id}/source/download
```

`200` — исходный бандл, ровно то, что аудировалось. Удобно для повторного
аудита того же кода. `404` — аудит не виден или бандл уже не хранится.

---

## 8. Полный пример (bash)

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=https://savant.chat
AUTH="Authorization: Bearer $SAVANT_API_KEY"

# 1. Оценка
curl -fsS "$BASE/api/v1/audit-jobs/estimate" -H "$AUTH" \
  -F tier=lite -F archive=@contracts.zip | jq '{estimated_cost, files: [.files[] | {path, cost}]}'

# 2. Создание
JOB_ID=$(curl -fsS "$BASE/api/v1/audit-jobs" -H "$AUTH" \
  -F tier=lite -F archive=@contracts.zip | jq -r .job_id)
echo "job: $JOB_ID"

# 3. Ожидание
while :; do
  STATE=$(curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID" -H "$AUTH" | jq -r .state)
  echo "$(date +%T) $STATE"
  case "$STATE" in completed|failed|cancelled) break ;; esac
  sleep 60
done

# 4. Результат
if [ "$STATE" = completed ]; then
  curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID/report" -H "$AUTH" \
    | jq '.findings[] | {severity, verdict, title, file: .location.file}'
  curl -fsS -o "report-$JOB_ID.pdf" -H "$AUTH" \
    "$BASE/api/v1/audit-jobs/$JOB_ID/report/download?format=pdf"
else
  curl -fsS "$BASE/api/v1/audit-jobs/$JOB_ID" -H "$AUTH" \
    | jq '.stage_events | map(select(.status=="failed")) | last'
fi
```

## 9. Пример (Python)

```python
import time, requests

BASE = "https://savant.chat"
S = requests.Session()
S.headers["Authorization"] = f"Bearer {API_KEY}"

def check(r):
    if r.status_code >= 400:
        err = r.json().get("error", {})
        raise RuntimeError(f"{r.status_code} {err.get('code')}: {err.get('message')}")
    return r

with open("contracts.zip", "rb") as f:
    est = check(S.post(f"{BASE}/api/v1/audit-jobs/estimate",
                       data={"tier": "advanced"}, files={"archive": f})).json()
print("cost:", est["estimated_cost"])

with open("contracts.zip", "rb") as f:
    job = check(S.post(f"{BASE}/api/v1/audit-jobs",
                       data={"tier": "advanced"}, files={"archive": f})).json()
job_id = job["job_id"]

while True:
    r = S.get(f"{BASE}/api/v1/audit-jobs/{job_id}")
    if r.status_code in (429, 503):
        time.sleep(int(r.headers.get("Retry-After", "60"))); continue
    detail = check(r).json()
    if detail["state"] in ("completed", "failed", "cancelled"):
        break
    time.sleep(60)

if detail["state"] == "completed":
    for f in detail["report"]["findings"]:
        print(f.get("severity"), f.get("verdict"), f["title"], f["location"]["file"])
```

Несколько частей с одним именем в `requests`: `files=[("file", open("A.sol","rb")), ("file", open("B.sol","rb"))]`,
`data=[("tier","lite"), ("scope","src/A.sol"), ("scope","src/B.sol")]`.

---

## 10. Тестирование интеграции

Отдельного тестового режима для API-ключей сейчас нет: `agent_settings` с
`dry_run` доступен только администратору из браузерной сессии, по ключу → `403`.

Варианты:

1. `POST /audit-jobs/estimate` и `GET /audit-jobs/plan-rates` — бесплатно,
   проверяют аутентификацию, контекст, загрузку и разбор архива.
2. Настоящий аудит тарифа `lite` на минимальном контракте — самый дешёвый полный
   прогон create → poll → report.
3. Стенд `https://dev.savant.chat` — отдельный аккаунт и ключ; возможна
   конфигурация с холостым воркером (уточняйте у команды Savant).

---

## 11. Ограничения и известные особенности

- Нет вебхуков/уведомлений о завершении — только опрос.
- Нет отмены аудита через API.
- Нет идемпотентного ключа при создании — повтор создаёт второй аудит.
- GitHub и импорт по адресу контракта по ключу недоступны — загружайте архив
  (например, `git archive --format=zip HEAD > src.zip`).
- Ключ наследует все права владельца, включая админские: храните ключи
  администраторов особенно бережно.
