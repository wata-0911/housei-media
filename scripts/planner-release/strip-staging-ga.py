"""Remove the fixed GA bootstrap from staging only."""
import base64
import copy
import hashlib
import json
import re
from pathlib import Path

PARENT_HTML = 'stage69-parent-content/index.html'
PARENT_HOST = r'^staging\.hosei-tsukyo-media\.com$'
CSP = 'Content-Security-Policy'
LOADER_SOURCE = 'https://www.googletagmanager.com/gtag/js'
LOADER = f'  <script async src="{LOADER_SOURCE}?id=G-46M2R4RSX5"></script>\n'
INLINE_BODY = """
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());

    gtag('config', 'G-46M2R4RSX5');
  """
INLINE = f'  <script>{INLINE_BODY}</script>\n'
GA_MARKERS = re.compile(
    r'G-46M2R4RSX5|\bgtag\b|\bdataLayer\b|google-analytics|'
    r'googletagmanager|analytics\.google\.com|stats\.g\.doubleclick|'
    r'analytics\.js|gtm\.js|gtag[/%]|\bpage_view\b|(?:[/]|%2f)(?:g/|j/|r/)?collect\b',
    re.IGNORECASE,
)


def require(result, message):
    if not result:
        raise ValueError(message)


def strip_ga(files):
    updated = files.copy()
    html = files[PARENT_HTML].decode()
    require(html.count(LOADER + INLINE) == 1, 'GA4 bootstrap differs from the expected two-script block')
    updated[PARENT_HTML] = html.replace(LOADER + INLINE, '', 1).encode()

    config = json.loads(files['vercel.json'])
    require(config.keys() == {'routes'}, 'unexpected project configuration')
    routes = config['routes']
    require(len(routes) == 24 and routes[-1]['src'] == '^/.*$' and routes[-1]['status'] == 404
            and not ({'methods', 'dest', 'has'} & routes[-1].keys())
            and all(rule.get('methods') == ['GET', 'HEAD'] for rule in routes[:-1]), 'routing shape changed')
    next_config = copy.deepcopy(config)
    removed_hash = "'sha256-" + base64.b64encode(hashlib.sha256(INLINE_BODY.encode()).digest()).decode() + "'"
    csp_removed = [removed_hash, LOADER_SOURCE]
    changed_routes = []
    for rule in next_config['routes']:
        if rule.get('dest') != '/' + PARENT_HTML:
            continue
        require(rule.get('has') == [{'type': 'host', 'value': PARENT_HOST}], 'unexpected parent hostname')
        directives = rule['headers'][CSP].split('; ')
        script_directive = [index for index, value in enumerate(directives) if value.startswith('script-src ')]
        require(len(script_directive) == 1, 'missing or duplicate parent script-src')
        index = script_directive[0]
        words = directives[index].split(' ')
        require(all(words.count(token) == 1 for token in csp_removed), 'GA4-only CSP entries differ from pinned HTML')
        directives[index] = ' '.join(token for token in words if token not in csp_removed)
        rule['headers'][CSP] = '; '.join(directives)
        changed_routes.append(rule['src'])
    require(len(changed_routes) == 2, 'expected both parent HTML route policies')
    updated['vercel.json'] = (json.dumps(next_config, ensure_ascii=False, indent=2) + '\n').encode()

    for path, data in updated.items():
        if Path(path).suffix in ('.html', '.js', '.css', '.json', '.svg'):
            require(not GA_MARKERS.search(data.decode()), f'unexpected GA signal or consumer in {path}')
    require({name for name in files if files[name] != updated[name]} == {PARENT_HTML, 'vercel.json'},
            'scope mismatch')
    return updated, changed_routes, csp_removed
