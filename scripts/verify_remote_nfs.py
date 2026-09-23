#!/usr/bin/env python3
"""Opt-in live NFS probe. Writes only to a newly created, private test directory.

Usage: python3 scripts/verify_remote_nfs.py --hosts HOST HOST ... --output FILE
Requires existing trusted SSH keys, Python 3 on hosts, and a shared HOME.
Does not access Agent configuration contents. Recovery is a protocol prototype,
not an integration test of the Rust core. Leaves isolated evidence for inspection.
"""

import argparse
import concurrent.futures
import json
import shlex
import subprocess
import time


def command(host, source):
    return ["ssh", "-T", "-o", "ClearAllForwardings=yes", "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
            host, "python3 -u -c " + shlex.quote(source)]


def run(host, source):
    result = subprocess.run(command(host, source), capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError(f"{host}: {result.stderr.strip()} (exit {result.returncode})")
    return json.loads(result.stdout)


def start(host, source):
    process = subprocess.Popen(command(host, source), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    # Readiness timeout also bounds startup when the remote filesystem stalls.
    import select
    ready, _, _ = select.select([process.stdout], [], [], 30)
    if not ready or process.stdout.readline().strip() != "READY":
        process.kill()
        _, error = process.communicate(timeout=5)
        raise RuntimeError(f"{host}: worker failed to become ready: {error}")
    return process


def finish(process):
    out, err = process.communicate("release\n", timeout=40)
    if process.returncode:
        raise RuntimeError(f"worker exit {process.returncode}: {err}")
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hosts", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if len(args.hosts) < 2 or any(h.startswith("-") for h in args.hosts):
        parser.error("provide at least two SSH hosts, without leading dashes")
    hosts = args.hosts
    report = {"hosts": hosts, "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}

    def save():
        with open(args.output, "w") as output:
            json.dump(report, output, indent=2)
            output.write("\n")

    root = run(hosts[0], "import tempfile,os,json; print(json.dumps(tempfile.mkdtemp(prefix='.skill-studio-nfs-probe-',dir=os.path.expanduser('~'))))")
    report["test_root"] = root
    print("Isolated test directory:", root, flush=True)
    base = f"import os,json,fcntl,time,sys,signal\nfrom pathlib import Path\nr=Path({root!r})\nassert r.is_dir() and r.name.startswith('.skill-studio-nfs-probe-')\n"
    save()
    try:
        report["shared_identity"] = {h: run(h, base + "print(json.dumps({'inode':r.stat().st_ino,'mode':oct(r.stat().st_mode & 0o777)}))") for h in hosts}
        report["locks"] = {}
        for kind in ("flock", "lockf"):
            matrix = {}
            report["locks"][kind] = matrix
            for holder in hosts:
                process = start(holder, base + f"f=open(r/'{kind}.lock','a+')\nfcntl.{kind}(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nprint('READY',flush=True)\nimport select\nselect.select([sys.stdin],[],[],30)\n")
                try:
                    def contender(host):
                        return run(host, base + f"f=open(r/'{kind}.lock','a+')\ntry:\n fcntl.{kind}(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n print(json.dumps('ACQUIRED'))\nexcept BlockingIOError:\n print(json.dumps('BLOCKED'))\n")
                    with concurrent.futures.ThreadPoolExecutor(max_workers=len(hosts)) as pool:
                        matrix[holder] = dict(zip(hosts, pool.map(contender, hosts)))
                finally:
                    finish(process)
                save()
                print(kind, holder, matrix[holder], flush=True)

        # Process death must release locks; kill only the exact probe worker itself.
        crash = start(hosts[1], base + "f=open(r/'crash.lock','a+')\nfcntl.lockf(f,fcntl.LOCK_EX)\nprint('READY',flush=True)\nimport select\nselect.select([sys.stdin],[],[],30)\nos.kill(os.getpid(),signal.SIGKILL)\n")
        crash.communicate("crash\n", timeout=40)
        report["killed_lock_holder_exit"] = crash.returncode
        report["lock_after_process_death"] = run(hosts[0], base + "f=open(r/'crash.lock','a+')\nfcntl.lockf(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nprint(json.dumps('ACQUIRED'))\n")
        save()

        # Atomic rename under concurrent readers: each snapshot must be complete.
        atomic = """
def replace(name, value):
 p=r/name
 tmp=r/(name+'.tmp')
 with open(tmp,'w') as f:
  json.dump(value,f); f.flush(); os.fsync(f.fileno())
 os.replace(tmp,p)
 fd=os.open(r,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
"""
        run(hosts[0], base + atomic + "replace('snapshot.json',{'generation':0,'body':'0'*65536})\nprint(json.dumps('initialized'))")
        writer = start(hosts[0], base + atomic + "print('READY',flush=True)\nimport select\nselect.select([sys.stdin],[],[],30)\nsys.stdin.readline()\nfor i in range(1,101):\n replace('snapshot.json',{'generation':i,'body':str(i%10)*65536})\n time.sleep(.02)\n")
        try:
            writer.stdin.write("start\n")
            writer.stdin.flush()
            reader = base + "seen=set()\nfor _ in range(200):\n d=json.loads((r/'snapshot.json').read_text())\n assert d['body']==str(d['generation']%10)*65536\n seen.add(d['generation'])\n time.sleep(.01)\nprint(json.dumps({'reads':200,'generations':sorted(seen)}))\n"
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(hosts)) as pool:
                report["atomic_readers"] = dict(zip(hosts, pool.map(lambda h: run(h, reader), hosts)))
        finally:
            writer.wait(timeout=40)
            writer.stdin.close()
            writer.stdout.close()
            error = writer.stderr.read()
            writer.stderr.close()
            if writer.returncode:
                raise RuntimeError(error)
        report["final_visibility"] = {h: run(h, base + "print(json.dumps(json.loads((r/'snapshot.json').read_text())['generation']))") for h in hosts}
        save()
        print("Atomic snapshots completed", flush=True)

        # Model the core's undo journal ordering with synthetic files only.
        report["recovery_prototype"] = {}
        for committed in (False, True):
            prepare = base + atomic + f"""
replace('target.json',{{'value':'old'}})
replace('journal.json',{{'committed':False}})
os.replace(r/'target.json',r/'backup.json')
replace('target.json',{{'value':'new'}})
if {committed!r}: replace('journal.json',{{'committed':True}})
print('READY',flush=True)
import select
select.select([sys.stdin],[],[],30)
os.kill(os.getpid(),signal.SIGKILL)
"""
            process = start(hosts[1], prepare)
            process.communicate("crash\n", timeout=40)
            recover = base + """
with open(r/'recovery.lock','a+') as f:
 fcntl.lockf(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if (r/'journal.json').exists():
  journal=json.loads((r/'journal.json').read_text())
  if journal['committed']:
   (r/'backup.json').unlink(missing_ok=True)
  elif (r/'backup.json').exists():
   os.replace(r/'backup.json',r/'target.json')
  (r/'journal.json').unlink()
 print(json.dumps(json.loads((r/'target.json').read_text())))
"""
            first = run(hosts[0], recover)
            repeated = run(hosts[-1], recover)
            expected = {"value": "new" if committed else "old"}
            assert first == repeated == expected
            report["recovery_prototype"][str(committed)] = {"worker_exit":process.returncode,"first":first,"repeated":repeated}
            save()
        report["completed"] = True
    except Exception as exc:
        report["error"] = str(exc)
        raise
    finally:
        save()
    print("Report:", args.output, flush=True)


if __name__ == "__main__":
    main()
