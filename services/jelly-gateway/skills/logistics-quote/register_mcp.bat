@echo off
setlocal

echo Registering ouchang-quote-remote MCP...
openclaw mcp set ouchang-quote-remote "{""url"":""http://43.156.235.189:8090/mcp"",""transport"":""streamable-http""}"

echo Listing registered MCP servers...
openclaw mcp list

echo Showing ouchang-quote-remote detail...
openclaw mcp show ouchang-quote-remote --json

echo MCP registration completed.

endlocal
