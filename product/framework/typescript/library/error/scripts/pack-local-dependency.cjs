const fs = require("node:fs");
const path = require("node:path");

const [mode, dependencyName, requestedValue] = process.argv.slice(2);
const packageJsonPath = path.resolve("package.json");
const backupPath = path.resolve(".package.json.pack-backup");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function restoreBackup() {
  if (!fs.existsSync(backupPath)) {
    return false;
  }
  fs.copyFileSync(backupPath, packageJsonPath);
  fs.rmSync(backupPath, { force: true });
  return true;
}

if (mode === "restore") {
  restoreBackup();
  process.exit(0);
}

if (mode !== "prepare" || dependencyName === undefined || requestedValue === undefined) {
  throw new Error("Usage: pack-local-dependency.cjs prepare <dependency-name> <version|value> | restore");
}

restoreBackup();

const packageJson = readJson(packageJsonPath);
const nextValue = requestedValue === "version" ? packageJson.version : requestedValue;

if (typeof nextValue !== "string" || nextValue.length === 0) {
  throw new Error(`Cannot derive a publish dependency value for ${dependencyName}`);
}

if (packageJson.dependencies === undefined || packageJson.dependencies[dependencyName] === undefined) {
  throw new Error(`${dependencyName} is not listed in dependencies`);
}

fs.copyFileSync(packageJsonPath, backupPath);
packageJson.dependencies[dependencyName] = nextValue;
writeJson(packageJsonPath, packageJson);
