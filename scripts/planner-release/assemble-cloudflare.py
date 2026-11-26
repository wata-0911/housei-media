"""Adapt the existing production route contract to Pages and Worker Static Assets."""
from pathlib import Path
import json
import re
import shutil
import sys

source, output = map(Path, sys.argv[1:])
parent_host = "hosei-tsukyo-media.com"
child_host = "planner.hosei-tsukyo-media.com"
gate = Path(__file__).with_name("cloudflare-gate.mjs").read_text()

def get_routes(root):
    return json.loads((root / "vercel.json").read_text())["routes"]

def write_json(path, content):
    path.write_text(json.dumps(content, indent=2) + "\n")

def write_worker(path, contract):
    path.write_text("const contract = " + json.dumps(contract, indent=2) + ";\n\n" + gate)

def verify_rule(route, host, expression, dest):
    assert route["has"] == [{"type": "host", "value": "^" + re.escape(host) + "$"}]
    assert route["caseSensitive"] and route["methods"] == ["GET", "HEAD"]
    assert route["src"] == expression and route["dest"] == dest

parent, child = source / "parent", source / "child"
parent_out, child_out = output / "parent", output / "child"
planner, parent_deny, filesystem, fallback = get_routes(parent)
verify_rule(planner, parent_host, "^/planner/?$", "/index.html")
assert parent_deny["status"] == 404 and filesystem == {"handle": "filesystem"}
assert fallback == {"src": "^/.*$", "dest": "/index.html"}
assert (parent / "ads.txt").is_file()
assert not (parent / "planner.html").exists()

shutil.copytree(parent, parent_out, ignore=shutil.ignore_patterns("vercel.json"))
# The static fallback must never deliver the parent Planner entry when the Function is absent.
(parent_out / "404.html").write_text("<!doctype html><meta charset=utf-8><title>Not found</title>Not found\n")
public_files = sorted(
    "/" + path.relative_to(parent).as_posix() for path in parent.rglob("*")
    if path.is_file() and path.relative_to(parent).as_posix() not in {"index.html", "vercel.json"}
)
assert all(re.fullmatch(r"/[A-Za-z0-9_./-]+", path) for path in public_files)
write_json(parent_out / "_routes.json", {"version": 1, "include": ["/*"], "exclude": public_files})
write_worker(parent_out / "_worker.js", {
    "kind": "parent", "origin": "https://" + parent_host, "planner": planner["headers"],
    "deny": parent_deny["headers"],
})

child_document, *asset_rules, child_deny = get_routes(child)
verify_rule(child_document, child_host, "^/child$", "/release-child/planner.html")
assert child_deny["src"] == "^/.*$" and child_deny["status"] == 404
child_routes = {"/child": child_document}
for rule in asset_rules:
    match = re.fullmatch(r"/release-child/(assets/[A-Za-z0-9_-]+\.(?:js|css))", rule["dest"])
    assert match, rule["dest"]
    path = "/_planner-child/" + match[1]
    verify_rule(rule, child_host, "^" + re.escape(path) + "$", rule["dest"])
    assert path not in child_routes
    child_routes[path] = rule

asset_dir = child_out / "public"
shutil.copytree(child / "release-child", asset_dir / "release-child")
assert {"/" + p.relative_to(asset_dir).as_posix() for p in asset_dir.rglob("*") if p.is_file()} == {
    rule["dest"] for rule in child_routes.values()
}
write_worker(child_out / "worker.mjs", {
    "kind": "child", "origin": "https://" + child_host, "deny": child_deny["headers"],
    "routes": {path: {"dest": rule["dest"], "headers": rule["headers"]}
               for path, rule in child_routes.items()},
})
write_json(child_out / "wrangler.json", {
    "name": "hosei-planner-child",
    "main": "worker.mjs",
    "compatibility_date": "2026-11-25",
    "workers_dev": False,
    "preview_urls": False,
    "assets": {
        "directory": "./public", "binding": "ASSETS", "run_worker_first": True,
        "html_handling": "none", "not_found_handling": "none",
    },
})
