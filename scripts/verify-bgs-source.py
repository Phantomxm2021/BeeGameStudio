import importlib.util,subprocess,tarfile,io,tempfile,os,shutil,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('brand','scripts/brand-bgs.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
if len(sys.argv)!=2: raise SystemExit('Usage: python3 scripts/verify-bgs-source.py SOURCE_BRANCH')
root=Path('vendor/bgs').resolve();scratch=Path(tempfile.mkdtemp(prefix='bgs-source-repro-'))
try:
 data=subprocess.check_output(['git','archive',sys.argv[1]],cwd=root)
 with tarfile.open(fileobj=io.BytesIO(data)) as tar:tar.extractall(scratch,filter='data')
 subprocess.run(['git','init','-q'],cwd=scratch,check=True)
 subprocess.run(['git','add','--force','-A'],cwd=scratch,check=True)
 report=b.convert(scratch,True,True)
 entries=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
 differences=[];checked=0
 for name in entries:
  if not name:continue
  actual=root/name;expected=scratch/name
  checked+=1
  if not expected.exists() or actual.is_symlink()!=expected.is_symlink():differences.append(name);continue
  if actual.is_symlink():same=os.readlink(actual)==os.readlink(expected)
  else:same=actual.read_bytes()==expected.read_bytes() and (actual.stat().st_mode & 0o111)==(expected.stat().st_mode & 0o111)
  if not same:differences.append(name)
 result={'checkedFiles':checked,'differences':differences,'transformedFiles':report['changedFiles'],'renamedFiles':report['renamedFiles']}
 print(json.dumps(result))
 if differences:raise SystemExit(1)
finally:shutil.rmtree(scratch)
