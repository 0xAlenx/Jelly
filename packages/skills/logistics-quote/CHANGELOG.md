# Changelog

## v1.5 - Output Template Stability Release

Official production package: 物流报价 Skill 1.5 正式版.

This release preserves the existing remote database quotation workflow, pricing logic, REST mode, fail-closed behavior, and business filters. It focuses on output-template stability for OpenClaw/WeCom.

Main changes:

- Added canonical `render_plan()`.
- Routed single cost plans, batch cost plans, final quote plans, and customer-facing final quote plans through `render_plan()`.
- Enforced strict cost-plan field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 参考时效 → 船期 → 重量/体积/件数`.
- Enforced strict final quote field order: `来源报价表 → 工作簿 → 渠道 → 运输方式 → 起运仓 → 税务类型 → 计费方式 → 成本单价 → 报价单价 → 数量 → 预估总价 → 参考时效 → 船期`.
- Added display sanitization for embedded newlines.
- Added `validate_rendered_plan_template()`.
- Updated OpenClaw usage docs: stdout is canonical and must not be rewritten, summarized, reordered, compressed, converted to tables, or field-omitted.
- Verified Europe multi-warehouse template output.
- Verified U.S. real quote template output using `LAX9 300kg`.
- Verified margin calculation template output.
- Verified missing-field output still follows strict template.
- Confirmed config safety: `query_mode = rest`, `remote_database_only = true`, `allow_excel_fallback = false`.

## v1.4 - Production Release

Official production working version: 物流报价 Skill 1.4 正式版.

- Stabilized quote output rendering with one canonical plan renderer for cost plans, batch plans, final quote plans, and customer-facing quote plans.
- Enforced strict plan field order: 来源报价表、工作簿、渠道、运输方式、起运仓、税务类型、计费方式、成本单价、参考时效、船期, followed by involved quantity fields.
- Enforced strict final quote field order with 成本单价、报价单价、数量、预估总价、参考时效、船期.
- Updated OpenClaw instructions: script stdout is canonical and must not be summarized, rewritten, compressed, converted to tables, or reordered.
- Fixed shared-weight multi-warehouse parsing for inputs such as `MHG9、DTM2、DTM1、BER8、RLG1，海运，包税，100KG以上`.
- Confirmed plain explicit transport terms such as `海运`, `铁路`, `空运`, and `卡航` trigger transport filtering.
- Strengthened `包税` filtering so rows whose source workbook/channel/order fields clearly indicate `自税` / `不包税` / `递延` are excluded even if the backend tax field is ambiguous.
- Kept `卡派` as delivery method, not `卡航`; `海卡` means `海运 + 卡派`.

## v1.4 - Remote-Only Batch Quotation Development

Production version for remote database quotation lookup plus batch quotation workflow. This version is remote-database-only.

v1.4 adds:
- Remote-database-only quotation behavior
- Removal of packaged local Excel quotation files
- No local Excel fallback
- Fail-closed behavior when the remote database/API is unavailable, times out, or returns invalid data
- Multi-warehouse batch quotation support
- Weight-accurate multi-warehouse querying: different-weight batches query each warehouse separately with its own actual weight
- Production default now uses per-warehouse remote requests for batch quotation; same-weight remote batch lookup remains opt-in only
- Per-warehouse batch output from the backend `按FBA仓报价` response field when same-weight batch mode is used
- Single-warehouse full-option listing
- Multi-warehouse best-cost / fastest-ETA summary output
- Preservation of concrete channel names
- No automatic over-filtering from casual wording such as `发慢船`
- Batch unified-margin calculation
- ETA-safe output: display `参考时效：未返回` when ETA is blank and only label fastest ETA when ETA is returned and comparable
- Ship schedule display from backend `船期`, with `船期：未返回` when blank
- Source workbook display: preserve `来源报价表` and show backend `工作表` using the label `工作簿`
- Europe/Germany multi-code parsing for shared-condition inquiries such as `MHG9、DTM2、DTM1 海运 包税 100KG以上`
- Strict transport filtering for explicit `海运` / `铁路` / `空运` / `卡航`; `卡派` is handled as delivery method, not transport
- Strict tax filtering for explicit `包税` and `自税`
- Preserved weight-condition display such as `100KG以上`
- Traceable internal channel display paths, for example `DTM2｜德国｜欧洲海运包税｜海运｜包税｜卡派｜100KG以上`
- Optional source-row trace fields for `仓库名`、`邮编`、`原始行号`、`rate_line_id`、`record_id` when returned by the backend
- Adapted to `docs/4.md` region-aware database rules
- U.S. channel display now prioritizes product/channel name + warehouse code
- Europe/UK channel display now prioritizes `下单渠道` + `服务国家`, with `子渠道` + `国家或分区` fallback
- Europe warehouse-code matching now checks `服务国家` / `国家或分区`
- Europe displayed `渠道` now appends the requested warehouse code when backend service-country text does not already contain it, improving order-operator traceability
- Generic Europe summaries such as `欧洲/英国成本表 · 海运` are blocked as final displayed channels when better fields exist
- `卡派` is treated as delivery method, not `卡航`; `海卡` is interpreted as `海运 + 卡派`

Remote database documentation:
- `docs/4.md` is the current v1.4 reference.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for this version.
- The backend supports `按FBA仓报价`, but the Skill must not use one top-level weight for warehouses with different actual weights.
- The backend recognizes sea-freight synonyms such as `慢船`, `慢线`, `普船`, `海卡`, `船运`, `散货`, `以星`, and `美森` when an explicit sea-freight filter is sent.

Local Excel quotation remains only in `logistics-quote1.0` for historical rollback/reference, not as production fallback.

## v1.1-dev - Remote REST Development

Production version for remote database quotation lookup.

Changes:
- Added `query_mode = rest`
- Added remote REST config for `http://43.156.235.189:8080`
- Added `remote_quote_client.py`
- Added `/检查报价接口`
- Added optional local Excel fallback config with `allow_excel_fallback`
- Preserved v1.0 two-stage workflow and state management
- Preserved WeCom-friendly vertical card output

## v1.0 - Stable Release

This is the first stable logistics quotation Skill version confirmed working in OpenClaw.

Core capabilities:
- Local OpenClaw Skill folder deployment
- Excel-based cost table search
- Stateful quotation task management
- Two-stage quotation flow
- Manual margin calculation
- WeCom-friendly vertical output
- No-match classification
- Chinese command workflow

## v1.4 Origin Warehouse Refinement

- Added explicit origin warehouse extraction for ??????????????????????? and common combined origins.
- Request payload sends `???` only when origin is explicitly mentioned by the user.
- Remote response mapping now prefers backend `???` over `???` / `origin` / `origin_warehouse`.
- Output no longer invents a Shenzhen origin when the backend did not return one.

## v1.4 Production Capabilities

???? Skill 1.4 ??? includes:

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

## v1.4 Production Promotion Notes

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

