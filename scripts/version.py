Import("env")

import subprocess


def git_version():
    project_dir = env.subst("$PROJECT_DIR")
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=project_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=True,
        )
        version = result.stdout.strip()
        if version:
            return version
    except (OSError, subprocess.SubprocessError):
        pass
    return "dev"


version = git_version().replace('"', "'")
env.Append(BUILD_FLAGS=[f'-D AUTO_VERSION=\\"{version}\\"'])
print(f"[VERSION] Firmware version: {version}")
