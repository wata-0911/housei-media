"""Project inputs for the A production parent and its separate Planner child."""
from pathlib import Path
from hashlib import sha256
from base64 import b64encode
from mimetypes import guess_type
import json
import re
import shutil
import sys

parent, child, output = map(Path, sys.argv[1:])
parent_host = "hosei-tsukyo-media.com"
child_host = "planner.hosei-tsukyo-media.com"
parent_origin = "https://" + parent_host
child_origin = "https://" + child_host
common = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
denied = {**common, "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"}
html = {"Content-Type": "text/html; charset=utf-8", **common}

def route(host, src, dest, headers):
    return {
        "src": src, "has": [{"type": "host", "value": "^" + re.escape(host) + "$"}],
        "methods": ["GET", "HEAD"], "caseSensitive": True, "dest": dest, "headers": headers,
    }

parent_html = (parent / "index.html").read_text()
inline = re.findall(r"<script>([\s\S]+?)</script>", parent_html)
assert len(inline) == 1 and "gtag('config', 'G-46M2R4RSX5')" in inline[0]
assert "https://www.googletagmanager.com/gtag/js?id=G-46M2R4RSX5" in parent_html
ga_hash = b64encode(sha256(inline[0].encode()).digest()).decode()
parent_policy = "; ".join([
    "default-src 'none'",
    f"script-src 'self' 'sha256-{ga_hash}' https://www.googletagmanager.com https://platform.twitter.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://www.transparenttextures.com https://pbs.twimg.com https://*.google-analytics.com https://*.googletagmanager.com",
    "connect-src 'self' https://script.google.com https://script.googleusercontent.com https://syndication.twitter.com https://platform.twitter.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "frame-src " + child_origin, "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
])
parent_routes = [
    route(parent_host, "^/planner/?$", "/index.html", {**html, "Referrer-Policy": "strict-origin", "Content-Security-Policy": parent_policy}),
    {"src": r"^/(?:planner/?|planner\.html|child(?:/.*)?|_planner-child(?:/.*)?)$", "status": 404, "headers": denied},
    {"handle": "filesystem"},
    {"src": "^/.*$", "dest": "/index.html"},
]
assert "planner.html" not in {p.name for p in parent.iterdir()}
parent_out = output / "parent"
shutil.copytree(parent, parent_out)
(parent_out / "vercel.json").write_text(json.dumps({"routes": parent_routes}, indent=2) + "\n")

child_policy = "; ".join([
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'none'",
    "frame-src 'none'", "frame-ancestors " + parent_origin, "base-uri 'none'", "form-action 'none'",
])
child_headers = {**html, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
                 "Content-Security-Policy": child_policy}
child_out = output / "child"
child_out.mkdir()
child_routes = [route(child_host, "^/child$", "/release-child/planner.html", child_headers)]
for path in sorted(child.rglob("*")):
    if path.is_dir():
        continue
    relative = path.relative_to(child).as_posix()
    assert relative == "planner.html" or re.fullmatch(r"assets/[A-Za-z0-9_-]+\.(?:js|css)", relative), relative
    raw = path.read_bytes()
    assert not re.search(rb"googletagmanager|G-46M2R4RSX5|platform\.twitter\.com/widgets\.js", raw), relative
    dest = child_out / "release-child" / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    if relative != "planner.html":
        asset_headers = {**common, "Content-Type": guess_type(relative)[0] or "application/octet-stream",
                         "Cross-Origin-Resource-Policy": "same-origin"}
        child_routes.append(route(child_host, "^" + re.escape("/_planner-child/" + relative) + "$",
                                  "/release-child/" + relative, asset_headers))
child_routes.append({"src": "^/.*$", "status": 404, "headers": denied})
(child_out / "vercel.json").write_text(json.dumps({"routes": child_routes}, indent=2) + "\n")
print(json.dumps({"parent_host": parent_host, "child_host": child_host, "parent_routes": len(parent_routes),
                  "child_routes": len(child_routes), "parent_ga_retained": True}))
