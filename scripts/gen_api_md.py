"""Render docs/API.md from the app's live OpenAPI document."""
import json, pathlib, sys, collections

src = pathlib.Path(sys.argv[1])
dest = pathlib.Path(sys.argv[2])
doc = json.loads(src.read_text(encoding="utf-8"))

METHODS = ("get", "post", "patch", "put", "delete")
groups: dict[str, list] = collections.defaultdict(list)

for path, item in doc["paths"].items():
    for method in METHODS:
        op = item.get(method)
        if not op:
            continue
        tag = (op.get("tags") or ["other"])[0]
        groups[tag].append((method.upper(), path, op))

total = sum(len(v) for v in groups.values())

out = [
    "# Kan Ban API reference",
    "",
    f"Generated from `GET /api/openapi.json` of Kan Ban {doc['info']['version']}. "
    "Do not edit by hand: regenerate it with the command in the Regenerating section below.",
    "",
    f"**{total} operations across {len(doc['paths'])} paths.** Every endpoint lives under `/api`.",
    "",
    "## Conventions",
    "",
    "- Request and response bodies are JSON with `snake_case` field names that match the database columns.",
    "- Timestamps are ISO-8601 UTC strings ending in `Z`.",
    "- Authentication is a `kb_session` cookie. Cookie-authenticated requests that are not `GET` must also send",
    "  the header `X-Requested-With: fetch`, or the request is rejected.",
    "- Errors return an envelope: `{\"error\": {\"code\", \"message\", \"details\", \"request_id\"}}`.",
    "- Mutations answer `{\"item\": ..., \"board_version\": N}`; moves answer a `MoveResult` that also carries the",
    "  positions of any rows the server had to renumber.",
    "",
    "## Endpoints",
    "",
]

for tag in sorted(groups):
    out.append(f"### {tag}")
    out.append("")
    out.append("| Method | Path | Purpose |")
    out.append("|---|---|---|")
    for method, path, op in sorted(groups[tag], key=lambda r: (r[1], r[0])):
        summary = (op.get("summary") or "").strip()
        if not summary:
            summary = (op.get("description") or "").strip().split("\n")[0]
        summary = summary.replace("|", "\|") or "-"
        out.append(f"| `{method}` | `{path}` | {summary} |")
    out.append("")

out += [
    "## Regenerating",
    "",
    "```bash",
    "# from the repo root, with the app running on port 8020",
    "KANBAN_PORT=8020 KANBAN_DATA_DIR=./.tmp-docs .venv/Scripts/python -m kanban &",
    "curl -s http://127.0.0.1:8020/api/openapi.json -o openapi.json",
    "python scripts/gen_api_md.py openapi.json docs/API.md",
    "```",
    "",
    "Interactive documentation is also served by the running app at `/api/docs`.",
    "",
]

dest.write_text("\n".join(out), encoding="utf-8")
print(f"wrote {dest}: {len(out)} lines, {total} operations, {len(groups)} groups")
