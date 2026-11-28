import { describe, expect, it } from "vitest";
import { describeCodexSubscriptionSpeech, discoverCodexSpeechProtocol } from "./codex-subscription-capability";

const version = "0.171.0-alpha.13.2";
const banner = `codex-cli ${version}\n`;
const voiceRequests = ["thread/realtime/start", "thread/realtime/appendAudio", "thread/realtime/stop"];
const schema = (...methods: string[]) => ({
  title: "ClientRequest",
  oneOf: ["initialize", "account/read", ...methods].map(method => ({ properties: { method: { enum: [method] } } }))
});

const stable = discoverCodexSpeechProtocol(banner, schema(...voiceRequests), schema(...voiceRequests));
const experimental = discoverCodexSpeechProtocol(banner, schema(), schema(...voiceRequests));
const chatgpt = { authentication: "chatgpt", accountScope: "same-host-scope", speechEntitlement: "included", speechQuota: "available" } as const;
const qualification = { cliVersion: version, accountScope: "same-host-scope", subscriptionBillingVerified: true, cancellationAndReconnectVerified: true };

describe("Codex subscription speech evidence", () => {
  it("keeps experimental requests separate from unknown account evidence", () => {
    expect(experimental).toEqual({ cliVersion: version, surface: "experimental" });
    expect(describeCodexSubscriptionSpeech(experimental, { authentication: "unknown" })).toMatchObject({
      account: { authentication: "unknown" }, availability: "experimental_protocol", canOfferSubscriptionSpeech: false,
      requiresExplicitAudioStart: true, explicitAlternatives: ["local_speech", "separate_api_billed_speech"]
    });
    expect(describeCodexSubscriptionSpeech(experimental, chatgpt, qualification).canOfferSubscriptionSpeech).toBe(false);
  });

  it("requires all three client requests and does not discover from notifications or versions alone", () => {
    expect(discoverCodexSpeechProtocol(banner, schema(), schema("thread/realtime/start"))).toMatchObject({ surface: "unsupported" });
    expect(discoverCodexSpeechProtocol(banner, schema(), undefined)).toMatchObject({ surface: "unknown" });
    expect(discoverCodexSpeechProtocol(banner, schema(), {
      ...schema(...voiceRequests), title: "ServerNotification"
    })).toMatchObject({ surface: "unknown" });
    expect(discoverCodexSpeechProtocol("codex another version", schema(...voiceRequests), schema())).toEqual({ cliVersion: null, surface: "unknown" });
  });

  it.each(["signed_out", "api_key", "other"] as const)("refuses %s as subscription proof", authentication => {
    expect(describeCodexSubscriptionSpeech(experimental, { authentication }, qualification)).toMatchObject({
      availability: "subscription_auth_unavailable", canOfferSubscriptionSpeech: false,
      explicitAlternatives: ["local_speech", "separate_api_billed_speech"]
    });
  });

  it("stops the voice offer on known entitlement or speech-quota failures", () => {
    expect(describeCodexSubscriptionSpeech(experimental, { ...chatgpt, speechEntitlement: "unavailable" })).toMatchObject({
      availability: "entitlement_unavailable", canOfferSubscriptionSpeech: false
    });
    expect(describeCodexSubscriptionSpeech(experimental, { ...chatgpt, speechQuota: "exhausted" })).toMatchObject({
      availability: "quota_exhausted", canOfferSubscriptionSpeech: false,
      explicitAlternatives: ["local_speech", "separate_api_billed_speech"]
    });
  });

  it("requires stable protocol, explicit speech evidence and live qualification for the same CLI build", () => {
    expect(describeCodexSubscriptionSpeech(stable, { ...chatgpt, speechEntitlement: "unknown" }).availability).toBe("entitlement_unknown");
    expect(describeCodexSubscriptionSpeech(stable, { ...chatgpt, speechQuota: "unknown" }).availability).toBe("quota_unknown");
    expect(describeCodexSubscriptionSpeech(stable, chatgpt, { ...qualification, cliVersion: "0.0.0" }).availability).toBe("live_qualification_required");
    expect(describeCodexSubscriptionSpeech(stable, chatgpt, { ...qualification, accountScope: "other-workspace" }).availability).toBe("live_qualification_required");
    expect(describeCodexSubscriptionSpeech(stable, chatgpt, { ...qualification, cancellationAndReconnectVerified: false }).canOfferSubscriptionSpeech).toBe(false);
    expect(describeCodexSubscriptionSpeech(stable, chatgpt, qualification)).toMatchObject({
      availability: "available", canOfferSubscriptionSpeech: true, requiresExplicitAudioStart: true, explicitAlternatives: []
    });
  });

  it("emits safe facts even if the trusted input object carries other account fields", () => {
    const account = { ...chatgpt, email: "fixture@example.test", secret: "should never appear" };
    const result = describeCodexSubscriptionSpeech(stable, account, qualification);
    expect(result.account).toEqual({ authentication: "chatgpt", speechEntitlement: "included", speechQuota: "available" });
    expect(JSON.stringify(result)).not.toMatch(/fixture@example|should never appear|same-host-scope/);
  });

  it("has a separate documented voice stop and requires a fresh user action after disconnect", () => {
    expect(describeCodexSubscriptionSpeech(experimental, { authentication: "unknown" }).protocolLifecycle).toEqual({
      stopRequest: "thread/realtime/stop", closedNotification: "thread/realtime/closed", reconnect: "fresh_explicit_session", affectsTextRun: false
    });
    expect(describeCodexSubscriptionSpeech(discoverCodexSpeechProtocol(banner, schema(), schema()), chatgpt).protocolLifecycle).toBeNull();
  });
});
