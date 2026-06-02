# 物流报价 Skill 1.5 正式版

Version: 1.5
Folder Name: logistics-quote1.5
Status: Production / Official Working Version

Release Summary: Output-template stability release.

v1.5 preserves the v1.4 remote database quotation workflow, pricing logic, filtering behavior, and fail-closed safety rules. The release focuses on stabilizing actual quote stdout so OpenClaw/WeCom receives complete, predictable vertical-card quote plans.

## v1.5 Output Template Stability

- Added canonical `render_plan()`.
- Routed single cost plans, batch cost plans, final quote plans, and customer-facing final quote plans through `render_plan()`.
- Enforced strict cost-plan field order:
  `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 参考时效 → 船期 → 重量/体积/件数`
- Enforced strict final quote field order:
  `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 报价单价 → 数量 → 预估总价 → 参考时效 → 船期`
- Added display sanitization for embedded newlines.
- Added `validate_rendered_plan_template()`.
- Updated OpenClaw usage docs: stdout is canonical and must not be rewritten, summarized, reordered, compressed, converted to tables, or field-omitted.
- Verified Europe multi-warehouse template output.
- Verified U.S. real quote template output using `LAX9 300kg`.
- Verified margin calculation template output.
- Verified missing-field output still follows strict template.
- Confirmed config safety: `query_mode = rest`, `remote_database_only = true`, `allow_excel_fallback = false`.

# 物流报价 Skill 1.5 正式版

Version: 1.5
Folder Name: logistics-quote1.5
Status: Development
Confirmed Date: 2026-05-10

## Version Goal

v1.5 is remote-database-only and adds major customer-service quotation capabilities for real inquiry handling.

Local Excel quotation files are not included. There is no local Excel fallback.

Stable v1.0 workflow remains unchanged:

1. Customer inquiry → cost option search
2. Staff margin input → final quote calculation
3. Stateful task storage in `quote_sessions.json`
4. Chinese command workflow
5. WeCom-friendly vertical card output

## v1.5 Additions

- Multi-warehouse batch quotation support
- Weight-accurate multi-warehouse querying: different-weight batches query each warehouse separately with its own actual weight
- Same-weight remote batch lookup may use multiple FBA codes in `仓库/航线`
- Per-warehouse batch parsing from remote response field `按FBA仓报价` when same-weight batch mode is used
- Single-warehouse full-option listing
- Multi-warehouse best-cost / fastest-ETA summary output
- Preservation of concrete channel names
- No automatic over-filtering from casual wording such as `发慢船`
- Batch unified-margin calculation
- ETA-safe output: display `参考时效：未返回` when ETA is blank and only label fastest ETA when ETA is comparable
- Ship-schedule output: display backend `船期` when returned, otherwise `船期：未返回`
- Source preservation: display `来源报价表` and backend `工作表` as `工作簿`

## Confirmed Working Features

- OpenClaw local Skill installation works
- WeCom message can trigger the Skill
- Calls remote REST quotation service only
- Fails closed when the remote database/API is unavailable, times out, returns invalid data, or has no usable active data version
- Creates quotation task IDs
- Saves task state in `quote_sessions.json`
- Supports two-stage quotation workflow:
  1. Customer inquiry → cost option search
  2. Staff margin input → final quote calculation
- Supports single-warehouse full matched option output
- Supports multi-warehouse batch parsing and quotation
- Supports batch final quote grouped by warehouse
- Supports Chinese commands:
  - /中断并新开
  - /当前任务
  - /任务列表
  - /切换任务
  - /结束任务
- Supports missing destination/warehouse handling
- Supports no-data handling
- Supports strict-filter no-result handling
- Uses compact vertical card output for WeCom
- Uses a canonical quote-plan renderer so every plan follows the same field order and line breaks
- OpenClaw/LLM must return script stdout verbatim and must not rewrite, summarize, compress, reorder, table-format, or omit quote fields
- Does not invent prices
- Does not use stale local Excel files
- Does not include remote fee, surcharge, insurance, pickup fee, or special cargo fee automatically
- Supports `/检查报价接口`

## Remote-Only Rule

- v1.5 does not package local Excel quotation files.
- `allow_excel_fallback` must remain `false`.
- If the remote quotation database cannot be queried safely, the Skill must refuse quotation.
- The Excel-based local version remains only in `logistics-quote1.0` for historical rollback/reference, not as production fallback.

## Current Remote Database Reference

- `docs/4.md` is the current v1.5 remote database/API reference.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for this version.
- The remote database now separates U.S. and Europe/UK quotation logic.
- U.S. display uses product/channel name plus warehouse code.
- Europe/UK display uses `下单渠道` + `服务国家`, falling back to `子渠道` + `国家或分区`.
- Europe warehouse code matching checks `service_country` / `国家或分区` in addition to direct warehouse code fields.
- If the Europe displayed channel does not contain the requested warehouse code, the Skill appends the warehouse code for order-operator traceability.
- Generic Europe summaries such as `欧洲/英国成本表 · 海运` are not used as final `渠道` when region-specific fields exist.
- `卡派` is delivery method, not `卡航`; `海卡` means `海运 + 卡派`.
- Shared-weight multi-warehouse inputs such as `MHG9、DTM2、DTM1、BER8、RLG1，海运，包税，100KG以上` are parsed into one batch item per warehouse.
- Plain explicit transport terms such as `海运`, `铁路`, `空运`, and `卡航` are recognized as transport filters.
- `包税` results exclude rows whose source workbook/channel/order fields clearly indicate `自税`, `不包税`, or `递延`.
- `按FBA仓报价` is supported by the backend and remains an opt-in same-weight remote batch capability.
- Production defaults to per-warehouse remote requests for batch quotation, so each warehouse is priced independently and avoids first-warehouse/merged-result ambiguity.
- The backend can recognize sea-freight synonyms such as `慢船`, `慢线`, `普船`, `海卡`, `船运`, `散货`, `以星`, and `美森` when an explicit sea-freight filter is sent.
- Reference ETA may be blank; the Skill must not invent ETA.
- Returned options may include `来源报价表`, `工作表`, and `船期`; the Skill preserves them and displays `工作表` as `工作簿`.
- Europe/Germany shared-condition batch inquiries can include multiple FBA warehouse codes separated by punctuation, spaces, or newlines; all codes must be extracted.
- Plain explicit transport terms such as `海运`, `铁路`, `空运`, and `卡航` are filters; `卡派` remains a delivery method and is not converted to `卡航`.
- Explicit `包税` filters out incompatible `自税`, `不包税`, and `递延` options; explicit `自税` does not mix in tax-included options.
- Weight conditions such as `100KG以上`, `100KG+`, and `100KG起` are preserved in state/output while numeric weight is still sent to the remote API.
- Internal `渠道` display is now a traceable warehouse/product path while `来源报价表` and `工作簿` remain separate source fields.
- Optional trace fields such as `仓库名`, `邮编`, `原始行号`, `rate_line_id`, and `record_id` are preserved when returned by the backend.

## Development Test Cases

1. LAX9，300kg，深圳仓，包税，有什么方案？
Expected:
- Returns all matched cost options for the single warehouse
- Shows vertical cards
- Marks best-cost and fastest-ETA options
- Waits for margin rate

2. 发慢船，麻烦报下价 / RDU2-----190KG / FTW1-----141KG / SMF3-----123KG / AVP1-----177KG / MDW2-----304KG
Expected:
- Creates one batch quotation task
- Extracts five warehouse/weight items
- Uses five separate remote quote requests because the warehouse weights differ
- Each request uses the warehouse's own actual weight
- Shows best-cost and fastest-ETA representative options per warehouse

3. 统一按15%
Expected:
- Calculates final quote for all displayed batch representative options
- Generates customer-facing quotation text grouped by warehouse

4. LAX9，300kg，只看空运
Expected:
- Applies explicit air-freight filter

5. 发慢船，RDU2 190KG
Expected:
- Does not automatically discard non-sea-freight options because of casual wording

## Rollback Note

If v1.5 breaks, restore previous development checkpoint:
logistics-quote1.1-dev

For stable production rollback, restore:
logistics-quote1.0

## v1.5 Origin Warehouse Update

- Backend now returns `???` from VIP table header parsing and/or `origin_supplements`.
- Skill no longer defaults origin warehouse to `??` when the user does not mention origin.
- Explicit user origin is passed as `???` to the REST API.
- Output displays backend returned `???` first and shows `???` when no origin is returned or explicitly provided.

## v1.5 Production Capabilities

???? Skill 1.5 ??? includes:

- Remote-database-only quotation mode.
- No local Excel fallback.
- Fail-closed behavior when the database query fails, times out, or returns invalid data.
- Single-warehouse full option listing.
- Multi-warehouse batch quotation.
- Per-warehouse remote query when batch weights differ.
- Best-cost and fastest-ETA summary for batch quotes.
- Exact product/channel names preserved, with display cleanup that removes leading prefixes such as `???? ?`.
- Source quote file displayed as `?????`.
- Worksheet displayed as `???`.
- Ship schedule displayed as `??`.
- Backend returned `???` support.
- No default Shenzhen origin unless the user explicitly provides it.
- Mobile WeCom-friendly vertical output.
- Customer final quote unit price uses ceiling rounding to 1 decimal place, for example `6.67 ? 6.7` and `65.53 ? 65.6`.
- Estimated total uses the rounded customer quoted unit price.
- OpenClaw must return script stdout verbatim and must not rewrite, summarize, compress, or decorate quotation output.

## v1.5 Production Promotion Notes

Release status: production-ready.

- U.S. quotation logic uses product/channel name + warehouse code.
- Europe/UK quotation logic uses ????/??? + ????/?????.
- Europe warehouse code may appear inside ???? / ????? and is matched there.
- Fixed shared-weight multi-warehouse parsing, such as `MHG9?DTM2?DTM1?BER8?RLG1?100KG??`.
- Fixed plain `??` recognition as an explicit transport filter.
- Fixed `??` strict filtering to exclude `??` source rows.
- Fixed `??` vs `??` distinction: `??` is delivery method; `??` is transport.
- Multi-warehouse quote outputs best-cost and fastest-ETA per warehouse when different.
- Current backend reference is `docs/4.md`.
- No local Excel fallback.
- Database failure must fail closed.

