#!/usr/bin/env bash
set -euo pipefail

# Fork runners cannot resolve archive.ubuntu.com, azure.archive.ubuntu.com, or
# security.ubuntu.com, so apt fails every system-package install. The Kernel.org
# archive mirror serves the same signed pockets from a host the runners resolve;
# apt still verifies each package against the configured Ubuntu keyring.
readonly MIRROR_ROOT='https://mirrors.edge.kernel.org/ubuntu'
readonly UBUNTU_ARCHIVE='https?://(azure\.)?archive\.ubuntu\.com/ubuntu|https?://security\.ubuntu\.com/ubuntu'

# Hosted images reach the archive through apt-mirrors.txt, which ubuntu.sources
# includes as mirror+file:; one reachable mirror replaces the priority list.
if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  printf '%s/\tpriority:1\n' "$MIRROR_ROOT" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
fi

sudo find /etc/apt -maxdepth 2 -type f \( -name '*.list' -o -name '*.sources' \) \
  -exec sed -i -E "s@${UBUNTU_ARCHIVE}@${MIRROR_ROOT}@g" {} +

if sudo grep -qrIlE "$UBUNTU_ARCHIVE" /etc/apt; then
  echo 'prepare-ci-apt-mirror left an Ubuntu archive host under /etc/apt' >&2
  exit 1
fi
grep -qrF "$MIRROR_ROOT" /etc/apt \
  || { echo 'prepare-ci-apt-mirror found no Ubuntu archive entry to redirect' >&2; exit 1; }
