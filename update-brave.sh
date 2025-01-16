#!/usr/bin/env sh

rm -fr brave
mkdir brave
cd brave && wget 'https://github.com/brave/brave-browser/releases/download/v1.60.114/brave-browser-1.60.114-linux-amd64.zip' -O brave.zip && unzip brave.zip && rm brave.zip
sudo chown root:root ./brave/chrome-sandbox
sudo chmod 4755 ./brave/chrome-sandbox
export BRAVE_PATH="./brave/brave"
