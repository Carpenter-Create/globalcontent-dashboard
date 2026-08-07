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
const MASTER_KEY = /^orgs\/([^/]+)\/titles\/([^/]+)\/master\/([^/]+)\/(.+)$/;

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
function stripExtension(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
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

export function buildProxyJobSettings(input: { masterKey: string; bucket: string }): Record<string, unknown> {
  const { masterKey, bucket } = input;
  const { destination, nameModifier } = proxyOutputKey(masterKey);

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
              Width: 1920,
              Height: 1080,
              ScalingBehavior: "DEFAULT",
              CodecSettings: {
                Codec: "H_264",
                H264Settings: {
                  RateControlMode: "VBR",
                  Bitrate: 2500000, // ~2.5 Mbps — small enough to stream, big enough to evaluate
                  MaxBitrate: 3000000,
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
