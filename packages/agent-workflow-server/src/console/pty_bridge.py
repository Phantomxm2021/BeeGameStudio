#!/usr/bin/env python3
import json
import os
import pty
import select
import signal
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: pty_bridge.py '<json command array>' '<cwd>'", file=sys.stderr)
        return 2

    command = json.loads(sys.argv[1])
    cwd = sys.argv[2]
    if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
        print("command must be a JSON string array", file=sys.stderr)
        return 2
    if not command:
        print("command must not be empty", file=sys.stderr)
        return 2

    os.environ.setdefault("TERM", "xterm-256color")
    os.environ.setdefault("COLUMNS", "120")
    os.environ.setdefault("LINES", "40")

    pid, master_fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe(command[0], command, os.environ)

    def terminate_child(signum, _frame):
        try:
            os.kill(pid, signum)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, terminate_child)
    signal.signal(signal.SIGINT, terminate_child)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    while True:
        child_pid, status = os.waitpid(pid, os.WNOHANG)
        if child_pid == pid:
            if os.WIFEXITED(status):
                return os.WEXITSTATUS(status)
            if os.WIFSIGNALED(status):
                return 128 + os.WTERMSIG(status)
            return 1

        readable, _, _ = select.select([stdin_fd, master_fd], [], [], 0.1)
        if stdin_fd in readable:
            data = os.read(stdin_fd, 4096)
            if data:
                os.write(master_fd, data)
        if master_fd in readable:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                data = b""
            if data:
                os.write(stdout_fd, data)


if __name__ == "__main__":
    raise SystemExit(main())
