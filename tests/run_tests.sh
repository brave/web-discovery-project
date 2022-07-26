#! /bin/bash

set -x

export DISPLAY=:0
Xvfb $DISPLAY -screen 0 1024x768x24 -ac &
sleep 1
openbox &

x11vnc -storepasswd vnc /tmp/vncpass
x11vnc -rfbport 5900 -rfbauth /tmp/vncpass -forever >/dev/null 2>&1 &

# while running this script, you can add multiple paratemeters in quotes, e.g.:
# './configs/ci/browser.js --firefox /home/node/firefox56/firefox/firefox'
# ./fern.js serve "$@" --include-tests

# to use test instead of serve comment previous line and uncomment the next one
# node --unhandled-rejections=strict fern.js test "$@" --ci report.xml

./fern.js build configs/ci/integration-tests.js --include-tests
export BRAVE_PATH=/opt/brave.com/brave/brave-browser CONFIG_PATH=./configs/ci/integration-tests.js ; time NODE_ENV=production node --icu-data-dir=node_modules/full-icu tests/runners/brave-web-ext.js
