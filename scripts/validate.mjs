import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const root = new URL('..', import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Capture the proxy URL each runner posts to.
const postedUrls = [];
const originalFetch = globalThis.fetch;

function installMockFetch({ imageArtifact, videoArtifact }) {
  globalThis.fetch = async (url, init) => {
    postedUrls.push(String(url));
    const body = init?.body ? JSON.parse(init.body) : {};
    const artifact =
      body.model && /video/i.test(String(url))
        ? videoArtifact
        : imageArtifact;
    const headers = new Headers({ 'content-type': 'application/json' });
    return new Response(JSON.stringify({ artifact, metadata: { provider: 'openrouter' } }), {
      status: 200,
      headers,
    });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---- package marker ----
const pkg = readJson(join(root, 'package.json'));
assert.equal(pkg.name, '@dhee_ai/openrouter-runners', 'package name must be @dhee_ai/openrouter-runners');
assert.equal(pkg.license, 'Apache-2.0', 'package license must be Apache-2.0');
assert.equal(pkg.dhee?.type, 'runner', 'package.json.dhee.type must be runner');
assert.deepEqual(
  pkg.dhee?.runnerDirs,
  ['./runners/dhee-cloud-image', './runners/dhee-cloud-video'],
  'package.json.dhee.runnerDirs must list both cloud runner dirs',
);
assert.deepEqual(
  pkg.keywords?.sort(),
  ['dhee', 'dhee-cloud', 'dhee-runner', 'image-generation', 'openrouter', 'video-generation'].sort(),
  'package keywords must declare dhee-runner + dhee-cloud + openrouter',
);

// ---- runner manifests ----
const RUNNERS = [
  {
    dir: 'runners/dhee-cloud-image',
    tool: 'dhee.cloud.image',
    modelEnv: 'DHEE_CLOUD_IMAGE_MODEL',
    proxyPath: '/api/cloud/media/image',
    artifact: {
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
  },
  {
    dir: 'runners/dhee-cloud-video',
    tool: 'dhee.cloud.video',
    modelEnv: 'DHEE_CLOUD_VIDEO_MODEL',
    proxyPath: '/api/cloud/media/video',
    artifact: {
      // 1-byte mp4 stub is enough to prove the decode + write path works.
      dataUrl: 'data:video/mp4;base64,AAAA',
    },
  },
];

for (const r of RUNNERS) {
  const manifestPath = join(root, r.dir, 'runner.json');
  assert.equal(existsSync(manifestPath), true, `${r.dir}/runner.json is missing`);
  const manifest = readJson(manifestPath);
  assert.equal(manifest.tool, r.tool, `${r.dir}/runner.json tool must be ${r.tool}`);
  assert.equal(manifest.version, '0.1.0', `${r.dir}/runner.json version must be 0.1.0`);
  assert.equal(
    existsSync(join(root, r.dir, 'dist/index.js')),
    true,
    `${r.dir}/dist/index.js is missing`,
  );
  assert.deepEqual(
    manifest.credentials,
    ['DHEE_CLOUD_URL', 'DHEE_CLOUD_TOKEN'],
    `${r.dir} must require DHEE_CLOUD_URL + DHEE_CLOUD_TOKEN credentials`,
  );
  assert.equal(
    Array.isArray(manifest.permissions?.network) &&
      manifest.permissions.network.includes('dhee.ai'),
    true,
    `${r.dir} must restrict network to dhee.ai (cloud proxy lane)`,
  );
  // Runners must never reach openrouter.ai directly (cloud lane invariant).
  assert.equal(
    manifest.permissions.network.includes('openrouter.ai'),
    false,
    `${r.dir} must NOT call openrouter.ai directly`,
  );
}

// ---- import + describe ----
const imageModule = await import('../runners/dhee-cloud-image/dist/index.js');
const videoModule = await import('../runners/dhee-cloud-video/dist/index.js');

assert.equal(imageModule.manifest.tool, 'dhee.cloud.image', 'image module manifest.tool mismatch');
assert.equal(videoModule.manifest.tool, 'dhee.cloud.video', 'video module manifest.tool mismatch');
assert.equal(typeof imageModule.runner.run, 'function', 'image runner.run must be a function');
assert.equal(typeof videoModule.runner.run, 'function', 'video runner.run must be a function');

const imageDescribe = imageModule.runner.describe();
const videoDescribe = videoModule.runner.describe();
assert.deepEqual(imageDescribe.capabilities, ['image-generation', 'dhee-cloud']);
assert.deepEqual(videoDescribe.capabilities, ['video-generation', 'image-to-video', 'dhee-cloud']);

// ---- missing credentials fail fast ----
const noCredsCtx = { node: { runner: { config: { outputPath: 'out.png', prompt: 'p', model: 'm' } } }, inputs: {}, projectDir: root };
delete process.env.DHEE_CLOUD_URL;
delete process.env.DHEE_CLOUD_TOKEN;
assert.equal((await imageModule.runner.run(noCredsCtx)).ok, false, 'image runner must fail without DHEE_CLOUD_URL');
assert.equal((await videoModule.runner.run(noCredsCtx)).ok, false, 'video runner must fail without DHEE_CLOUD_URL');

// ---- happy path through the cloud proxy (mocked) ----
process.env.DHEE_CLOUD_URL = 'https://dhee.cloud.test';
process.env.DHEE_CLOUD_TOKEN = 'test-jwt';

let tempRoot;
try {
  tempRoot = mkdtempSync(join(tmpdir(), 'dhee-openrouter-runners-'));
  installMockFetch({
    imageArtifact: RUNNERS[0].artifact,
    videoArtifact: RUNNERS[1].artifact,
  });
  postedUrls.length = 0;

  const imageOut = join(tempRoot, 'assets/images/openrouter.png');
  const imageResult = await imageModule.runner.run({
    node: { runner: { config: { outputPath: 'assets/images/openrouter.png', prompt: 'a keyframe', model: 'bytedance-seed/seedream-4.5' } } },
    inputs: {},
    projectDir: tempRoot,
    log: () => {},
  });
  assert.equal(imageResult.ok, true, `image run should succeed: ${imageResult.error ?? ''}`);
  assert.equal(imageResult.outputPath, 'assets/images/openrouter.png');
  assert.equal(existsSync(imageOut), true, 'image runner must write the output file');
  assert.equal(imageResult.metadata?.provider, 'dhee-cloud');
  assert.equal(imageResult.metadata?.upstreamProvider, 'openrouter');

  const videoOut = join(tempRoot, 'videos/segments/openrouter.mp4');
  const videoResult = await videoModule.runner.run({
    node: {
      runner: {
        config: {
          outputPath: 'videos/segments/openrouter.mp4',
          prompt: 'a documentary clip',
          model: 'bytedance/seedance-2.0',
          duration: 8,
        },
      },
    },
    inputs: {},
    projectDir: tempRoot,
    log: () => {},
  });
  assert.equal(videoResult.ok, true, `video run should succeed: ${videoResult.error ?? ''}`);
  assert.equal(videoResult.outputPath, 'videos/segments/openrouter.mp4');
  assert.equal(existsSync(videoOut), true, 'video runner must write the output file');
  assert.equal(videoResult.metadata?.usedFirstFrame, false, 'video run without first frame must report usedFirstFrame=false');

  // Both runners must have posted to the cloud proxy paths (not openrouter.ai).
  assert.equal(
    postedUrls.includes('https://dhee.cloud.test/api/cloud/media/image'),
    true,
    'image runner must POST to {DHEE_CLOUD_URL}/api/cloud/media/image',
  );
  assert.equal(
    postedUrls.includes('https://dhee.cloud.test/api/cloud/media/video'),
    true,
    'video runner must POST to {DHEE_CLOUD_URL}/api/cloud/media/video',
  );
  assert.equal(
    postedUrls.some((url) => url.includes('openrouter.ai')),
    false,
    'runners must never call openrouter.ai directly',
  );
} finally {
  restoreFetch();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.DHEE_CLOUD_URL;
  delete process.env.DHEE_CLOUD_TOKEN;
}

console.log('openrouter-runners package marker, runner manifests, and cloud-proxy execution are valid.');
