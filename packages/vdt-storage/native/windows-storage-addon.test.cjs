const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const [addonPath, privateRoot] = process.argv.slice(2);
assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
assert.equal(process.version, "v24.22.2");
const addon = require(addonPath);
const session = addon.open(privateRoot);
const name = "addon-proof.dat";
const bytes = Buffer.from("vdt storage addon");
try {
  assert.throws(() => addon.flush({}), { code: "EBADF" });
  assert.throws(() => addon.writeExclusive(session, "../outside.dat", bytes), { code: "EINVAL" });
  addon.writeExclusive(session, name, bytes);
  assert.deepEqual(fs.readFileSync(path.join(privateRoot, name)), bytes);
  assert.throws(() => addon.writeExclusive(session, name, Buffer.from("collision")), { code: "EEXIST" });
  assert.deepEqual(fs.readFileSync(path.join(privateRoot, name)), bytes);
  assert.throws(() => addon.writeExclusive(session, "CON.txt", bytes), { code: "EINVAL" });
  assert.throws(() => addon.writeExclusive(session, "embedded\0NUL", bytes), { code: "EINVAL" });
  const link = path.join(privateRoot, "alias.dat");
  fs.linkSync(path.join(privateRoot, name), link);
  assert.throws(() => addon.unlink(session, name), { code: "EACCES" });
  fs.unlinkSync(link);
  addon.unlink(session, name);
  assert.equal(fs.existsSync(path.join(privateRoot, name)), false);
  assert.throws(() => addon.unlink(session, name), { code: "ENOENT" });
  addon.flush(session);
  assert.throws(() => fs.renameSync(privateRoot, privateRoot + ".moved"));
} finally {
  addon.close(session);
}
addon.close(session);
assert.throws(() => addon.flush(session), { code: "EBADF" });
assert.throws(() => addon.open(path.dirname(privateRoot)), { code: "EACCES" });
const alias = path.join(privateRoot, "junction");
fs.symlinkSync(privateRoot, alias, "junction");
assert.throws(() => addon.open(path.join(alias, "nested")));
fs.unlinkSync(alias);
console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, node: process.version, assertionsPassed: true }));
