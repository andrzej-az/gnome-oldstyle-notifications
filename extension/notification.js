import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class NotificationDisplay {
    constructor() {
        this._activeNotifications = [];
        this._recentKeys = new Set();
    }

    show(source, notification) {
        const appName = source.title || source.app?.get_name() || 'System';
        const startGIcon = notification.gicon || null;
        const iconName = notification.iconName || null;
        const summary = notification.title || '';
        const body = notification.bannerBody || notification.body || '';

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
        // Width is set in CSS (350px), don't override here to allow natural height
        // Icon
        const icon = new St.Icon({
            style_class: 'custom-notification-icon',
        });
        icon.icon_size = 64;

        let finalGIcon = startGIcon;

        // If no direct GIcon, try to resolve from iconName (paths/URIs)
        if (!finalGIcon && iconName) {
            try {
                if (iconName.startsWith('/')) {
                    finalGIcon = Gio.File.new_for_path(iconName).get_icon();
                } else if (iconName.startsWith('file://')) {
                    finalGIcon = Gio.File.new_for_uri(iconName).get_icon();
                }
            } catch (e) { }
        }

        if (finalGIcon) {
            icon.gicon = finalGIcon;
            banner.add_child(icon);
        } else if (iconName) {
            icon.icon_name = iconName;
            banner.add_child(icon);
        }

        // Text
        const textBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
            y_align: Clutter.ActorAlign.START, // Align to top
        });
        textBox.spacing = 5;
        banner.add_child(textBox);

        // App Header (Small Icon + App Name)
        const appHeader = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });
        appHeader.spacing = 5;

        // Try to get app icon
        let appGIcon = null;
        if (source.icon) appGIcon = source.icon;
        else if (source.app && source.app.get_icon()) appGIcon = source.app.get_icon();
        else if (source.app && source.app.get_app_info() && source.app.get_app_info().get_icon()) appGIcon = source.app.get_app_info().get_icon();

        if (appGIcon) {
            const appIcon = new St.Icon({
                gicon: appGIcon,
                icon_size: 16
            });
            appHeader.add_child(appIcon);
        }

        const appLabel = new St.Label({
            text: appName.toUpperCase(),
            style_class: 'custom-notification-app-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        appHeader.add_child(appLabel);

        textBox.add_child(appHeader);

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
        bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        // Explicitly set width in JS to ensure layout engine wraps before height calc
        // bodyLabel.width = 230;
        textBox.add_child(bodyLabel);

        // Add to UI over everything else
        Main.layoutManager.addTopChrome(banner);
        this._activeNotifications.push(banner);

        const monitor = Main.layoutManager.primaryMonitor;
        const margin = 30;

        const [minH, natH] = banner.get_preferred_height(350); // width is 350
        banner.height = natH;

        const x = monitor.x + monitor.width - 380;
        const y = monitor.y + monitor.height - margin - natH;

        banner.set_position(x, y);

        // Notify height changes (e.g. text wrapping) -> reposition
        banner.connect('notify::height', () => {
            this._reposition();
        });

        // Ensure it's correctly placed after the first layout pass
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._reposition();
            return GLib.SOURCE_REMOVE;
        });

        // Move other notifications up to make room
        this._reposition();

        // Animation
        banner.opacity = 0;
        banner.ease({
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Dismissal
        banner.connect('button-release-event', () => {
            this._dismiss(banner);
        });

        // Auto-dismiss
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            if (banner && banner.get_parent())
                this._dismiss(banner);
            return GLib.SOURCE_REMOVE;
        });
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        const margin = 30;
        const spacing = 15;

        // Start from the bottom of the screen
        let currentBottomY = monitor.y + monitor.height - margin;

        // Iterate backwards (newest is last in array, should be at bottom)
        for (let i = this._activeNotifications.length - 1; i >= 0; i--) {
            const banner = this._activeNotifications[i];
            const [minH, natH] = banner.get_preferred_height(350);

            // Ensure height is up to date
            banner.height = natH;

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

    _dismiss(banner) {
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
                this._reposition();
            }
        });
    }

    destroy() {
        this._activeNotifications.forEach(b => b.destroy());
        this._activeNotifications = [];
    }
}
