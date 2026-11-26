"""Assemble staging without Analytics and preserve the pinned Stage73 routing boundaries."""
from hashlib import sha256
from importlib.machinery import SourceFileLoader
from pathlib import Path
import json
import sys

sys.dont_write_bytecode = True
base, fixtures, output = map(Path, sys.argv[1:])
loader = SourceFileLoader("stage70", str(Path(__file__).with_name("strip-staging-ga.py")))
stage70 = loader.load_module()
raw_files = {p.relative_to(base).as_posix(): p.read_bytes() for p in base.rglob("*") if p.is_file()}
files, _, _ = stage70.strip_ga(raw_files)
baseline = json.loads((fixtures / "staging-routes.json").read_text())["routes"]
generated = json.loads(files["vercel.json"])["routes"]
assert len(baseline) == len(generated) == 24


def route_key(rule):
    dest = rule.get("dest", "")
    if "/assets/" in dest:
        return dest.rsplit("/", 1)[0], Path(dest).suffix
    return rule["src"], dest


by_key = {route_key(rule): rule for rule in generated}
assert len(by_key) == len(baseline)
routes = [by_key[route_key(rule)] for rule in baseline]
for old, new in zip(baseline, routes, strict=True):
    if old == new:
        continue
    assert set(old) == set(new)
    assert {field for field in old if old[field] != new[field]} <= {"src", "dest"}
    assert old["dest"].split("/")[-2] == new["dest"].split("/")[-2] == "assets"
assert routes[-1] == baseline[-1] and routes[-1]["status"] == 404
hashes = {name: sha256(value).hexdigest() for name, value in files.items()
          if name.endswith((".jpg", ".jpeg", ".png"))}
assert hashes == json.loads((fixtures / "staging-image-sha256.json").read_text())
files["vercel.json"] = (json.dumps({"routes": routes}, ensure_ascii=False, indent=2) + "\n").encode()
output.mkdir()
for name, blob in files.items():
    path = output / name
    path.parent.mkdir(exist_ok=True, parents=True)
    path.write_bytes(blob)
