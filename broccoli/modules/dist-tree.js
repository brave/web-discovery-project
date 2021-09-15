/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const path = require("path");
const Funnel = require("broccoli-funnel");
const MergeTrees = require("broccoli-merge-trees");
const broccoliSource = require("broccoli-source");

const buildConfig = require("../config");
const env = require("../env");

const subprojects = require(path.resolve(
  __dirname,
  "../../configs/common/subprojects/bundles"
));

const UnwatchedDir = broccoliSource.UnwatchedDir;

module.exports = function getDistTree(modulesTree) {
  const exclude = ["**/dist/locale/**/*"]; // remove translations;

  if (!env.DEBUG_PAGES) {
    exclude.push("**/dist/debug/**/*"); // remove debug pages
  }

  const modulesTrees = [
    new Funnel(modulesTree, {
      include: buildConfig.modules.map((name) => `${name}/dist/**/*`),
      exclude,
      getDestinationPath(_path) {
        return _path.replace("/dist", "");
      },
    }),
  ];

  const suprojectsSet = new Set();
  const getSubprojects = (moduleName) => {
    try {
      const { subprojects = [] } = require(path.resolve(
        __dirname,
        `../../modules/${moduleName}/build-config`
      ));
      subprojects.forEach((project) => {
        suprojectsSet.add(project);
      });
    } catch (error) {
      // this error is expected, because not all the modules have 'build-config.json'
    }
  };

  buildConfig.modules.forEach((mod) => {
    getSubprojects(mod);
  });

  buildConfig.subprojects = subprojects(Array.from(suprojectsSet));

  const distTrees = modulesTrees.concat(
    (buildConfig.subprojects || []).map(
      (subproject) =>
        new Funnel(new UnwatchedDir(subproject.src), {
          include: subproject.include || ["**/*"],
          destDir: subproject.dest,
          getDestinationPath(filename) {
            return filename
              .replace(".development", "")
              .replace(".production.min", "");
          },
        })
    )
  );

  const distTree = new MergeTrees(distTrees);

  return distTree;
};
