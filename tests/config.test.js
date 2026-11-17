const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "launcher.config.json"), "utf8"));

test("launcher configuration has valid fork identity and branding", () => {
  assert.equal(config.schemaVersion, 1);
  assert.match(config.appId, /^[a-zA-Z0-9.-]+\.[a-zA-Z0-9.-]+$/);
  assert.ok(config.branding.name);
  assert.match(config.branding.accentColor, /^#[0-9a-f]{6}$/i);
  assert.match(config.branding.backgroundColor, /^#[0-9a-f]{6}$/i);
  assert.match(config.updateRepository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
});

test("builder config derives product identity and update feed from launcher config", () => {
  const build = require(path.join(root, "electron-builder.config.cjs"));
  assert.equal(build.productName, config.branding.name);
  assert.equal(build.appId, config.appId);
  assert.deepEqual(build.publish[0], {
    provider: "github",
    owner: config.updateRepository.split("/")[0],
    repo: config.updateRepository.split("/")[1]
  });
  assert.ok(build.extraResources.some(item => item.to === "launcher.config.json"));
});

test("original creator attribution remains separate from editable branding", () => {
  const provenance = require(path.join(root, "src", "provenance.js"));
  const license = fs.readFileSync(path.join(root, "LICENSE.md"), "utf8");
  assert.equal(provenance.creator, "ThornyDevil Studios");
  assert.equal(provenance.product, "Thornyx Launcher");
  assert.match(license, /Mandatory attribution/);
  assert.match(license, /Based on Thornyx Launcher, originally created by ThornyDevil Studios\./);
});
