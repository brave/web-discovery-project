#!/usr/bin/env sh

rm -fr brave
mkdir brave
cd brave && wget 'https://github.com/brave/brave-browser/releases/download/v1.26.74/brave-browser-1.26.74-linux-amd64.zip' -O brave.zip && unzip brave.zip && rm brave.zip
