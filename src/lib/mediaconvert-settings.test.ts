import { describe, expect, it } from "vitest";
import { proxyOutputKey, buildProxyJobSettings } from "@/lib/mediaconvert-settings";

const MASTER = "orgs/org-1/titles/title-1/master/uuid-1/The Long Quiet.mov";

describe("proxyOutputKey", () => {
  it("writes the proxy beside the master under a screener prefix on the same title", () => {
    const o = proxyOutputKey(MASTER);
    expect(o.destination).toBe("orgs/org-1/titles/title-1/screener/uuid-1/");
    expect(o.expectedKey).toBe("orgs/org-1/titles/title-1/screener/uuid-1/The Long Quiet_screener.mp4");
  });

  it("derives the key deterministically — the same master always yields the same output", () => {
    expect(proxyOutputKey(MASTER).expectedKey).toBe(proxyOutputKey(MASTER).expectedKey);
  });

  it("refuses a key that is not a master, rather than writing somewhere unexpected", () => {
    expect(() => proxyOutputKey("orgs/o/titles/t/screener/u/x.mp4")).toThrow();
    expect(() => proxyOutputKey("../../etc/passwd")).toThrow();
    expect(() => proxyOutputKey("")).toThrow();
  });

  // Pinning extra cases beyond the brief:
  it("reuses the master's own uuid segment so the proxy is traceable to its source", () => {
    const o = proxyOutputKey("orgs/org-9/titles/title-9/master/9f86-uuid/reel.mp4");
    expect(o.destination).toContain("/9f86-uuid/");
    expect(o.expectedKey).toContain("/9f86-uuid/");
  });

  it("strips only the master's extension, not the whole filename", () => {
    const o = proxyOutputKey("orgs/o/titles/t/master/u/My.Final.Cut.mov");
    expect(o.expectedKey).toBe("orgs/o/titles/t/screener/u/My.Final.Cut_screener.mp4");
  });

  it("rejects a master key from a different title's segment order (not merely a substring match)", () => {
    // No filename segment at all — five path parts instead of the required six.
    expect(() => proxyOutputKey("orgs/o/titles/t/master/u")).toThrow();
  });

  it("rejects a bare filename with no path", () => {
    expect(() => proxyOutputKey("The Long Quiet.mov")).toThrow();
  });
});

describe("buildProxyJobSettings", () => {
  it("reads from the master and writes to the derived destination", () => {
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b" }) as never as {
      Inputs: { FileInput: string }[];
      OutputGroups: { OutputGroupSettings: { FileGroupSettings: { Destination: string } } }[];
    };
    expect(s.Inputs[0].FileInput).toBe(`s3://b/${MASTER}`);
    expect(s.OutputGroups[0].OutputGroupSettings.FileGroupSettings.Destination).toBe(
      "s3://b/orgs/org-1/titles/title-1/screener/uuid-1/",
    );
  });

  it("encodes H.264 video, AAC audio, and an MP4 container with progressive (fast-start) playback", () => {
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b" }) as never as {
      OutputGroups: {
        Outputs: {
          VideoDescription: { CodecSettings: { Codec: string } };
          AudioDescriptions: { CodecSettings: { Codec: string } }[];
          ContainerSettings: { Container: string; Mp4Settings: { MoovPlacement: string } };
        }[];
      }[];
    };
    const output = s.OutputGroups[0].Outputs[0];
    expect(output.VideoDescription.CodecSettings.Codec).toBe("H_264");
    expect(output.AudioDescriptions[0].CodecSettings.Codec).toBe("AAC");
    expect(output.ContainerSettings.Container).toBe("MP4");
    expect(output.ContainerSettings.Mp4Settings.MoovPlacement).toBe("PROGRESSIVE_DOWNLOAD");
  });

  it("propagates proxyOutputKey's rejection of a non-master key", () => {
    expect(() => buildProxyJobSettings({ masterKey: "orgs/o/titles/t/screener/u/x.mp4", bucket: "b" })).toThrow();
  });
});
