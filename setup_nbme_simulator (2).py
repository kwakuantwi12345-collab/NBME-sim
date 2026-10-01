#!/usr/bin/env python3
"""
NBME / USMLE Exam Simulator - guided setup
==========================================
One file. It contains the whole app and walks you, step by step, through:

  1. Creating the app files on your computer
  2. (Optional) Running the app on your computer
  3. Putting the files on GitHub (checks your upload for you)
  4. Deploying to Streamlit Community Cloud for a free shareable link

How to run it
  Mac:      open Terminal, type  python3 , a space, drag this file into the window, press Enter
  Windows:  open PowerShell, type  py , a space, drag this file into the window, press Enter

Nothing is sent anywhere except: GitHub's public API (to check your repo) and
pip (if you choose to run the app locally). Your API key is never written to disk.
"""
import base64
import getpass
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zlib
from pathlib import Path

# ── Embedded app files (compressed) ─────────────────────────────────────────
FILES = {
    "app.py": (
        "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"
    ),
    "requirements.txt": (
        "eNoVy0sKgDAMANF9DxMS1GV7Bq8Qa8RCf7QR8fa2y4E3XZtwikGdJVjR1POq8UmHNGcRiAxnvVupwc8eoFTJHKbe0OwhxvKO"
        "QBjrp9K7NPY67QKE5gfH2B1/"
    ),
    "packages.txt": (
        "eNorSS0uTi1KTC7RzU8u4gIAKvkFSg=="
    ),
    "README.md": (
        "eNplVMFy2zYQvfMrduRDbQ7JTpP00pkeFFlJ1NaWaspNc7JAciViBBIMAEZmxof+Q/+wX9IHkHI8k4NGJHexb/He272g27c3"
        "S/qR7vObP5a0fBQN5bLplXDaRNF9p7SoSLTEPrK5fofnipw4MklHwpIgJxuuklAntW5QTIXS5TGjT7qnAyOL9r1SZEttmAx3"
        "2rhQZb5C1U6JVjipW0t7bYi/sBkQtSc2VNZalpxF0cUFfayF+8GSbMnV0oYyUfRE7yTwnkLUN1RptvQUPaVpGn7I2Imuy7ph"
        "h6xtzXSqNU7gG4Wg4c+9NNxw62zmHp1P2wyu1i0pWRhhJAo6Xz13hkWjALJQuq/QiXVCKTDQO93gCiXehrFqJ8qjOPBzxdU5"
        "16GD9eKOuD3IlhPqLVekW5zzl7elaFt8AM12LGRF0yl+8ORnXbX3teb0Ov3cs/WckcP/KM3L9CMPZ+T5yCS+BASPPyadT3lu"
        "rxkyD3S5N8xXUfRTRu81OU1xbGthOLPnq2dSx3HQzspD68U4SVfTe+k+9EUWvcrAjSyPOLjACRd4juPEw7ZeTW0ZsQlOUNcX"
        "SA9i7I1upjpxnEWvM8rhnDi+g85WwosDgNHSs/gJgm+NaMt6DOwaIdtdEpqL4xu80N57oxPunDEZIYveZLTu0FEcz6svKAHK"
        "LTsn24MFONRCJOfSsLO++05YXMVTt9dK6RPy6FJ3XgChEir6YD1uRaF4lBjOtlrByle/RBER7XY7eET5x/nt9sPderNaPMw3"
        "q4ffl5/oV5oFhHTQvUmhVFqz4VlI3mweNvM8/7i+uw55IDcVKdLtSZtqNtWOop+/MT+y6+/h7b6XBg4peqnGqYVdC42GX/33"
        "z79vqJFtDwuNE3Zv/UwH+eN4GnxPoc3A3/eLYJxvOJaEsppEFaLim98ut39vE1rkfyX0W76+JdgPx66Scc4fRxfugDZPyDsn"
        "Iai+3AUbgX8nsCY8meM2QQ8bf8HnL7DgVw7WOl8jaC+o0RUD3G+lcT4At8WMmquzESemRohQbPJcHC/9dnsJeqbVB6ZUbybL"
        "TF6v77fay5UGYv+cRtWGUfHUi8AO5moiC20Ww2SbhOTe0whvhCyYHc70UuqgDjc2nFSiYKVwcjZfzcal+NxEwaXAXvEmHAFs"
        "UKnA7jO6PWTR/zZW9DA="
    ),
    "sample_exam.pdf": (
        "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"
    ),
    "sample_key.txt": (
        "eNoz1FNw1FEwApIACdQBzg=="
    ),
}

REPO_DEFAULT = "nbme-simulator"
STATE_FILE = Path.home() / ".nbme_simulator_setup.json"
VENV_DIR = Path.home() / ".nbme-simulator-venv"
IS_WIN = platform.system() == "Windows"
IS_MAC = platform.system() == "Darwin"

# ── Terminal helpers ────────────────────────────────────────────────────────
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # emoji/box chars on Windows
except Exception:
    pass
if IS_WIN:
    os.system("")  # enables colour codes in Windows 10+ terminals

B, G, Y, R, C, DIM, X = "\033[1m", "\033[92m", "\033[93m", "\033[91m", "\033[96m", "\033[2m", "\033[0m"


def say(msg=""):
    print(msg)


def ok(msg):
    print(f"{G}  ✔ {msg}{X}")


def warn(msg):
    print(f"{Y}  ! {msg}{X}")


def err(msg):
    print(f"{R}  ✘ {msg}{X}")


def header(title):
    line = "─" * 64
    print(f"\n{C}{line}\n  {B}{title}{X}{C}\n{line}{X}")


def todo(n, msg):
    print(f"  {B}{n}.{X} {msg}")


def ask(prompt, default=""):
    suffix = f" {DIM}[{default}]{X}" if default else ""
    try:
        val = input(f"{B}? {prompt}{suffix}: {X}").strip()
    except EOFError:
        val = ""
    return val or default


def yes(prompt, default=True):
    d = "Y/n" if default else "y/N"
    val = ask(f"{prompt} ({d})").lower()
    return default if not val else val.startswith("y")


def pause(msg="Press Enter when you've done that"):
    try:
        input(f"{DIM}  ↵ {msg}...{X}")
    except EOFError:
        pass


def open_url(url):
    say(f"  {DIM}Opening:{X} {url}")
    try:
        webbrowser.open(url)
    except Exception:
        warn("Couldn't open the browser automatically - copy the link above into your browser.")


def open_folder(path):
    try:
        if IS_WIN:
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif IS_MAC:
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception:
        pass


def copy_to_clipboard(text):
    try:
        if IS_MAC:
            subprocess.run(["pbcopy"], input=text.encode(), check=True)
        elif IS_WIN:
            subprocess.run(["clip"], input=text.encode("utf-16le"), check=True)
        else:
            subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(), check=True)
        return True
    except Exception:
        return False


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(**kw):
    s = load_state()
    s.update({k: v for k, v in kw.items() if v})
    try:
        STATE_FILE.write_text(json.dumps(s, indent=2))
    except Exception:
        pass
    return s


# ── Step 1: create files ────────────────────────────────────────────────────
def default_folder():
    desk = Path.home() / "Desktop"
    return (desk if desk.exists() else Path.home()) / REPO_DEFAULT


def step_files():
    header("STEP 1 of 4 · Create the app files")
    st = load_state()
    folder = Path(ask("Where should I put the files?", st.get("folder") or str(default_folder()))).expanduser()
    if folder.exists() and any(folder.iterdir()):
        if not yes(f"{folder} already has files. Overwrite the app files in it?"):
            return folder
    folder.mkdir(parents=True, exist_ok=True)
    for name, blob in FILES.items():
        (folder / name).write_bytes(zlib.decompress(base64.b64decode(blob)))
        ok(f"created {name}")
    save_state(folder=str(folder))
    say(f"\n  All files are in: {B}{folder}{X}")
    open_folder(folder)
    return folder


def get_folder():
    st = load_state()
    f = Path(st.get("folder", "")) if st.get("folder") else None
    if f and (f / "app.py").exists():
        return f
    warn("I couldn't find your app files yet - let's create them first.")
    return step_files()


# ── Step 2: run locally (optional) ──────────────────────────────────────────
def venv_python():
    return VENV_DIR / ("Scripts/python.exe" if IS_WIN else "bin/python")


def step_local():
    header("OPTIONAL · Run the app on this computer")
    folder = get_folder()
    if sys.version_info < (3, 9):
        err(f"Python {platform.python_version()} is too old - install Python 3.10+ from python.org.")
        return
    if not venv_python().exists():
        say("  Creating a private Python environment (one time, ~1 min)...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
    say("  Installing the app's libraries (first time takes 1-3 min)...")
    r = subprocess.run([str(venv_python()), "-m", "pip", "install", "-q", "--upgrade", "pip"])
    r = subprocess.run([str(venv_python()), "-m", "pip", "install", "-q", "-r", str(folder / "requirements.txt")])
    if r.returncode != 0:
        err("Install failed. Check your internet connection and try again.")
        return
    ok("Libraries installed")

    env = os.environ.copy()
    provider = ask("AI provider for explanations: 1) Anthropic  2) OpenAI  3) none for now", "3")
    if provider in ("1", "2"):
        var = "ANTHROPIC_API_KEY" if provider == "1" else "OPENAI_API_KEY"
        key = getpass.getpass(f"  Paste your {var} (hidden, not saved): ").strip()
        if key:
            env[var] = key
            env["LLM_PROVIDER"] = "Anthropic" if provider == "1" else "OpenAI"
    say(f"\n  Starting the app. Your browser will open at {B}http://localhost:8501{X}")
    say(f"  {DIM}Press Ctrl+C here to stop the app and return to the menu.{X}\n")
    try:
        subprocess.run([str(venv_python()), "-m", "streamlit", "run", str(folder / "app.py")], cwd=folder, env=env)
    except KeyboardInterrupt:
        pass
    ok("App stopped")


# ── Step 3: GitHub ──────────────────────────────────────────────────────────
def gh_ready():
    if not shutil.which("gh") or not shutil.which("git"):
        return False
    return subprocess.run(["gh", "auth", "status"], capture_output=True).returncode == 0


def github_api(path):
    req = urllib.request.Request(f"https://api.github.com{path}",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": "nbme-setup"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def verify_repo(user, repo):
    """Returns True if app.py + requirements.txt sit at the top of the repo."""
    try:
        info = github_api(f"/repos/{user}/{repo}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            err(f"github.com/{user}/{repo} not found. Check the username/repo name, and that it's Public.")
        else:
            err(f"GitHub said: HTTP {e.code}. Try again in a minute.")
        return False
    except Exception as e:
        err(f"Couldn't reach GitHub ({e}). Check your internet connection.")
        return False
    if info.get("private"):
        err("The repo is Private. Streamlit's free tier needs Public: repo → Settings → "
            "scroll to 'Danger Zone' → Change visibility → Public.")
        return False
    branch = info.get("default_branch", "main")
    try:
        items = github_api(f"/repos/{user}/{repo}/contents?ref={branch}")
    except urllib.error.HTTPError:
        err("The repo is empty - the files haven't been committed yet.")
        return False
    names = {i["name"] for i in items}
    need = {"app.py", "requirements.txt"}
    if need <= names:
        ok(f"Repo looks perfect: {', '.join(sorted(names))}")
        save_state(branch=branch)
        return True
    dirs = [i["name"] for i in items if i["type"] == "dir"]
    if dirs and not (need & names):
        err(f"Your files are inside a folder called '{dirs[0]}'. Streamlit needs them at the top level.")
        say("    Fix: delete the repo (Settings → Danger Zone → Delete) and upload the FILES, not the folder,")
        say("    or in the next step set 'Main file path' to " + f"{B}{dirs[0]}/app.py{X}")
        save_state(main_path=f"{dirs[0]}/app.py", branch=branch)
        return yes("Continue anyway using that path?", False)
    err(f"Missing: {', '.join(sorted(need - names))}. Upload the missing file(s) and commit.")
    return False


def step_github():
    header("STEP 2 of 4 · Put the files on GitHub")
    folder = get_folder()
    st = load_state()
    say("  You need a free GitHub account. If you don't have one, I'll open the sign-up page.")
    if not yes("Do you already have a GitHub account?"):
        open_url("https://github.com/signup")
        pause("Finish signing up (verify your email), then press Enter")
    user = ask("Your GitHub username (exactly as shown on github.com)", st.get("user", "")).lstrip("@")
    repo = ask("Name for the new repository", st.get("repo", REPO_DEFAULT))
    save_state(user=user, repo=repo)

    # Fast path: GitHub CLI already signed in
    if gh_ready() and yes("GitHub CLI detected. Create the repo and upload automatically?"):
        run = lambda *a: subprocess.run(list(a), cwd=folder)
        if not (folder / ".git").exists():
            run("git", "init", "-b", "main")
        run("git", "add", "app.py", "requirements.txt", "packages.txt", "README.md",
            "sample_exam.pdf", "sample_key.txt")
        run("git", "-c", "user.name=" + user, "-c", f"user.email={user}@users.noreply.github.com",
            "commit", "-m", "NBME exam simulator")
        r = run("gh", "repo", "create", repo, "--public", "--source", ".", "--push")
        if r.returncode == 0:
            time.sleep(3)
            if verify_repo(user, repo):
                return True
        warn("Automatic upload didn't finish - let's do it in the browser instead.")

    # Browser path
    say(f"\n{B}  A) Create the empty repository{X}")
    q = urllib.parse.urlencode({"name": repo, "visibility": "public",
                                "description": "NBME/USMLE exam simulator"})
    open_url(f"https://github.com/new?{q}")
    todo(1, f"Repository name should say {B}{repo}{X}")
    todo(2, f"Make sure {B}Public{X} is selected")
    todo(3, f"Leave 'Add a README' {B}OFF{X}")
    todo(4, f"Click {B}Create repository{X}")
    pause()

    say(f"\n{B}  B) Upload the files{X}")
    open_url(f"https://github.com/{user}/{repo}/upload")
    open_folder(folder)
    say(f"  I've opened the upload page and your folder ({folder}).")
    todo(1, f"In the folder window select everything: {B}{'Ctrl+A' if IS_WIN else '⌘+A'}{X}")
    todo(2, "Drag the 6 files onto the GitHub page (the files, not the folder)")
    todo(3, "Wait until all 6 show up in the list")
    todo(4, f"Scroll down and click the green {B}Commit changes{X} button")
    pause()

    while True:
        say("\n  Checking your repository...")
        if verify_repo(user, repo):
            return True
        if not yes("Fix it and check again?"):
            return False
        pause("Press Enter when you've fixed it")


# ── Step 4: Streamlit Cloud ─────────────────────────────────────────────────
def build_secrets():
    say("  The AI solver/explainer needs an API key (it costs a little per question).")
    say("  Get one at: Anthropic → console.anthropic.com → API Keys   |   OpenAI → platform.openai.com/api-keys")
    choice = ask("Which provider? 1) Anthropic  2) OpenAI  3) skip - users paste a key in the app", "1")
    lines = []
    if choice in ("1", "2"):
        var = "ANTHROPIC_API_KEY" if choice == "1" else "OPENAI_API_KEY"
        key = getpass.getpass(f"  Paste your {var} (hidden; typed/pasted text won't show): ").strip()
        if key:
            lines.append(f'{var} = {json.dumps(key)}')
            lines.append(f'LLM_PROVIDER = "{"Anthropic" if choice == "1" else "OpenAI"}"')
        say(f"  {DIM}Because your key is stored on the app, anyone with the link could use it.{X}")
        pw = getpass.getpass("  Choose an app password to protect it (hidden, recommended): ").strip()
        if pw:
            lines.append(f'APP_PASSWORD = {json.dumps(pw)}')
    return "\n".join(lines)


def step_streamlit():
    header("STEP 3 of 4 · Deploy on Streamlit Community Cloud (free)")
    st = load_state()
    user = st.get("user") or ask("Your GitHub username")
    repo = st.get("repo") or ask("Repository name", REPO_DEFAULT)
    branch = st.get("branch", "main")
    main_path = st.get("main_path", "app.py")

    secrets = build_secrets()

    say(f"\n{B}  A) Sign in{X}")
    open_url("https://share.streamlit.io/")
    todo(1, f"Click {B}Continue with GitHub{X} and approve access (first time only)")
    pause()

    say(f"\n{B}  B) Create the app{X}")
    q = urllib.parse.urlencode({"repository": f"{user}/{repo}", "branch": branch, "mainModule": main_path})
    open_url(f"https://share.streamlit.io/deploy?{q}")
    say("  If the form isn't pre-filled: click 'Create app' → 'Deploy a public app from GitHub', then enter:")
    say(f"      Repository      {B}{user}/{repo}{X}")
    say(f"      Branch          {B}{branch}{X}")
    say(f"      Main file path  {B}{main_path}{X}")
    say(f"      App URL         pick a short name, e.g. {B}{user.lower()}-nbme{X}")

    if secrets:
        say(f"\n{B}  C) Add your secrets{X}")
        if copy_to_clipboard(secrets):
            ok("Your secrets are copied to the clipboard")
        else:
            warn("Couldn't use the clipboard - copy these lines by hand:")
            say(secrets)
        todo(1, f"Click {B}Advanced settings{X}")
        todo(2, f"Click inside the {B}Secrets{X} box and paste ({'Ctrl+V' if IS_WIN else '⌘+V'})")
        todo(3, f"Click {B}Save{X}")
    say(f"\n{B}  {'D' if secrets else 'C'}) Click Deploy{X} - the first build takes 2-4 minutes.")
    pause("Press Enter once the app has loaded in your browser")

    url = ask("Paste your app's link (e.g. https://my-nbme.streamlit.app), or press Enter to skip", st.get("url", ""))
    if url:
        if not url.startswith("http"):
            url = "https://" + url
        save_state(url=url)
        try:
            urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "nbme-setup"}), timeout=20)
            ok("Your app is online")
        except Exception:
            warn("Couldn't confirm the link yet - it may still be building. Open it in a minute.")
    if secrets:
        copy_to_clipboard(" ")  # clear the key from the clipboard
        ok("Clipboard cleared")
    return url


# ── Step 5: test + finish ───────────────────────────────────────────────────
def step_finish():
    header("STEP 4 of 4 · Test it")
    st = load_state()
    folder = st.get("folder", "your folder")
    if st.get("url"):
        open_url(st["url"])
    todo(1, "Open your app link (enter your password if you set one)")
    todo(2, f"Upload {B}sample_exam.pdf{X} as the exam and {B}sample_key.txt{X} as the key (both in {folder})")
    todo(3, f"Click {B}▶ Start block{X}, answer a question, then {B}End block{X}")
    say(f"\n  {G}{B}If you see a score report - you're done! 🎉{X}")
    if st.get("url"):
        say(f"  Your shareable link: {B}{st['url']}{X}")
    say(f"\n  {DIM}Tips: free apps sleep after a few days - click 'Yes, get this app back up'.")
    say(f"  To change secrets later: your app → ⋮ → Settings → Secrets.{X}")


# ── Troubleshooting ─────────────────────────────────────────────────────────
def step_troubleshoot():
    header("Troubleshooting")
    st = load_state()
    say("  Common problems:")
    todo(1, "Build error / ModuleNotFoundError → requirements.txt isn't at the top of the repo")
    todo(2, "'No API key' in the sidebar → key name misspelled in Secrets (app → ⋮ → Settings → Secrets)")
    todo(3, "Repo not found → it's Private, or the username/repo name is different")
    todo(4, "App asleep → click 'Yes, get this app back up'; takes ~30 s")
    if st.get("user") and st.get("repo") and yes(f"\nCheck github.com/{st['user']}/{st['repo']} now?"):
        verify_repo(st["user"], st["repo"])
    if st.get("url"):
        say(f"\n  Streamlit logs: open {st['url']} → 'Manage app' (bottom-right) to see errors.")


# ── Menu ────────────────────────────────────────────────────────────────────
def full_setup():
    step_files()
    if yes("\nWould you like to try the app on this computer first? (optional)", False):
        step_local()
    if not step_github():
        warn("Stopped at GitHub. Run this script again and choose option 3 to continue.")
        return
    step_streamlit()
    step_finish()


def main():
    print(f"""
{C}{B}  ╔══════════════════════════════════════════════════════╗
  ║        NBME / USMLE Exam Simulator — Setup Guide       ║
  ╚══════════════════════════════════════════════════════╝{X}
  I'll create the app, help you put it on GitHub, and get you a free
  shareable link. About 10 minutes. Nothing to code.
""")
    st = load_state()
    if st:
        say(f"  {DIM}Welcome back - saved progress: " +
            ", ".join(f"{k}={v}" for k, v in st.items() if k in ("folder", "user", "repo", "url")) + X)
    actions = {
        "1": ("Full guided setup (recommended)", full_setup),
        "2": ("Create / re-create the app files only", step_files),
        "3": ("Put the files on GitHub", lambda: step_github() and None),
        "4": ("Deploy on Streamlit Cloud", lambda: (step_streamlit(), step_finish())),
        "5": ("Run the app on this computer", step_local),
        "6": ("Troubleshoot / check my repo", step_troubleshoot),
        "q": ("Quit", None),
    }
    while True:
        say(f"\n{B}  What would you like to do?{X}")
        for k, (label, _) in actions.items():
            say(f"   {B}{k}{X}  {label}")
        choice = ask("Choose", "1").lower()
        if choice not in actions:
            warn("Please type one of the numbers above.")
            continue
        if choice == "q":
            say("  Bye! Run this script again any time to continue where you left off.")
            return
        try:
            actions[choice][1]()
        except KeyboardInterrupt:
            say("")
            warn("Cancelled - back to the menu.")
        except Exception as e:
            err(f"Something went wrong: {e}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say("\n  Bye!")
