#!/usr/bin/env node
/**
 * GitHub repo maintenance for solo-main development.
 *
 * - Closes open Dependabot PRs
 * - Protects main from force-push and deletion
 *
 * Requires: gh auth login
 * Usage: pnpm github:maintenance
 */
import { execFileSync } from "node:child_process";

const REPO = "aleksandrsafiullin/VDT-Studio";
const MAIN = "main";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function ensureGhAuth() {
  try {
    gh(["auth", "status"]);
  } catch {
    console.error("GitHub CLI is not authenticated. Run: gh auth login");
    process.exit(1);
  }
}

function closeDependabotPullRequests() {
  const pulls = ghJson([
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "open",
    "--author",
    "app/dependabot",
    "--json",
    "number,title"
  ]);

  if (pulls.length === 0) {
    console.log("No open Dependabot PRs.");
    return;
  }

  for (const pull of pulls) {
    gh([
      "pr",
      "close",
      String(pull.number),
      "--repo",
      REPO,
      "--comment",
      "Closed: solo-main workflow; Dependabot disabled in repository."
    ]);
    console.log(`Closed #${pull.number}: ${pull.title}`);
  }
}

function protectMainBranch() {
  gh([
    "api",
    "-X",
    "PUT",
    `repos/${REPO}/branches/${MAIN}/protection`,
    "-F",
    "required_status_checks=",
    "-F",
    "enforce_admins=false",
    "-F",
    "required_pull_request_reviews=",
    "-F",
    "restrictions=",
    "-F",
    "allow_force_pushes=false",
    "-F",
    "allow_deletions=false"
  ]);
  console.log(`Branch protection enabled on ${MAIN}: force-push and deletion blocked.`);
}

ensureGhAuth();
closeDependabotPullRequests();
protectMainBranch();
console.log("GitHub maintenance complete.");
