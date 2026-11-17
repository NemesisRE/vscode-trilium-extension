#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import * as tar from 'tar';
import { applyVendorPatches } from './apply-vendor-patches.mjs';

const VENDOR_DIR = path.join(process.cwd(), 'vendor');
const LOCK_PATH = path.join(process.cwd(), 'scripts', 'trilium-plugins.lock.json');

const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
const TRILIUM_REPO = lock.repo;
const TRILIUM_REF = lock.ref;
const TRILIUM_SHA256 = lock.sha256;
const PLUGINS = lock.plugins;
const DOWNLOAD_RETRIES = Number.parseInt(process.env.TRILIUM_PLUGIN_DOWNLOAD_RETRIES ?? '4', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.TRILIUM_PLUGIN_DOWNLOAD_TIMEOUT_MS ?? '45000', 10);
const BACKOFF_BASE_MS = Number.parseInt(process.env.TRILIUM_PLUGIN_DOWNLOAD_BACKOFF_MS ?? '1500', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getWithRedirects(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const { statusCode, headers } = response;

      if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && headers.location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error('Too many redirects while downloading Trilium tarball.'));
          return;
        }
        resolve(getWithRedirects(headers.location, redirectsRemaining - 1));
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download: ${statusCode}`));
        return;
      }

      resolve(response);
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    request.on('error', reject);
  });
}

function isRetryableError(error) {
  const code = error?.code;
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) {
    return true;
  }

  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('timed out') || message.includes('socket hang up') || message.includes('network');
}

async function downloadAllPluginsWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(`[download-plugins] Retry attempt ${attempt}/${DOWNLOAD_RETRIES}...`);
      }
      await downloadAllPlugins();
      return;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < DOWNLOAD_RETRIES && isRetryableError(error);
      if (!canRetry) {
        throw error;
      }

      const backoffMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      console.warn(`[download-plugins] Attempt ${attempt} failed (${error.message}). Retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

/**
 * Downloads the entire Trilium repository tarball once and extracts all plugins.
 */
async function downloadAllPlugins() {
  const url = `https://github.com/${TRILIUM_REPO}/archive/${TRILIUM_REF}.tar.gz`;
  
  console.log(`[download-plugins] Downloading Trilium repository tarball...`);

  // Create vendor directory if it doesn't exist
  if (!fs.existsSync(VENDOR_DIR)) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
  }

  // Clean the consolidated CKEditor package used by current Trilium releases,
  // and the shared commons package the plugins depend on since Trilium v0.107.0.
  for (const dir of ['ckeditor5', 'commons']) {
    const targetDir = path.join(VENDOR_DIR, dir);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }
  for (const plugin of PLUGINS) {
    const legacyTargetDir = path.join(VENDOR_DIR, plugin);
    if (fs.existsSync(legacyTargetDir)) {
      fs.rmSync(legacyTargetDir, { recursive: true, force: true });
    }
  }

  const stream = await getWithRedirects(url);

  return new Promise((resolve, reject) => {
    extractPlugins(stream, resolve, reject);
  });
}

// Packages vendored whole out of the Trilium monorepo tarball, mapped from
// their monorepo path to the directory name used under vendor/.
const VENDORED_PACKAGES = {
  ckeditor5: 'ckeditor5',
  commons: 'commons',
};

/**
 * Extract only the package directories we need from the tarball stream, while
 * verifying the whole tarball's SHA-256 against the locked hash so a
 * compromised/MITM'd download can't silently vendor unexpected code.
 */
function extractPlugins(stream, resolve, reject) {
  const repoPrefixes = Object.keys(VENDORED_PACKAGES).map(
    (pkg) => `Trilium-${TRILIUM_REF}/packages/${pkg}/`,
  );
  const hash = crypto.createHash('sha256');
  let hashDone = false;
  let extractDone = false;
  let settled = false;

  const finishIfReady = () => {
    if (!hashDone || !extractDone || settled) {
      return;
    }
    settled = true;

    const actualSha256 = hash.digest('hex');
    if (TRILIUM_SHA256 && actualSha256 !== TRILIUM_SHA256) {
      const targetDir = path.join(VENDOR_DIR, 'ckeditor5');
      fs.rmSync(targetDir, { recursive: true, force: true });
      reject(new Error(
        `Downloaded Trilium tarball SHA-256 mismatch: expected ${TRILIUM_SHA256}, got ${actualSha256}. ` +
        'Refusing to use unverified vendor content.',
      ));
      return;
    }
    if (!TRILIUM_SHA256) {
      console.warn('[download-plugins] No sha256 pinned in trilium-plugins.lock.json - skipping integrity check.');
    } else {
      console.log(`[download-plugins] ✓ Tarball SHA-256 verified (${actualSha256})`);
    }
    console.log('[download-plugins] ✓ All plugins extracted successfully');
    resolve();
  };

  stream.pipe(hash).on('finish', () => {
    hashDone = true;
    finishIfReady();
  }).on('error', reject);

  stream.pipe(tar.extract({
    cwd: VENDOR_DIR,
    filter: (filepath) => {
      return repoPrefixes.some((prefix) => filepath.startsWith(prefix)) && !filepath.endsWith('/tsconfig.json');
    },
    // Don't strip - we'll handle the path transformation in onentry
    onentry: (entry) => {
      // Transform 'Trilium-<ref>/packages/<pkg>/...' to '<pkg>/...'.
      const pathParts = entry.path.split('/');
      const pkg = pathParts[2];
      if (pathParts.length > 3 && pathParts[0].startsWith('Trilium-') && pathParts[1] === 'packages' && VENDORED_PACKAGES[pkg]) {
        entry.path = [VENDORED_PACKAGES[pkg], ...pathParts.slice(3)].join('/');
      }
    }
  }))
  .on('finish', () => {
    extractDone = true;
    finishIfReady();
  })
  .on('error', reject);
}

/**
 * Main execution
 */
async function main() {
  console.log('[download-plugins] Downloading Trilium CKEditor plugins...');
  console.log(`[download-plugins] Source: ${TRILIUM_REPO}@${TRILIUM_REF}`);
  console.log(`[download-plugins] Target: ${VENDOR_DIR}`);
  console.log(`[download-plugins] Plugins: ${PLUGINS.join(', ')}`);
  console.log(`[download-plugins] Download retries: ${DOWNLOAD_RETRIES}, timeout: ${REQUEST_TIMEOUT_MS}ms`);

  try {
    await downloadAllPluginsWithRetry();
    applyVendorPatches(VENDOR_DIR, '[download-plugins]');
    console.log('[download-plugins] All plugins downloaded successfully.');
  } catch (error) {
    console.error('[download-plugins] Error:', error.message);
    process.exit(1);
  }
}

main();
