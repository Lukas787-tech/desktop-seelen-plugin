// Must come first: it installs the Tauri globals the SDK expects at import
// time. ES modules evaluate imports in declaration order, so nothing below has
// run yet when this does.
import './tauri-stub';

import { mount } from 'svelte';
import Preview from './Preview.svelte';
import '../styles/base.css';
import '../styles/motion.css';
import '../styles/modules.css';

/**
 * Entry point for the preview build.
 *
 * Not a widget: this renders the surface's default 1920x1080 arrangement with
 * every module switched on, against mock host data, so the modules can be
 * looked at (and screenshotted) without a running Seelen. `vite.config.ts`
 * swaps `src/lib/seelen.ts` for `src/preview/seelen-mock.ts` in this build and
 * this build only.
 */
const target = document.getElementById('root');
if (!target) throw new Error('#root missing');

mount(Preview, { target });
