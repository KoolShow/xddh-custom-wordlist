export { installWebpackInterceptor } from './webpack/chunk';
export { installResourceObserver } from './webpack/resource';
export { state } from './webpack/state';
export { applyStoredWordListToCurrentTarget } from './webpack/target';

import { state } from './webpack/state';
import { pageWindow } from './window-env';
import './webpack/target';

Object.assign(pageWindow, { __xddhWebpackHook: state });
