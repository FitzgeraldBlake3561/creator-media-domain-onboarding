import assert from "node:assert/strict";
import test from "node:test";
import { nextOnboardingState } from "../src/onboarding_state.js";

test("a verified delivery domain moves the storefront from processing to ready", () => {
  const state = nextOnboardingState("processing", {
    domain: "video.shop.example",
    verified: true
  }, "completed");

  assert.equal(state, "ready");
});

test("an unfinished verification keeps creator delivery processing", () => {
  const state = nextOnboardingState("processing", {
    domain: "video.shop.example",
    verified: false
  }, "completed");

  assert.equal(state, "processing");
});

test("a verified domain waits for its media processing job", () => {
  const state = nextOnboardingState("processing", {
    domain: "video.shop.example",
    verified: true
  }, "running");

  assert.equal(state, "processing");
});
