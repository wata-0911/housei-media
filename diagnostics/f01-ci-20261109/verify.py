import subprocess,json,pathlib,hashlib
C='91126d7e7fe4d48430035beae02557e5477d5d71'
T='937006e2c9d859b542fd9f7242604c1d5219319d'
g=lambda *a:subprocess.check_output(['git',*a],text=True).strip()
assert g('rev-parse',C+'^{tree}')==T
assert g('show','-s','--format=%P',C)=='5fdefd1eb5f78d64f1f5c1a8ea9afd2d13829142 752d230009ffa74ba895ef1c3f2e5b0d0a3c2b9b'
changes=g('diff','--name-status',C,'HEAD').splitlines()
assert changes and all(x.startswith('A\t') and (x[2:]=='.github/workflows/f01-tree937006e2-diagnostic.yml' or x[2:].startswith('diagnostics/f01-ci-20261109/')) for x in changes),changes
assert not g('status','--porcelain','--untracked-files=no')
print(json.dumps({'candidate':C,'tree':T,'diagnostic':g('rev-parse','HEAD'),'diagnosticTree':g('rev-parse','HEAD^{tree}'),'added':changes,'candidateBlobsUnchanged':True},indent=2))
