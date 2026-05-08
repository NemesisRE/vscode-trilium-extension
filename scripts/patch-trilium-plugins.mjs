#!/usr/bin/env node
import * as path from 'path';
import { applyVendorPatches } from './apply-vendor-patches.mjs';

const VENDOR_DIR = path.join(process.cwd(), 'vendor');

applyVendorPatches(VENDOR_DIR, '[patch-plugins]');
console.log('[patch-plugins] All patches applied.');
