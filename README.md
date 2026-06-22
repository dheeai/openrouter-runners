# @dhee_ai/openrouter-runners

Dhee Cloud media runners that generate images and video through the **Dhee Cloud
media proxy** (the same hosted-media lane the ComfyUI cloud proxy uses).

This package is distribution-only. Dhee Desktop installs the package, reads the
`dhee` marker from `package.json`, and copies each runner into the user's runner
directory:

```text
<DHEE_USER_RUNNERS_DIR>/dhee-cloud-image/
<DHEE_USER_RUNNERS_DIR>/dhee-cloud-video/
```

## Runners

### `dhee.cloud.image`

Generates an image through the Dhee Cloud media proxy.

- Credentials: `DHEE_CLOUD_URL`, `DHEE_CLOUD_TOKEN`
- Optional env: `DHEE_CLOUD_IMAGE_MODEL`
- Network: `dhee.ai`, `localhost`, `127.0.0.1`
- Calls: `POST {DHEE_CLOUD_URL}/api/cloud/media/image`

### `dhee.cloud.video`

Generates a video clip through the Dhee Cloud media proxy (image-to-video
supported via `firstFrameInput` / `firstFramePath` / `firstFrameUrl`).

- Credentials: `DHEE_CLOUD_URL`, `DHEE_CLOUD_TOKEN`
- Optional env: `DHEE_CLOUD_VIDEO_MODEL`
- Network: `dhee.ai`, `localhost`, `127.0.0.1`
- Calls: `POST {DHEE_CLOUD_URL}/api/cloud/media/video`

## How the cloud lane works

The runners never call `openrouter.ai` directly and never hold an
`OPENROUTER_API_KEY`. They call the Dhee Cloud proxy with the user's
`DHEE_CLOUD_TOKEN` (the desktop JWT). The proxy authenticates the user, checks
hosted-media entitlements, records usage, and forwards the request server-side
using its own provider key. This mirrors the ComfyUI cloud proxy pattern.

## Validation

Run the package validation from the repository root:

```sh
npm --workspace @dhee_ai/openrouter-runners test
```

Or run it inside this package:

```sh
npm test
```
