#!/usr/bin/env python3
import json, sys, os, subprocess, time

try:
    d = json.load(sys.stdin)
except Exception:
    d = {}

def g(*path, default=None):
    cur = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return cur if cur is not None else default

def fg(r, gr, b): return f"\033[38;2;{r};{gr};{b}m"
R = "\033[0m"; B = "\033[1m"
ORANGE = fg(217, 119, 87)      # Claude orange
AMBER = fg(240, 160, 90)
SAND = fg(235, 215, 190)
DIM = fg(140, 115, 100)
RED = fg(224, 90, 70)
SEP = f" {DIM}│{R} "

def bar(pct, width=14):
    pct = max(0, min(100, pct))
    filled = round(pct / 100 * width)
    col = ORANGE if pct < 60 else AMBER if pct < 85 else RED
    return f"{col}{'█' * filled}{DIM}{'░' * (width - filled)}{R}"

def countdown(ts):
    if ts is None:
        return None
    try:
        if isinstance(ts, str):
            from datetime import datetime
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        t = int(float(ts) - time.time())
    except Exception:
        return None
    if t <= 0:
        return "0m"
    return f"{t//3600}h{t%3600//60:02d}m" if t >= 3600 else f"{t//60}m"

def tok(n):
    return f"{n/1_000_000:.1f}M" if n >= 1_000_000 else f"{n/1000:.0f}k" if n >= 1000 else str(n)

model = g("model", "display_name", default="Claude")
modelpart = f"{ORANGE}{B}✻ {model}{R}"

cwd = g("workspace", "current_dir", default=os.getcwd())
name = os.path.basename(cwd.rstrip("/")) or cwd
dirpart = f"{SAND}📁 {name}{R}"
try:
    br = subprocess.run(["git", "-C", cwd, "branch", "--show-current"], capture_output=True, text=True, timeout=1).stdout.strip()
    if br:
        dirty = subprocess.run(["git", "-C", cwd, "status", "--porcelain"], capture_output=True, text=True, timeout=1).stdout.strip()
        dirpart += f" {AMBER} {br}{'*' if dirty else ''}{R}"
except Exception:
    pass

rl = g("rate_limits", default={}) or {}
limits = {}
for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
    v = (rl.get(key) or {}).get("used_percentage")
    if v is not None:
        limits[key] = f"{SAND}{label}{R} {bar(v, 8)} {ORANGE}{v:.0f}%{R}"
        if key == "five_hour":
            left = countdown((rl.get(key) or {}).get("resets_at"))
            if left:
                limits[key] += f" {DIM}↻{R} {AMBER}{left}{R}"

cw = g("context_window", default={}) or {}
size = cw.get("context_window_size") or 200000
pct = cw.get("used_percentage")
cu = cw.get("current_usage") or {}
used = None
if cu:
    used = sum(cu.get(k, 0) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
if pct is None and used is not None:
    pct = used / size * 100
if pct is not None:
    used = used if used is not None else int(pct / 100 * size)
    ctxpart = f"{SAND}ctx{R} {bar(pct)} {ORANGE}{B}{pct:.0f}%{R} {DIM}{tok(used)}/{tok(size)}{R}"
else:
    ctxpart = f"{SAND}ctx{R} {bar(0)} {DIM}0%{R}"

timepart = None
ms = g("cost", "total_duration_ms")
if ms:
    t = int(ms / 1000)
    timepart = f"{SAND}⏱ {t//3600}h{t%3600//60:02d}m{R}" if t >= 3600 else f"{SAND}⏱ {t//60}m{t%60:02d}s{R}"

cost = g("cost", "total_cost_usd")
costpart = f"{AMBER}${cost:.2f}{R}" if cost is not None else None

parts = [modelpart, dirpart, limits.get("five_hour"), limits.get("seven_day"), ctxpart, timepart, costpart]
print(SEP.join(p for p in parts if p) + "\n\u2800")
