"""
FoolAI Backend — IOPaint/LaMa server
Bundled into foolai_backend.exe via PyInstaller.
Launched automatically by the Electron app — no terminal needed.
"""
import sys
import runpy


def main():
    # In dev mode only: auto-install iopaint if missing.
    # Inside a PyInstaller frozen bundle, iopaint is already included —
    # pip install would fail anyway since sys.executable is the .exe itself.
    if not getattr(sys, 'frozen', False):
        try:
            import iopaint  # noqa: F401
        except ImportError:
            import subprocess
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'iopaint', '--quiet']
            )

    # Run IOPaint in-process instead of via subprocess.
    # Using subprocess with sys.executable breaks in a frozen PyInstaller bundle
    # because sys.executable is foolai_backend.exe, not python.exe.
    # runpy.run_module is equivalent to `python -m iopaint` and works in both
    # dev mode and inside the frozen bundle where iopaint is already importable.
    sys.argv = [
        'iopaint', 'start',
        '--model', 'lama',
        '--device', 'cpu',
        '--host', '127.0.0.1',
        '--port', '8080',
        '--no-inbrowser',
    ]
    runpy.run_module('iopaint', run_name='__main__', alter_sys=True)


if __name__ == '__main__':
    main()
