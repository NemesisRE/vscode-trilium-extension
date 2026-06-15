#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as tar from 'tar';
import { applyVendorPatches } from './apply-vendor-patches.mjs';

const VENDOR_DIR = path.join(process.cwd(), 'vendor');
const LOCK_PATH = path.join(process.cwd(), 'scripts', 'trilium-plugins.lock.json');

const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
const TRILIUM_REPO = lock.repo;
const TRILIUM_REF = lock.ref;
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

  // Clean and recreate each plugin directory
  for (const plugin of PLUGINS) {
    const targetDir = path.join(VENDOR_DIR, plugin);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  }

  const stream = await getWithRedirects(url);

  return new Promise((resolve, reject) => {
    extractPlugins(stream, resolve, reject);
  });
}

/**
 * Extract only the plugin directories we need from the tarball stream.
 */
function extractPlugins(stream, resolve, reject) {
  const repoPrefix = `Trilium-${TRILIUM_REF}/packages/`;
  
  stream.pipe(tar.extract({
    cwd: VENDOR_DIR,
    filter: (filepath) => {
      // Only extract files from plugin directories we care about
      return PLUGINS.some(plugin => {
        const prefix = `${repoPrefix}${plugin}/`;
        return filepath.startsWith(prefix);
      });
    },
    // Don't strip - we'll handle the path transformation in onentry
    onentry: (entry) => {
      // Transform path from 'Trilium-main/packages/ckeditor5-admonition/src/...'
      // to 'ckeditor5-admonition/src/...'
      const pathParts = entry.path.split('/');
      if (pathParts.length > 3 && pathParts[0].startsWith('Trilium-') && pathParts[1] === 'packages') {
        // Remove 'Trilium-main' and 'packages' prefix
        entry.path = pathParts.slice(2).join('/');
      }
    }
  }))
  .on('finish', () => {
    console.log('[download-plugins] ✓ All plugins extracted successfully');
    resolve();
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
