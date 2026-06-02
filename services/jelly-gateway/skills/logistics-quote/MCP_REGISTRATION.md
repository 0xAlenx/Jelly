# MCP Registration for logistics-quote1.5

## Important endpoints

REST API docs:
http://43.156.235.189:8080/docs#/

REST API base:
http://43.156.235.189:8080

REST health:
http://43.156.235.189:8080/health

REST quote:
POST http://43.156.235.189:8080/v1/quote

MCP endpoint:
http://43.156.235.189:8090/mcp

MCP health:
http://43.156.235.189:8090/health

## Register MCP in OpenClaw

Use:

```bash
openclaw mcp set ouchang-quote-remote '{"url":"http://43.156.235.189:8090/mcp","transport":"streamable-http"}'
```

Then check:

```bash
openclaw mcp list
openclaw mcp show ouchang-quote-remote --json
```

## Exposed MCP tools

- `quote_health`
- `quote_freight`
- `sync_quotes`

Explain:

- `quote_health` checks service health.
- `quote_freight` performs freight quotation.
- `sync_quotes` syncs xlsx to SQLite, but HTTP mode rejects it by default unless the server enables `QUOTE_MCP_ALLOW_SYNC=1`.

## Recommended v1.5 usage

For `logistics-quote1.5`, REST mode is currently the default because it is easier to test and already works.

MCP registration is included for future direct OpenClaw tool calling.

## v1.5 Remote Database Notes

- Current remote database reference: `docs/4.md`.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for this version.
- The REST/MCP backend supports multiple FBA warehouse codes in `仓库/航线`.
- `按FBA仓报价` is supported as the source of truth for per-warehouse output when same-weight remote batch mode is used.
- For different-weight warehouse batches, the Skill should query each warehouse separately with its own actual weight to preserve pricing tier accuracy.
- The backend recognizes sea-freight synonyms such as `慢船`, `慢线`, `普船`, `海卡`, `船运`, `散货`, `以星`, and `美森` when an explicit sea-freight filter is sent.
- Reference ETA may be blank; the Skill must display `参考时效：未返回` and must not invent ETA.
- Returned options may include `来源报价表`, `工作表`, and `船期`; display `工作表` as `工作簿`, and display missing schedules as `船期：未返回`.
- v1.5 is remote-database-only and has no local Excel fallback.

## Important warning

Do not confuse:

- REST/OpenAPI docs: http://43.156.235.189:8080/docs#/
- MCP endpoint: http://43.156.235.189:8090/mcp
