# OpenClaw Local Skill Deployment

Final Skill folder name:

```text
logistics-quote
```

## Step 1: Copy Skill Folder

Copy the full `logistics-quote` folder to:

```text
~/.openclaw/workspace/skills/logistics-quote
```

Expected structure:

```text
logistics-quote/
├── SKILL.md
├── quote_query.py
├── quote_config.json
├── quote_sessions.json
├── examples.md
├── test_cases.json
├── README.md
├── requirements.txt
├── setup_env.bat
├── run_quote.bat
├── reset_sessions.bat
├── run_quote.sh
```

## Step 2: Install Dependencies

Enter the Skill folder first. The working directory must be the Skill folder.

For every quotation interaction, call only the provided entrypoint script with the complete user message. The script owns `quote_sessions.json` and loads task state internally. Do not inspect, parse, modify, or pipe `quote_sessions.json` into `cat`, `jq`, `python -c`, `python3 -c`, or an ad-hoc shell command.

Windows:

```bat
setup_env.bat
```

Linux/macOS:

```bash
python3 -m pip install -r requirements.txt
chmod +x run_quote.sh
```

## Step 3: Test Locally

Windows:

```bat
run_quote.bat "LAX9，300kg，深圳仓，包税，有什么方案？"
run_quote.bat "统一按15%"
run_quote.bat "/当前任务"
```

Linux/macOS:

```bash
./run_quote.sh "LAX9，300kg，深圳仓，包税，有什么方案？"
./run_quote.sh "统一按15%"
./run_quote.sh "/当前任务"
```

If `.bat` cannot run but Python is available:

```bash
python quote_query.py "LAX9，300kg，深圳仓，包税，有什么方案？"
```

## Step 4: WeCom Test

In WeCom / 企业微信, send:

```text
LAX9，300kg，深圳仓，包税，有什么方案？
```

Expected behavior:

OpenClaw should call this Skill, execute the query, and return matched cost options as compact vertical cards.

Important output rule:

- The script stdout is canonical.
- Return the script output exactly as-is.
- Do not summarize, rewrite, compress, or decorate quotation output.
- Do not change field order.
- Do not omit fields from quote plans.
- Do not convert quote plans into Markdown tables.
- Do not merge multiple plan fields onto one line.
- Missing field values must remain `未返回`.
- If output is long, still return the full script output.

Then send:

```text
统一按15%
```

Expected behavior:

OpenClaw should calculate the final quote from the active task and return customer-facing quotation text.

## Troubleshooting

If the script cannot run:

- Check Python environment.
- On Windows, run `setup_env.bat`.
- On Linux/macOS, run `python3 -m pip install -r requirements.txt`.
- Ensure the working directory is the Skill folder.

If no quotation result is returned:

- Check whether warehouse code or destination information is missing.
- Check whether filters are too strict, such as shipping method or tax type.
- Use `/当前任务` to inspect the current task.

If the remote quotation service cannot be queried:

- Run `/检查报价接口`.
- Confirm OpenClaw can reach `http://43.156.235.189:8080/health`.
- Do not use stale local Excel files. v1.5 is remote-database-only and must fail closed.

If you need a clean local test:

```bat
reset_sessions.bat
```

or:

```text
/重置任务
```

## v1.5 OpenClaw Deployment Notes

Current remote database documentation:

- `docs/4.md` is the current v1.5 API/database reference.
- `docs/1.md`, `docs/2.md`, and `docs/3.md` are historical/obsolete for this version.
- The remote API supports multiple FBA warehouse codes in one `仓库/航线` field.
- `按FBA仓报价` is supported for per-warehouse results when same-weight remote batch mode is used.
- If warehouse weights differ, the Skill must query each warehouse separately with its own actual weight.
- Reference ETA may be blank; the Skill displays `参考时效：未返回` and does not invent ETA.
- Returned options may include `来源报价表`, `工作表`, and `船期`; the Skill displays `工作表` as `工作簿` and missing schedules as `船期：未返回`.
- v1.5 remains remote-database-only with no local Excel fallback.

### Step A: Install Skill Folder

Copy the full production Skill folder to:

```text
~/.openclaw/workspace/skills/logistics-quote1.5/
```

The working directory for execution must be the Skill folder.

### Step B: Test REST Mode

In OpenClaw or local CLI, run:

```text
/检查报价接口
```

Expected result: the REST quotation service health check returns available.

### Step C: Optional MCP Registration

MCP registration is optional for v1.5. REST mode remains the default quotation path.

Linux/macOS:

```bash
bash register_mcp.sh
```

Manual registration:

```bash
openclaw mcp set ouchang-quote-remote '{"url":"http://43.156.235.189:8090/mcp","transport":"streamable-http"}'
```

Windows:

```bat
register_mcp.bat
```

### Step D: Verify MCP Registration

```bash
openclaw mcp list
openclaw mcp show ouchang-quote-remote --json
```

Important endpoint note:

- REST/OpenAPI docs: `http://43.156.235.189:8080/docs#/`
- REST API base: `http://43.156.235.189:8080`
- MCP endpoint: `http://43.156.235.189:8090/mcp`
- MCP health: `http://43.156.235.189:8090/health`
