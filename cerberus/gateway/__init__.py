"""
Cerberus Gateway — messaging platform connectivity.

Harvested from hermes-agent gateway/ and cron/ (MIT license).
The seam where hermes called its own agent loop is replaced with
a call to Cerberus's existing POST /api/chat REST endpoint.

Package layout:
    gateway/
        config.py          — configuration dataclasses + env loading
        cerberus_client.py — HTTP client for Cerberus chat API
        scheduler.py       — cron scheduler with platform delivery
        platforms/
            base.py        — abstract adapter interface
            telegram.py    — Telegram Bot API adapter
        main.py            — entry point
"""
