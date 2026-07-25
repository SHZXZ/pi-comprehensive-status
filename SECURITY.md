# Security

This repository contains only the Pi extension source and documentation. It must not contain:

- `~/.pi/agent/auth.json`
- API keys, Telegram tokens, cookies, or `.env` files
- Pi session JSONL files
- provider credentials or private MCP credentials
- machine backups and generated logs

Pi extensions execute with the same operating-system access as Pi. Review changes before installing a new commit or moving the pinned Git ref.

For a private GitHub installation, prefer SSH authentication and a pinned release tag:

```bash
pi install git:git@github.com:SHZXZ/pi-comprehensive-status.git@v1.0.1
```
