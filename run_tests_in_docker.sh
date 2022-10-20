#! /bin/bash

help() {
    echo 'Usage:'
    echo " $0 <FERN_ARGS>"
    echo
    echo 'Available arguments for fern.js:'
    awk '/def matrix/{flag=1;next}/^]/{flag=0}flag' Jenkinsfile |
        grep testParams |
        cut -d':' -f 2- |
        sed '/^\s*$/d' |
        sed s'/,*$//'
}

if [ -z "$1" ]; then
    help
    exit 1
fi

FERN_ARGS="$1"

# Create temporary docker file
DOCKER_FILE="Dockerfile.tmp"
cp Dockerfile.ci "${DOCKER_FILE}"
cat <<EOF >>${DOCKER_FILE}
# Copy extension directory inside of Docker as the User "node"
COPY --chown=node:node . /app/
EOF

# Build docker
echo "Building docker image"
docker build -f "${DOCKER_FILE}" -t docker-wdp-tests .
rm -frv "${DOCKER_FILE}"

case "$FERN_ARGS" in
*--extension-log*)
    EXTLOG_MOUNT=" -v $(pwd):/app/report "
    ;;
esac

# Run docker
echo "Running tests, you can connect using a vnc client to 'localhost:15900 with password vnc'"
echo "Fern config: ${FERN_ARGS}"
DOCKER_RUN="docker run --privileged --rm -t --user node --shm-size=512m  -p 15900:5900 -v $(pwd)/modules:/app/modules -v $(pwd)/platforms:/app/platforms $EXTLOG_MOUNT -w /app docker-wdp-tests ./tests/run_tests.sh $FERN_ARGS"

if type xtightvncviewer >/dev/null 2>&1; then
    ${DOCKER_RUN} &
    sleep 5
    echo vnc | xtightvncviewer -autopass localhost::15900
else
    ${DOCKER_RUN}
fi
