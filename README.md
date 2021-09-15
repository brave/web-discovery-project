# Web Discovery Project

This repository contains the client (extension) code for Web Discovery Project
which runs in the Brave browser.

# Setup

```sh
$ ./update-brave.sh # only works for Linux for now
$ yarn install --frozen-lock # or npm install
$ ./update-brave.sh # Only works on Linux (downloads latest Brave release)
$ yarn start # or npm run start
```

The last command will build the extension and start Brave with the extension
loaded. Everything should work locally with this setup. By default it will rely
on the `sandbox` environment deployed on AWS.

## Documentation

For more information about the Web Discovery methodology, privacy and security
guarantees as well as examples of messages sent, visit [this README](./modules/web-discovery-project/sources/README.md).

## Manual setup

#### Yarn

```sh
$ yarn install --frozen-lock
$ yarn start:build # build extension
$ yarn start:brave # start Brave with extension loaded
```

### Npm

```sh
$ npm ci
$ npm run start:build # build extension
$ npm run start:brave # start Brave with extension loaded
```

### Caveats for MacOS

Run `npm run start-brave-env` intead of `:brave`

Which takes the brave binary from the ENV variable `BRAVE_BIN`

```
export BRAVE_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
```

### Useful commands

Open extension dev tools (burger menu > extensions > developer mode toggle > background page) then switch to console tab.

#### For `query` messages

Force updating WebDiscoveryProject patterns:
```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject.patternsLoader.resourceWatcher.forceUpdate()
```

After visiting a SERP page, force double-fetch to happen:
```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject.strictQueries.map(x=>x.tDiff=0)
```

#### For `page` messages

Open a new tab and visit `https://www.marca.com/` (or another URL, and replace the occurrences in the following commands).

Force an *active page* (tab is still open) to the database to be double-fetched...

```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject._debugRemoveFromActivePages('https://www.marca.com/')
```

After forcing this, `https://www.marca.com/` will no longer be in dict at:

```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject.state['v']
```

See URLs on database waiting to be double-fetched:

```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject.listOfUnchecked(1000000000000, 0, null, function(x) {console.log(x)})
```

Force a double-fetch of a single URL, (URL as appears in the table above, it might have been canonized)

```javascript
WDP.app.modules['web-discovery-project'].background.webDiscoveryProject.forceDoubleFetch("https://www.marca.com/")
```

### Copyright

Copyright © 2021 Brave Software. All rights reserved.
Copyright © 2014 Cliqz GmbH. All rights reserved.

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at https://mozilla.org/MPL/2.0/.
