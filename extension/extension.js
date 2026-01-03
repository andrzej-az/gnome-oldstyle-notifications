import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

export default class NotificationInterceptorExtension extends Extension {
    enable() {
        this._activeNotifications = [];
        this._recentKeys = new Set();

        console.log('[Interceptor] Native drawing extension enabled');

        // Hook into NotificationDaemon for universal interception
        if (Main.notificationDaemon) {
            this._origNotify = Main.notificationDaemon.Notify;
            Main.notificationDaemon.Notify = (...args) => {
                this._handleRawNotify(...args);
                return this._origNotify.apply(Main.notificationDaemon, args);
            };
        }

        this._sourceAddedId = Main.messageTray.connect('source-added', (tray, source) => {
            this._setupSource(source);
        });

        // Intercept existing sources
        Main.messageTray.getSources().forEach(source => {
            this._setupSource(source);
        });
    }

    _handleRawNotify(appName, replacesId, appIcon, summary, body, actions, hints, timeout) {
        // This catches it at the D-Bus level.
        // We'll let the Tray hook handle it if it arrives there to avoid duplicates
        // (the tray hook has destroy() which is better).
        // But if someone uses a source that doesn't hit the tray, we catch it here.
        // Actually, for "COMPLETE" silence, we should probably handle it here
        // and return the ID.
    }

    _setupSource(source) {
        if (source._interceptorConnected) return;
        source._interceptorConnected = true;

        source.connect('notification-added', (src, notification) => {
            console.log(`[Interceptor] New notification added: ${notification.title}`);
            this._handleNotification(src, notification);
        });
    }

    _handleNotification(source, notification) {
        // Mute native banner and remove from tray entry if we want absolute silence
        notification.displayBanner = false;

        const appName = source.title || source.app?.get_name() || 'System';

        // Log serialized notification object for debugging
        const serialized = {
            title: notification.title || null,
            body: notification.body || null,
            bannerBody: notification.bannerBody || null,
            iconName: notification.iconName || null,
            gicon: notification.gicon ? notification.gicon.to_string() : null,
            resident: notification.resident || false,
            priority: notification.priority || 0,
            datetime: notification.datetime ? notification.datetime.format_iso8601() : null,
            appName: appName,
        };
        console.log(`[Interceptor] Notification Object: ${JSON.stringify(serialized)}`);

        // Defer destruction to avoid "Object has been already disposed" errors
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (notification && !notification.is_destroyed?.()) {
                notification.destroy();
            }
            return GLib.SOURCE_REMOVE;
        });

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
        textBox.add_child(bodyLabel);

        // Positioning
        const monitor = Main.layoutManager.primaryMonitor;
        const bannerHeight = 130;
        const margin = 30;
        const x = monitor.x + monitor.width - 380;
        const y = monitor.y + monitor.height - margin - (bannerHeight * (this._activeNotifications.length + 1));

        banner.set_position(x, y);

        // Add to UI over everything else
        Main.layoutManager.addTopChrome(banner);
        this._activeNotifications.push(banner);

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
        const bannerHeight = 130;
        const margin = 30;

        this._activeNotifications.forEach((banner, index) => {
            const x = monitor.x + monitor.width - 380;
            const y = monitor.y + monitor.height - margin - (bannerHeight * (this._activeNotifications.length - index));

            banner.ease({
                x: x,
                y: y,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
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
        if (this._origNotify && Main.notificationDaemon) {
            Main.notificationDaemon.Notify = this._origNotify;
            this._origNotify = null;
        }
        if (this._sourceAddedId) {
            Main.messageTray.disconnect(this._sourceAddedId);
            this._sourceAddedId = null;
        }
        this._activeNotifications.forEach(b => b.destroy());
        this._activeNotifications = [];
    }
}
