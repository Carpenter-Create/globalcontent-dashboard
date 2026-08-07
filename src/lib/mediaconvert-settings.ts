// Pure derivation of the MediaConvert output location and job Settings for the screener
// proxy. No AWS SDK import here on purpose — this is the part of the pipeline that decides
// WHERE we are about to write and WHAT we encode, and both are worth unit-testing without a
// network client or credentials anywhere nearby. `src/lib/mediaconvert.ts` (Task 4) is the
// thin, untested-by-necessity shell that actually calls AWS.

// Anchored to assetKey()'s exact layout (src/lib/assets.ts):
//   orgs/<org>/titles/<title>/<kind>/<uuid>/<filename>
// Anchored (^...$) and kind-locked to "master" deliberately: proxyOutputKey's return value is
// about to become an S3 write destination AND the `expected_output_key` the database scope-
// checks (create_transcode_job requires it start with orgs/<org>/titles/<title>/screener/). A
// permissive parse here — accepting a screener key, a path with extra segments, or garbage —
// would either resolve to a surprising place or fail the DB check with a confusing error far
// from the actual mistake. Fail here, immediately, on the input.
//
// The filename group is `[^/]+`, NOT `.+`: assetKey() never puts a "/" in its filename
// segment (it's sanitized to `[A-Za-z0-9._-]`), so a master key containing one is either
// corrupt or adversarial. `.+` would accept both `orgs/o/titles/t/master/u/a/b/c.mov` (which
// this function would then derive `.../screener/u/c_screener.mp4` for, while MediaConvert —
// which names outputs from the input's BASE name only — actually writes
// `.../screener/u/c_screener.mp4` too, but ONLY if the fake nested-path prefix "a/b/" never
// reaches S3 as a literal object-key segment; in the one case that matters here, a masterKey
// with extra "/" in the tail, the `expected_output_key` we'd record and the object MediaConvert
// actually produces can diverge in exactly the way that fails the callback's existence check)
// and `orgs/o/titles/t/master/u/../../../evil.mov` (a `..` traversal the comment below already
// promises to reject). Anchoring the filename to a single non-slash segment rejects both at
// the parse, before either has a chance to produce a surprising key.
const MASTER_KEY = /^orgs\/([^/]+)\/titles\/([^/]+)\/master\/([^/]+)\/([^/]+)$/;

export interface ProxyOutputKey {
  /** The S3 "directory" MediaConvert's FileGroupSettings writes into, trailing slash included. */
  destination: string;
  /** MediaConvert's NameModifier — appended to the input's base filename by the service itself. */
  nameModifier: string;
  /** The full key we expect the output to land at. Recorded in transcode_jobs BEFORE submit. */
  expectedKey: string;
}

// Strip the master's extension only — keeps "The Long Quiet" from "The Long Quiet.mov" so the
// screener isn't misleadingly named "*.mov_screener.mp4".
//
// Requires at least one character before the final dot (`^(.+)\.[^./]+$`, not a bare
// `\.[^./]+$` trim): a dotfile-only name like ".mov" has no basename to keep, so the naive
// trim returned "", producing "<uuid>/_screener.mp4" — a leading-underscore name traceable
// only by its uuid folder. With no basename to strip, this leaves the filename untouched
// (".mov_screener.mp4"): uglier than a normal name, but never empty.
function stripExtension(filename: string): string {
  const match = /^(.+)\.[^./]+$/.exec(filename);
  return match ? match[1] : filename;
}

export function proxyOutputKey(masterKey: string): ProxyOutputKey {
  const match = MASTER_KEY.exec(masterKey);
  if (!match) {
    throw new Error(`proxyOutputKey: not a master asset key: ${JSON.stringify(masterKey)}`);
  }
  const [, orgId, titleId, uuid, filename] = match;
  const destination = `orgs/${orgId}/titles/${titleId}/screener/${uuid}/`;
  const nameModifier = "_screener";
  const baseName = stripExtension(filename);
  const expectedKey = `${destination}${baseName}${nameModifier}.mp4`;
  return { destination, nameModifier, expectedKey };
}

export function buildProxyJobSettings(input: {
  masterKey: string;
  bucket: string;
  // Callers that already derived proxyOutputKey() for their own purposes (mediaconvert.ts
  // needs `expectedKey` to record in transcode_jobs) pass it through here so the key is
  // derived exactly once per job, not twice. Optional and re-derived from masterKey when
  // absent, so this stays a single-argument pure function for unit tests and any other
  // caller that only wants the job Settings.
  output?: ProxyOutputKey;
}): Record<string, unknown> {
  const { masterKey, bucket } = input;
  const { destination, nameModifier } = input.output ?? proxyOutputKey(masterKey);

  return {
    Inputs: [
      {
        FileInput: `s3://${bucket}/${masterKey}`,
        AudioSelectors: {
          "Audio Selector 1": { DefaultSelection: "DEFAULT" },
        },
        VideoSelector: {},
        TimecodeSource: "ZEROBASED",
      },
    ],
    OutputGroups: [
      {
        Name: "File Group",
        OutputGroupSettings: {
          Type: "FILE_GROUP_SETTINGS",
          FileGroupSettings: {
            Destination: `s3://${bucket}/${destination}`,
          },
        },
        Outputs: [
          {
            NameModifier: nameModifier,
            ContainerSettings: {
              Container: "MP4",
              Mp4Settings: {
                // Moves the moov atom to the front so playback (and CloudFront range
                // requests, which is how the portal serves everything) can start before
                // the whole file has downloaded — the entire point of a "viewing proxy".
                CslgAtom: "INCLUDE",
                FreeSpaceBox: "EXCLUDE",
                MoovPlacement: "PROGRESSIVE_DOWNLOAD",
              },
            },
            VideoDescription: {
              // No Width/Height/ScalingBehavior: VideoDescription.Height's own SDK doc string
              // ("To use the same resolution as your input: Leave both Width and Height
              // blank" — models_0.d.ts:7185) says omitting both is how you ask for
              // source-driven output, not a fallback behavior. A hardcoded 1920x1080 upscales
              // any master shot below 1080p (cost with zero quality gain — you cannot recover
              // detail that was never captured) and pillarboxes/stretches anything not already
              // 16:9. This is a review proxy: it needs to play, not to be a fixed shape.
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  // QVBR, not VBR — reconciled against the runbook's proven job, not
                  // re-derived. Two independent SDK doc strings say these fields don't pair:
                  // MaxBitrate's own doc reads "Required when Rate control mode is QVBR"
                  // (models_0.d.ts:5525), and Bitrate's (the VBR/CBR companion) reads
                  // "Required for VBR and CBR" (models_0.d.ts:5420) — VBR's companion is a flat
                  // average Bitrate, never MaxBitrate. Sending VBR+MaxBitrate either gets
                  // rejected with a ValidationException (silent forever, since Task 4 swallows
                  // submit errors so an upload never fails) or gets ignored, making the "3 Mbps
                  // cap" this comment used to claim dead config.
                  //
                  // This exact combination — RateControlMode QVBR, MaxBitrate 2500000,
                  // QvbrSettings.QvbrQualityLevel 7 — is also the ONE shape actually proven
                  // against real AWS: docs/infra/screener-proxy-setup.md's end-to-end
                  // verification step submitted it by hand and confirmed the job completed and
                  // an object landed at the expected key. Values are copied from that proven
                  // job, not re-derived: MaxBitrate 2500000 (~2.5 Mbps cap — small enough to
                  // stream, big enough to evaluate) and QvbrQualityLevel 7 (the runbook's own
                  // "reasonable mid-high default for a review proxy, not a tuned production
                  // value"). No standalone `Bitrate` field: it's VBR/CBR's companion, not
                  // QVBR's, and would be dead weight here.
                  RateControlMode: "QVBR",
                  MaxBitrate: 2500000,
                  QvbrSettings: { QvbrQualityLevel: 7 },
                  QualityTuningLevel: "SINGLE_PASS",
                  CodecProfile: "MAIN",
                  CodecLevel: "AUTO",
                },
              },
            },
            AudioDescriptions: [
              {
                CodecSettings: {
                  Codec: "AAC",
                  // Audited for the same class of bug as H264Settings above: AacSettings has
                  // its own RateControlMode (CBR/VBR), and VBR's companion there is VbrQuality,
                  // not Bitrate (models_0.d.ts:127 / :152). Neither is set here, so AAC falls
                  // back to its documented default rate control, which pairs correctly with
                  // the flat Bitrate this DOES set — no mismatch to fix. Mp4Settings audited
                  // too: CttsVersion 1 requires CslgAtom INCLUDE (models_0.d.ts:4897), but
                  // CttsVersion is never set here, so that pairing doesn't apply either.
                  AacSettings: {
                    Bitrate: 128000,
                    CodingMode: "CODING_MODE_2_0",
                    SampleRate: 48000,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
