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

  // Review finding: the filename group used to be `(.+)`, which matches "/". MediaConvert
  // derives the output object's name from the input's BASE name only, so a masterKey with
  // extra path segments in its tail would make the recorded expected_output_key diverge from
  // the object MediaConvert actually writes — and the callback's existence check would then
  // fail a job that, from AWS's side, genuinely succeeded.
  it("rejects a master key whose filename segment itself contains a slash", () => {
    expect(() => proxyOutputKey("orgs/o/titles/t/master/u/a/b/c.mov")).toThrow();
  });

  // Same regex fix, the other named hazard: the comment above proxyOutputKey promises a
  // traversal string throws. `(.+)` would have let a ".." tail through the parse (it never
  // rejects a slash), so this pins that promise directly against the exact traversal shape
  // named in the review, not just the bare "../../etc/passwd" case already covered above.
  it("rejects a master key with a path-traversal filename tail", () => {
    expect(() => proxyOutputKey("orgs/o/titles/t/master/u/../../../evil.mov")).toThrow();
  });

  // Review finding: pin the derivation against REAL lowercase UUIDs (not the human-readable
  // "org-1"/"title-1" shorthand used everywhere else in this file), and assert the shape the
  // database side (create_transcode_job's `expected_output_key LIKE
  // 'orgs/<org>/titles/<title>/screener/%'` check) actually requires — so the two halves of
  // this contract are pinned against the same real shape, not agreeing only by construction.
  it("derives a key that satisfies create_transcode_job's own scope check, using real UUIDs", () => {
    const orgId = "3f2b6c1a-9d4e-4a7b-8c3d-1e5f7a9b2c4d";
    const titleId = "7a1c9e3b-2d4f-4b6a-9c8e-0f1a2b3c4d5e";
    const uuid = "b4e6d8a0-1c3e-4f5a-8b7c-9d0e1f2a3b4c";
    const masterKey = `orgs/${orgId}/titles/${titleId}/master/${uuid}/reel.mov`;

    const o = proxyOutputKey(masterKey);

    expect(o.expectedKey.startsWith(`orgs/${orgId}/titles/${titleId}/screener/`)).toBe(true);
    expect(o.destination).toBe(`orgs/${orgId}/titles/${titleId}/screener/${uuid}/`);
    expect(o.expectedKey).toBe(`orgs/${orgId}/titles/${titleId}/screener/${uuid}/reel_screener.mp4`);
  });

  // Review finding: stripExtension(".mov") used to return "", producing a leading-underscore
  // name ("<uuid>/_screener.mp4") that hides the source filename entirely. A dotfile-only
  // name has no basename to keep, so the fix leaves it untouched instead of stripping it away.
  it("does not produce an empty basename for a dotfile-only master filename", () => {
    const o = proxyOutputKey("orgs/o/titles/t/master/u/.mov");
    expect(o.expectedKey).toBe("orgs/o/titles/t/screener/u/.mov_screener.mp4");
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

  // Review finding (CRITICAL): RateControlMode VBR was paired with MaxBitrate, which the AWS
  // SDK's own doc string says is "Required when Rate control mode is QVBR" — a QVBR concept,
  // not VBR's. VBR's companion is a flat average Bitrate. This pins the reconciled shape
  // (QVBR + MaxBitrate + QvbrSettings.QvbrQualityLevel) — the one combination actually proven
  // against real AWS in docs/infra/screener-proxy-setup.md's end-to-end verification step —
  // against regressing back to the unproven VBR+MaxBitrate pairing.
  it("encodes with QVBR rate control and its documented companion fields, not VBR+MaxBitrate", () => {
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b" }) as never as {
      OutputGroups: {
        Outputs: {
          VideoDescription: {
            Width?: number;
            Height?: number;
            CodecSettings: {
              H264Settings: {
                RateControlMode: string;
                MaxBitrate: number;
                QvbrSettings: { QvbrQualityLevel: number };
                Bitrate?: number;
              };
            };
          };
        }[];
      }[];
    };
    const h264 = s.OutputGroups[0].Outputs[0].VideoDescription.CodecSettings.H264Settings;
    expect(h264.RateControlMode).toBe("QVBR");
    expect(h264.MaxBitrate).toBe(2500000);
    expect(h264.QvbrSettings.QvbrQualityLevel).toBe(7);
    expect(h264.Bitrate).toBeUndefined();
  });

  // Review finding: a hardcoded Width/Height of 1920x1080 upscales any master shot below
  // 1080p and pillarboxes anything not already 16:9. VideoDescription.Height's own SDK doc
  // string says omitting both Width and Height is how you ask MediaConvert to use the
  // source's own resolution.
  it("does not force an output resolution, letting the source's own resolution drive", () => {
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b" }) as never as {
      OutputGroups: { Outputs: { VideoDescription: { Width?: number; Height?: number } }[] }[];
    };
    const video = s.OutputGroups[0].Outputs[0].VideoDescription;
    expect(video.Width).toBeUndefined();
    expect(video.Height).toBeUndefined();
  });

  // Review finding: mediaconvert.ts used to call proxyOutputKey() once for expectedKey and
  // buildProxyJobSettings called it again internally, deriving the same destination twice.
  // The optional `output` param lets a caller pass its own already-derived value through
  // instead — this pins that passing a DIFFERENT (deliberately wrong) precomputed output
  // actually changes the destination, proving the param is consulted rather than ignored.
  it("uses a precomputed `output` instead of re-deriving one when the caller supplies it", () => {
    const precomputed = { destination: "orgs/x/titles/y/screener/z/", nameModifier: "_screener", expectedKey: "unused" };
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b", output: precomputed }) as never as {
      OutputGroups: { OutputGroupSettings: { FileGroupSettings: { Destination: string } } }[];
    };
    expect(s.OutputGroups[0].OutputGroupSettings.FileGroupSettings.Destination).toBe(
      "s3://b/orgs/x/titles/y/screener/z/",
    );
  });
});
