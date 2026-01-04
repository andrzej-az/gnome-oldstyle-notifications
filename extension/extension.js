import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

export default class NotificationInterceptorExtension extends Extension {
    enable() {
        this._activeNotifications = [];
        this._recentKeys = new Set();
        this._patchedSources = new Map(); // Map<Source, originalGetter>

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

        source.connect('notification-added', (src, notification) => {
            console.log(`[Interceptor] New notification added: ${notification.title}`);
            this._handleNotification(src, notification);
        });
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

        const appName = source.title || source.app?.get_name() || 'System';

        const iconName = notification.gicon ? notification.gicon.to_string() : (notification.iconName || 'dialog-information-symbolic');
        const summary = notification.title || '';
        const body = notification.bannerBody || notification.body || '';

        this._showNotification(appName, iconName, summary, body);
    }

    _showNotification(appName, iconName, summary, body) {
        const key = `${appName}:${summary}:${body}`;
        if (this._recentKeys.has(key)) return;

        this._recentKeys.add(key);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._recentKeys.delete(key);
            return GLib.SOURCE_REMOVE;
        });

        // Container
        const banner = new St.BoxLayout({
            style_class: 'custom-notification',
            vertical: false,
            reactive: true,
            track_hover: true,
        });
        banner.spacing = 15;
        banner.width = 350;

        // Icon
        const icon = new St.Icon({
            style_class: 'custom-notification-icon',
        });
        icon.icon_size = 64;

        let gicon = null;
        if (iconName) {
            try {
                if (iconName.startsWith('/')) {
                    gicon = Gio.File.new_for_path(iconName).get_icon();
                } else if (iconName.startsWith('file://')) {
                    gicon = Gio.File.new_for_uri(iconName).get_icon();
                } else {
                    icon.icon_name = iconName;
                }
            } catch (e) { }
        }

        if (gicon) icon.gicon = gicon;
        else if (!icon.icon_name) icon.icon_name = 'dialog-information-symbolic';

        banner.add_child(icon);

        // Text
        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        textBox.spacing = 5;
        banner.add_child(textBox);

        const appLabel = new St.Label({
            text: appName.toUpperCase(),
            style_class: 'custom-notification-app-name',
        });
        textBox.add_child(appLabel);

        const summaryLabel = new St.Label({
            text: summary,
            style_class: 'custom-notification-title',
        });
        textBox.add_child(summaryLabel);

        const bodyLabel = new St.Label({
            text: body,
            style_class: 'custom-notification-body',
        });
        bodyLabel.clutter_text.line_wrap = true;
        bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        textBox.add_child(bodyLabel);

        // Add to UI over everything else
        Main.layoutManager.addTopChrome(banner);
        this._activeNotifications.push(banner);

        // Initial Position (Bottom-Right, accounting for own height)
        const monitor = Main.layoutManager.primaryMonitor;
        const margin = 30;
        const [minH, natH] = banner.get_preferred_height(350); // width is 350
        const x = monitor.x + monitor.width - 380;
        const y = monitor.y + monitor.height - margin - natH;

        banner.set_position(x, y);

        // Move other notifications up to make room
        this._repositionNotifications();

        // Animation
        banner.opacity = 0;
        banner.ease({
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Dismissal
        banner.connect('button-release-event', () => {
            this._dismissNotification(banner);
        });

        // Auto-dismiss
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            if (banner && banner.get_parent())
                this._dismissNotification(banner);
            return GLib.SOURCE_REMOVE;
        });
    }

    _repositionNotifications() {
        const monitor = Main.layoutManager.primaryMonitor;
        const margin = 30;
        const spacing = 15;

        // Start from the bottom of the screen
        let currentBottomY = monitor.y + monitor.height - margin;

        // Iterate backwards (newest is last in array, should be at bottom)
        for (let i = this._activeNotifications.length - 1; i >= 0; i--) {
            const banner = this._activeNotifications[i];
            const [minH, natH] = banner.get_preferred_height(350);

            const x = monitor.x + monitor.width - 380;
            const y = currentBottomY - natH;

            banner.ease({
                x: x,
                y: y,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            // Move the bottom reference up for the next notification
            currentBottomY = y - spacing;
        }
    }

    _dismissNotification(banner) {
        if (!banner || banner._dismissing) return;
        banner._dismissing = true;

        banner.ease({
            opacity: 0,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                const index = this._activeNotifications.indexOf(banner);
                if (index > -1) {
                    this._activeNotifications.splice(index, 1);
                }
                Main.layoutManager.removeChrome(banner);
                banner.destroy();
                this._repositionNotifications();
            }
        });
    }

    disable() {
        if (this._sourceAddedId) {
            Main.messageTray.disconnect(this._sourceAddedId);
            this._sourceAddedId = null;
        }

        // Restore patches
        [...this._patchedSources.keys()].forEach(source => this._unpatchSource(source));
        this._patchedSources.clear();

        this._activeNotifications.forEach(b => b.destroy());
        this._activeNotifications = [];
    }
}
