#!/usr/bin/env node
/**
 * Bump version across project files and keep productName suffix in tauri.conf.json in sync.
 *
 * Usage:
 *   node scripts/bump-version.js --inc=patch|minor|major
 *   node scripts/bump-version.js --set=1.2.3
 *
 * It updates:
 *   - src-tauri/tauri.conf.json: "version" and version shown in "productName" (after "版本V")
 *   - ui/package.json: "version"
 *   - server/package.json: "version"
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const files = {
  tauriConf: path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
  uiPkg: path.join(ROOT, 'ui', 'package.json'),
  serverPkg: path.join(ROOT, 'server', 'package.json'),
};

function readJson(file) {
  const txt = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${file}: ${e.message}`);
  }
}

function writeJson(file, obj) {
  const txt = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(file, txt, 'utf8');
}

function isValidVersion(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function incVersion(v, type) {
  const [major, minor, patch] = v.split('.').map(n => parseInt(n, 10));
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    throw new Error(`Invalid version to increment: ${v}`);
  }
  if (type === 'major') {
    return `${major + 1}.0.0`;
  } else if (type === 'minor') {
    return `${major}.${minor + 1}.0`;
  } else if (type === 'patch') {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`Unknown inc type: ${type}`);
}

function updateProductName(productName, version) {
  if (typeof productName !== 'string') return productName;
  // Replace Chinese suffix like "版本V0.1.8" with new version.
  const re = /(版本V)\d+\.\d+\.\d+/;
  if (re.test(productName)) {
    return productName.replace(re, `$1${version}`);
  }
  // If no suffix present, append one for consistency.
  return `${productName} 版本V${version}`;
}

function main() {
  const args = process.argv.slice(2);
  const setArg = args.find(a => a.startsWith('--set='));
  const incArg = args.find(a => a.startsWith('--inc='));

  let nextVersion;

  const tauriConf = readJson(files.tauriConf);
  const current = tauriConf.version;

  if (!current || !isValidVersion(current)) {
    throw new Error(`Current version in tauri.conf.json is invalid: ${String(current)}`);
  }

  if (setArg) {
    const v = setArg.split('=')[1];
    if (!isValidVersion(v)) {
      throw new Error(`--set must be a valid semver (x.y.z), got: ${v}`);
    }
    nextVersion = v;
  } else {
    const type = (incArg ? incArg.split('=')[1] : 'patch').toLowerCase();
    nextVersion = incVersion(current, type);
  }

  // Update tauri.conf.json
  tauriConf.version = nextVersion;
  tauriConf.productName = updateProductName(tauriConf.productName, nextVersion);
  writeJson(files.tauriConf, tauriConf);

  // Update ui/package.json
  try {
    const uiPkg = readJson(files.uiPkg);
    uiPkg.version = nextVersion;
    writeJson(files.uiPkg, uiPkg);
  } catch (e) {
    console.warn(`Warning: failed to update UI package.json: ${e.message}`);
  }

  // Update server/package.json
  try {
    const serverPkg = readJson(files.serverPkg);
    serverPkg.version = nextVersion;
    writeJson(files.serverPkg, serverPkg);
  } catch (e) {
    console.warn(`Warning: failed to update Server package.json: ${e.message}`);
  }

  console.log(nextVersion);
}

main();