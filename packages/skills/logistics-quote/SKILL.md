---
name: logistics-quote1.5
version: 1.5
chinese_name: 物流报价 Skill 1.5 正式版
description: Official production logistics quotation Skill for OpenClaw + WeCom. v1.5 is remote-database-only, has no local Excel fallback, and supports production quotation workflow.
---

# 物流报价 Skill 1.5 正式版

Production version of the logistics quotation Skill for OpenClaw + WeCom customer service quotation workflow.

v1.5 is remote-database-only. It uses the remote quotation database REST service and does not include local Excel quotation files or local Excel fallback.

v1.5 is an output-template stability release. It preserves the v1.4 quotation workflow, remote database query logic, pricing logic, and safety rules, while forcing all quote plan outputs through the canonical `render_plan()` renderer.

v1.5 template-stability changes:

- Added canonical `render_plan()`.
- Routed single cost plans, batch cost plans, final quote plans, and customer-facing final quote plans through `render_plan()`.
- Enforced strict cost-plan field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 参考时效 → 船期 → 重量/体积/件数`.
- Enforced strict final quote field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 报价单价 → 数量 → 预估总价 → 参考时效 → 船期`.
- Added display sanitization for embedded newlines.
- Added `validate_rendered_plan_template()`.
- OpenClaw must return stdout as-is without rewriting, summarizing, reordering, compressing, table-converting, or omitting quote fields.

Folder name:

```text
logistics-quote1.5
```

## When OpenClaw Should Use This Skill

Use this Skill when a WeCom / 企业微信 message is about any of the following:

- logistics quotation / 物流报价
- freight rate / 运费价格 / 成本查询
- customer inquiry / 客户询价
- warehouse code / 仓库代码 / FBA warehouse / FBA仓库
- tax-included quotation / 包税报价
- non-tax-included quotation / 不包税报价
- air freight / 空运
- sea freight / 海运
- railway / 铁路
- trucking / card delivery / 卡航 / 卡派
- margin calculation / 毛利率计算 / 加点报价

The OpenClaw production Skill folder name is:

```text
logistics-quote1.5
```

## How OpenClaw Should Execute

The working directory must be this Skill folder.

### Mandatory Execution Contract

For every logistics quotation message, execute exactly one quotation entrypoint command and return its stdout verbatim:

```bash
./run_quote.sh "<complete user message>"
```

The quotation script manages all task state internally. OpenClaw/LLM must not inspect, parse, summarize, edit, or pipe `quote_sessions.json` into another command. Do not use `cat`, `head`, `tail`, `jq`, `python -c`, `python3 -c`, shell pipes, or ad-hoc scripts to read quotation state. For task summaries and history, pass the supported command to the same entrypoint, for example:

```bash
./run_quote.sh "/当前任务"
./run_quote.sh "/任务列表"
```

Do not call the remote REST endpoint directly with `curl`, `wget`, Python, or any other HTTP client. If `run_quote.sh` returns an error, return that output as-is. Do not construct an alternative terminal command.

On Windows, call:

```bat
run_quote.bat "<user message>"
```

If the OpenClaw environment is Linux/macOS and cannot run `.bat`, call:

```bash
python quote_query.py "<user message>"
```

`run_quote.sh` is also provided for Linux/macOS local runs:

```bash
./run_quote.sh "<user message>"
```

## State

All quotation states are stored internally by the quotation script in:

```text
quote_sessions.json
```

## v1.5 Remote Quote Layer

Default query mode:

```text
rest
```

REST service:

```text
http://43.156.235.189:8080
```

Quote endpoint:

```text
POST /v1/quote
```

Health command:

```text
/检查报价接口
```

If the REST API is unavailable, times out, returns invalid data, or has no usable active data version, fail closed. Do not invent prices and do not use stale local files. Return:

```text
当前报价数据库暂时无法查询，为避免报价错误，暂不生成报价，请稍后重试或联系负责人确认最新价格。
```

This Skill is stateful:

1. The first customer inquiry creates a quotation task and searches cost options.
2. Staff inputs a margin rate, then the Skill calculates the final quote.
3. Staff can modify information mid-process, such as changing warehouse code, weight, tax type, or shipping method.
4. Staff can use `/中断并新开` to force a new quotation task.

## Remote Service Notes

- This Skill uses REST query mode by default.
- Current remote database reference: `docs/4.md`.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for v1.5.
- The database is region-aware. U.S. quotation data is located mainly by product/channel name plus FBA warehouse code; Europe/UK quotation data is located by `下单渠道` + `服务国家`.
- U.S. displayed `渠道` should use product/channel name plus warehouse code. Europe/UK displayed `渠道` should use `下单渠道` + `服务国家`, with `子渠道` + `国家或分区` as fallback.
- Europe warehouse codes may be embedded inside `服务国家` / `国家或分区`, such as `德国-DTM2`; the Skill must match requested Europe warehouse codes against those fields.
- If a Europe displayed `渠道` built from `下单渠道/子渠道 + 服务国家/国家或分区` does not contain the requested warehouse code, append the warehouse code for order-operator traceability.
- Generic channel strings such as `欧洲/英国成本表 · 海运` must not be used as final `渠道` when better region-specific fields exist.
- The remote API supports multiple FBA warehouse codes in one `仓库/航线` value, such as `RDU2 FTW1 SMF3 AVP1 MDW2`.
- The response field `按FBA仓报价` is supported and remains the per-warehouse source of truth when the Skill intentionally uses one same-weight remote batch request. Do not use the top-level merged `方案列表` for per-warehouse display when `按FBA仓报价` is present.
- If a multi-warehouse inquiry has different weights per warehouse, accuracy takes priority over reducing API calls: query each warehouse separately with its own actual weight.
- Reference ETA may be blank. Display `参考时效：未返回`, never invent ETA, and only label `时效最快` when ETA is returned and comparable.
- Returned options may include `来源报价表`, `工作表`, and `船期`; display `工作表` as `工作簿`, and display missing ship schedule as `船期：未返回`.
- The backend recognizes sea-freight synonyms such as `慢船`, `慢线`, `普船`, `海卡`, `船运`, `散货`, `以星`, and `美森` only when the Skill intentionally sends an explicit sea-freight filter.
- Europe/Germany inquiries may contain multiple FBA warehouse codes separated by Chinese commas, English commas, `、`, spaces, or newlines. Extract every code and treat shared-condition multi-code requests as batch quotation tasks.
- Plain explicit transport terms such as `海运`, `铁路`, `空运`, and `卡航` are transport filters. `卡派` is a delivery method only and must not be treated as `卡航`.
- `海卡` means `海运 + 卡派`.
- When staff explicitly requests `包税`, filter out incompatible `自税`, `不包税`, and `递延` options returned by the backend. When staff requests `自税`, do not mix in tax-included options unless the backend marks them compatible.
- Preserve weight conditions such as `100KG以上`, `100KG+`, and `100KG起` in task state and output; send numeric weight to the backend when required.
- Internal quotation output must prioritize traceability over brevity. Keep `来源报价表` and `工作簿` as separate fields, and build displayed `渠道` as a traceable path containing warehouse code, country/region, workbook, transport, tax type, delivery method, and weight tier when available.
- If the backend returns `仓库名`, `邮编`, `原始行号`, `rate_line_id`, or `record_id`, show those optional trace fields after `渠道`.
- MCP registration information is included for future direct OpenClaw tool calling.
- See `MCP_REGISTRATION.md`.
- Do not confuse REST docs URL `http://43.156.235.189:8080/docs#/` with MCP endpoint `http://43.156.235.189:8090/mcp`.

## Primary Chinese Commands

Chinese commands are primary:

- `/中断并新开`
- `/当前任务`
- `/任务列表`
- `/切换任务 任务编号`
- `/结束任务`
- `/检查报价接口`

Internal testing/debug command:

- `/重置任务`

`/重置任务` is for local testing only and should not be promoted as a normal customer-service command.

## Two-Stage Quotation Workflow

### Stage 1: Cost Search

When staff sends a customer inquiry, the Skill should:

1. Create a task ID such as `Q-YYYYMMDD-001`.
2. Extract quotation fields from the message.
3. Search the remote REST quotation service only.
4. For a single warehouse, return all matched cost options after explicit filters.
5. For a multi-warehouse batch, production defaults to querying each warehouse separately using its own weight, even when weights are the same. Same-weight remote batch parsing from `按FBA仓报价` remains an opt-in capability only.
6. Mark the lowest-cost option as `性价比最高`.
7. Mark the fastest option as `时效最快` only when ETA data exists and is comparable.
8. Do not calculate final customer price.
9. Set status to `等待输入毛利率` when matched options exist.

### Stage 2: Final Quote Calculation

When staff provides a margin rate, for example `统一按15%`, the Skill should:

1. Pass the complete staff message to the quotation entrypoint. The script loads the active task internally.
2. Apply margin rules to selected cost options.
3. Calculate quote unit price and estimated total price when weight/volume is available.
4. Generate a customer-facing Chinese reply.

Formula:

```text
报价单价 = 成本单价 * (1 + 毛利率)
```

## Strict Rules

- Do not invent prices.
- Only return cost prices from the remote quotation database service.
- Local Excel quotation files are not included in v1.5.
- There is no local Excel fallback. If the database cannot be queried safely, refuse quotation.
- Do not calculate final quote before staff provides margin rate.
- If no matched cost option is found, classify the reason:
  - A. Missing warehouse/destination information
  - B. No data exists in the cost table
  - C. Filters are too strict
- Do not automatically include remote fee, surcharge, insurance, pickup fee, or special cargo fee.
- These items must only be listed as requiring manual confirmation.
- Output must use compact vertical cards, not wide Markdown tables, because WeCom display is narrow.
- Preserve concrete channel names exactly as returned by the database; do not merge them into broad labels like `海运方案` or `空运方案`.
- Casual wording such as `发慢船` must not automatically force a sea-freight filter.
- Apply transport filtering only when the user clearly restricts it, such as `只看空运`, `只看海运`, `只走慢船`, `不要空运`, or `只看铁路`.

## Batch Inquiry Rules

Recognize repeated warehouse and weight lines as one batch task, for example:

```text
发慢船，麻烦报下价
RDU2-----190KG
FTW1-----141KG
SMF3-----123KG
AVP1-----177KG
MDW2-----304KG
```

Store:

- `is_batch = true`
- `batch_items`
- `batch_results`

For batch tasks:

- If warehouse weights differ, query the remote API once per warehouse with that warehouse's actual weight.
- If all warehouse weights are exactly the same, the Skill may combine warehouse codes into `仓库/航线` and use `按FBA仓报价` for per-warehouse results.
- Save all returned options per warehouse in `batch_results`.
- Display only the single best-cost option and the single fastest-ETA option per warehouse when ETA exists.
- If ETA is missing for all options in a warehouse, display only the best-cost option and state that comparable ETA was not returned.
- If one option is both best-cost and fastest, display it once with both labels.
- `统一按15%` applies to every displayed representative option and generates final quote cards grouped by warehouse.

## Output Format

Normal output must use compact vertical cards.

The script output is canonical. OpenClaw/LLM must return stdout exactly as produced by the script:

- Do not summarize.
- Do not rewrite.
- Do not compress.
- Do not change field order.
- Do not omit fields.
- Do not convert quote plans into tables.
- Do not merge multiple plan fields into one line.
- Do not replace missing fields with blanks; the renderer uses `未返回`.

Every cost option plan must use this exact field order:

```text
方案 1｜性价比最高
来源报价表：
工作簿：
渠道：
运输方式：
起运仓：
税务类型：
计费方式：
成本单价：
参考时效：
船期：
重量：
体积：
件数：
```

`重量` / `体积` / `件数` lines are shown only when involved or returned. The required source and cost fields are always shown; missing values display `未返回`.

Every final quote plan must use this exact field order:

```text
方案 1｜性价比最高
来源报价表：
工作簿：
渠道：
运输方式：
起运仓：
税务类型：
计费方式：
成本单价：
报价单价：
重量：
体积：
件数：
预估总价：
参考时效：
船期：
```

Final quote plans must include both `成本单价` and `报价单价`. The quoted customer unit price keeps the existing `末位进一，保留1位小数` rule.

Customer-facing quote should show at most 5 options.

## Local Data Files

v1.5 does not package local Excel quotation files. The historical Excel-based version remains only in `logistics-quote1.0` for rollback/reference, not as a production fallback.

## Channel Display Normalization

- `??` must display the product/channel/warehouse-related name only.
- `????` must separately display the transport category, such as `??`, `??`, or `??`.
- Preserve the backend raw channel value in `raw`; display cleanup must not destroy traceability.
- If `????` starts with a worksheet prefix such as `??????????YM????? ? FTW1`, display `?????????????YM` and `???FTW1`.
- If `????` starts with clear category prefixes such as `???? ?`, `???? ?`, `???? ?`, `???? ?`, `?? ?`, `?? ?`, or `?? ?`, remove only that leading prefix for display.
- Do not over-clean valid product names, for example `?????YT? - ????-???|????-??YT` should remain unchanged.
- Casual transport words in an inquiry are context, not strict filters. Apply transport filters only for explicit restrictions such as `????`, `????`, `????`, `????`, `????`, or `????`.

## Origin Warehouse Handling

- Backend responses may include `???`; use it as the primary display source for `???`.
- Backend `???` is parsed from VIP table headers such as `??/??/??`, `??`, and `??/??`, and may also be supplemented by `origin_supplements` using `source_sheet + warehouse/FBA code`.
- Do not default origin to Shenzhen. If the user says only `ABE8 103.68KG`, send no `???` filter.
- Send `???` only when the user explicitly mentions origin warehouse text such as `???`, `??`, `??`, `??`, `??/??/??`, `??`, `??`, `??`, `??/??`, `??`, or `??`.
- Display priority: backend `???` ? backend `???` ? explicit user-provided origin ? `???`.

## Production Safety And Output Rules

- This Skill uses the remote quotation database as the only pricing source.
- It does not include local Excel quotation fallback.
- If the database is unavailable, times out, or returns invalid data, the Skill must refuse to quote.
- Do not invent prices.
- Do not use stale local files.
- OpenClaw must return the script stdout verbatim.
- OpenClaw must not summarize, rewrite, compress, reformat, or decorate quotation output.
- If output is long, still return the full script output.
- Do not use emoji or compressed summaries in quotation output.

