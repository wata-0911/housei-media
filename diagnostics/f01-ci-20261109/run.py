import subprocess,os,json,pathlib,time,sys,platform,signal
root=pathlib.Path.cwd();out=pathlib.Path(os.environ['F01_OUTPUT']);out.mkdir(parents=True,exist_ok=True)
phase=sys.argv[1]
node=['npm','run']
suites={
'node': [('typecheck',node+['typecheck']),('lint',node+['lint']),('planner',node+['test:planner']),('host',node+['test:grade-import-host']),('backup',node+['test:grade-import-backup']),('build',node+['build'])],
'core':['authority-admission','authority-remediation','authority-remediation-ui'],
'r2':['authority-r2','authority-r2-ui'],
'r3':['authority-r3'],'r4':['authority-r4'],'r5':['authority-r5'],'r6':['authority-r6'],'r7':['authority-r7'],'r8':['authority-r8'],
'ac':['ac-integration'],'abc':['abc-integration'],'capacity':[]}
if phase!='node':
 suites[phase]=[('build-ac',node+['build:ac-integration'])]+[(s,['node','--import','tsx','--test','--test-reporter=tap','tests/'+s+'.browser.mjs']) for s in suites[phase]]
 if phase=='capacity':suites[phase].append(('capacity',['node','--import','tsx','--test','--test-reporter=tap','diagnostics/f01-ci-20261109/capacity.browser.mjs']))
env=dict(os.environ)
env['PLANNER_PLAYWRIGHT_MODULE']=str(root/'diagnostics/f01-ci-20261109/browser-runtime.mjs')
env['ABC_EVIDENCE']=str(out/'abc');env['AC_BROWSER_EVIDENCE']=(out/'ac').as_uri()+'/'
results=[]
(out/'environment.json').write_text(json.dumps({'platform':platform.platform(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'runnerImage':os.getenv('ImageVersion'),'runnerOS':os.getenv('ImageOS'),'cpu':os.cpu_count(),'playwright':'1.62.1','phase':phase},indent=2))
for name,cmd in suites[phase]:
 start=time.time();log=out/(name+'.log');timing=out/(name+'-time.txt')
 with log.open('w') as f:
  try:
   p=subprocess.Popen(['/usr/bin/time','-v','-o',str(timing),*cmd],stdout=f,stderr=subprocess.STDOUT,env=env,start_new_session=True)
   code=p.wait(timeout=1800);status='PASS' if code==0 else 'FAIL'
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGKILL);p.wait();code=124;status='TIMEOUT'
 if phase=='abc' and name=='abc-integration' and code==0:
  text=log.read_text()
  if not all(token in text for token in ['# tests 17','# pass 17','# skipped 0','# cancelled 0']):
   code=1;status='FAIL';print('ABC full-count evidence guard failed',flush=True)
 results.append({'suite':name,'command':cmd,'exit':code,'status':status,'seconds':round(time.time()-start,3)})
 (out/'summary.json').write_text(json.dumps(results,indent=2))
 print(name,status,code,flush=True)
 if code!=0:
  print('--- synthetic suite failure tail (80 lines) ---',flush=True)
  print('\n'.join(log.read_text(errors='replace').splitlines()[-80:]),flush=True)
# Subprocess peak RSS is reported by time; browser descendants/cgroup peak are separate evidence.
for f in ['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory.events']:
 try:(out/pathlib.Path(f).name).write_text(pathlib.Path(f).read_text())
 except OSError:pass
sys.exit(1 if any(r['exit']!=0 for r in results) else 0)
