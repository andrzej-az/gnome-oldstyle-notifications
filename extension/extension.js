import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { NotificationDisplay } from './notification.js';

export default class NotificationInterceptorExtension extends Extension {
    enable() {
        this._display = new NotificationDisplay();
        this._patchedSources = new Map(); // Map<Source, originalGetter>
        this._signalIds = new Map(); // Map<Source, number[]>

        console.log('[Interceptor] Native drawing extension enabled');

        this._sourceAddedId = Main.messageTray.connect('source-added', (tray, source) => {
            console.log(`[Interceptor] Source added: ${source.title}`);
            this._setupSource(source);
        });

        // Intercept existing sources
        Main.messageTray.getSources().forEach(source => {
            console.log(`[Interceptor] Existing source found: ${source.title}`);
            this._setupSource(source);
        });
    }

    _setupSource(source) {
        // 1. Patch the policy to suppress native banners
        this._patchSourcePolicy(source);

        // 2. Connect to signal to show our CUSTOM banner
        if (source._interceptorConnected) return;
        source._interceptorConnected = true;

        const id = source.connect('notification-added', (src, notification) => {
            console.log(`[Interceptor] New notification added: ${notification.title}`);

            // Log serialized data if available
            try {
                if (notification._serialized && typeof notification._serialized.deepUnpack === 'function') {
                    const data = notification._serialized.deepUnpack();
                    console.log(`[Interceptor] Serialized notification data: ${JSON.stringify(data, null, 2)}`);
                }
            } catch (e) {
                console.log(`[Interceptor] Could not unpack serialized data: ${e.message}`);
            }

            // Deep recursive logging
            try {
                const serialize = (obj, depth = 0, visited = new WeakSet()) => {
                    if (depth > 5) return '[Max Depth]';
                    if (obj === null) return null;
                    if (typeof obj === 'undefined') return undefined;
                    if (typeof obj === 'function') return undefined; // Skip functions
                    if (typeof obj !== 'object') return obj;

                    if (visited.has(obj)) return '[Circular]';
                    visited.add(obj);

                    if (Array.isArray(obj)) {
                        return obj.map(item => serialize(item, depth + 1, visited)).filter(i => i !== undefined);
                    }

                    const res = {};
                    if (obj.constructor && obj.constructor.name && obj.constructor.name !== 'Object') {
                        res['_type'] = obj.constructor.name;
                    }

                    for (const key in obj) {
                        try {
                            const val = serialize(obj[key], depth + 1, visited);
                            if (val !== undefined)
                                res[key] = val;
                        } catch (e) {
                            res[key] = `<error: ${e.message}>`;
                        }
                    }

                    // Attempt to extract known GObject data that might not be enumerable
                    if (res['_type'] && res['_type'].includes('ThemedIcon') && typeof obj.get_names === 'function') {
                        res['names'] = obj.get_names();
                    }

                    return res;
                };

                const details = serialize(notification);
                console.log(`[Interceptor] Notification Details: ${JSON.stringify(details, null, 2)}`);
            } catch (e) {
                console.error(`[Interceptor] Failed to log notification details: ${e}`);
            }

            this._handleNotification(src, notification);
        });

        if (!this._signalIds.has(source))
            this._signalIds.set(source, []);
        this._signalIds.get(source).push(id);
    }

    _patchSourcePolicy(source) {
        if (!source.policy) {
            console.log(`[Interceptor] Source ${source.title} has no policy object`);
            return;
        }

        // Check if we already patched it
        if (this._patchedSources.has(source)) return;

        // "Duck typing" check: does it have a 'showBanners' property in its prototype or itself?
        let proto = source.policy;
        let descriptor = null;

        while (proto) {
            descriptor = Object.getOwnPropertyDescriptor(proto, 'showBanners');
            if (descriptor && descriptor.get) break;
            proto = Object.getPrototypeOf(proto);
        }

        if (!descriptor || !descriptor.get) {
            console.warn(`[Interceptor] Could not find showBanners getter on source policy for ${source.title}`);
            return; // Skip patching, but we still hooked the signal for custom banner
        }

        console.log(`[Interceptor] Patching policy for source: ${source.title}`);

        const originalGetter = descriptor.get;
        this._patchedSources.set(source, originalGetter);

        // Override: always return false to suppress native banners
        Object.defineProperty(source.policy, 'showBanners', {
            get: () => {
                // console.log(`[Interceptor] Blocked native banner for ${source.title}`);
                return false;
            },
            configurable: true
        });

        source.policy.notify('show-banners');
    }

    _unpatchSource(source) {
        const originalGetter = this._patchedSources.get(source);
        if (!originalGetter || !source.policy) return;

        Object.defineProperty(source.policy, 'showBanners', {
            get: originalGetter,
            configurable: true
        });

        source.policy.notify('show-banners');
        this._patchedSources.delete(source);
    }

    _handleNotification(source, notification) {
        // No need to set displayBanner = false explicitly if policy handles it,
        // but we can leave it for safety or remove it.
        // Also, we REMOVED the D-Bus injection of 'resident'.
        // If notifications disappear from tray, we might need to restore 'resident = true'
        // right here.
        notification.resident = true;

        this._display.show(source, notification);
    }

    disable() {
        if (this._sourceAddedId) {
            Main.messageTray.disconnect(this._sourceAddedId);
            this._sourceAddedId = null;
        }

        // Disconnect per-source signals and reset state
        for (const [source, ids] of this._signalIds) {
            ids.forEach(id => {
                try {
                    source.disconnect(id);
                } catch (e) { }
            });
            delete source._interceptorConnected;
        }
        this._signalIds.clear();

        // Restore patches
        [...this._patchedSources.keys()].forEach(source => this._unpatchSource(source));
        this._patchedSources.clear();

        if (this._display) {
            this._display.destroy();
            this._display = null;
        }
    }
}
