#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS for the public alpha (P6b). Run as root, from the repo on your PC:
#   ssh root@IP "bash -s -- <site> [branch] '<deploy public key>'" < deploy/provision.sh
# (the remote shell splits that line again: the key, which has spaces, stays in its own quotes)
# site: the address players use (e.g. 203-0-113-7.sslip.io). branch: what to clone (default master).
# deploy public key: GitHub Actions' key, allowed only to run deploy.sh (can also be added later: see README).
# Safe to run again: every step checks or overwrites.
set -euo pipefail
SITE=${1:?usage: provision.sh <site> [branch] [deploy public key]}
BRANCH=${2:-master}
DEPLOY_KEY=${3:-}
REPO=https://github.com/NathanProvin/PanSpermia.git
export DEBIAN_FRONTEND=noninteractive

echo "== system: updates, automatic security updates"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl git ufw gnupg unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Node 24"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

echo "== firewall: ssh, http, https only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== the game"
id panspermia >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash panspermia
install -d -o panspermia -g panspermia /opt/panspermia
[ -d /opt/panspermia/.git ] || sudo -u panspermia git clone --quiet --branch "$BRANCH" "$REPO" /opt/panspermia
cd /opt/panspermia
sudo -u panspermia npm ci --no-audit --no-fund --loglevel=error
sudo -u panspermia npm run build --silent
install -m 644 deploy/panspermia.service /etc/systemd/system/panspermia.service
[ -f /etc/panspermia.env ] || echo 'MAX_ROOMS=1' > /etc/panspermia.env # raise once measured on this machine
echo 'panspermia ALL=(root) NOPASSWD: /usr/bin/systemctl restart panspermia' > /etc/sudoers.d/panspermia
chmod 440 /etc/sudoers.d/panspermia
visudo -cf /etc/sudoers.d/panspermia
sed "s/{\$SITE}/$SITE/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now panspermia
systemctl restart panspermia
systemctl reload caddy || systemctl restart caddy

if [ -n "$DEPLOY_KEY" ]; then
  echo "== GitHub Actions' deploy key: may only run deploy.sh"
  install -d -m 700 -o panspermia -g panspermia /home/panspermia/.ssh
  echo "restrict,command=\"/usr/bin/bash /opt/panspermia/deploy/deploy.sh\" $DEPLOY_KEY" > /home/panspermia/.ssh/authorized_keys
  chown panspermia:panspermia /home/panspermia/.ssh/authorized_keys
  chmod 600 /home/panspermia/.ssh/authorized_keys
fi

echo "== ssh: keys only (this session came in with one)"
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-panspermia.conf
sshd -t
systemctl reload ssh

echo "== done: https://$SITE (health: curl https://$SITE/health)"
