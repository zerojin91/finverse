"""Run FINVERSE's Node.js workflow through an isolated uv environment."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def npm_executable() -> str:
    command = "npm.cmd" if os.name == "nt" else "npm"
    executable = shutil.which(command)
    if executable is None:
        raise SystemExit("Node.js 22.13 이상과 npm을 먼저 설치해 주세요.")
    return executable


def run(*arguments: str) -> None:
    subprocess.run(
        [npm_executable(), *arguments],
        cwd=ROOT,
        check=True,
    )


def ensure_dependencies() -> None:
    if not (ROOT / "node_modules").is_dir():
        run("ci")


def main() -> None:
    parser = argparse.ArgumentParser(description="FINVERSE 웹 개발 명령")
    parser.add_argument(
        "command",
        choices=("install", "build", "dev", "start", "test", "lint"),
    )
    args = parser.parse_args()

    if args.command == "install":
        run("ci")
        return

    ensure_dependencies()
    run("run", args.command)


if __name__ == "__main__":
    main()
