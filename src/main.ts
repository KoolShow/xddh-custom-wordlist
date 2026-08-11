import { installWordListPanel } from './panel';
import { initWordListStorage } from './storage';
import { installResourceObserver, installWebpackInterceptor } from './webpack-hook';
import { installWordButtonStyle } from './word-renderer';

installWebpackInterceptor();
installResourceObserver();
installWordListPanel();
installWordButtonStyle();
initWordListStorage();
