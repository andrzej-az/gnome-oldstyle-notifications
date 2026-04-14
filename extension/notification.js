import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Layout Constants
const MARGIN_BOTTOM = 50;
const MARGIN_RIGHT = 16;
const SPACING_BETWEEN = 15;
const ANIMATION_DURATION_MS = 300;
const BANNER_SPACING = 8;
const TEXT_SPACING = 2;
const ACTIONS_SPACING = 20;

export class NotificationDisplay {
    constructor(settings) {
        this._settings = settings;
        this._activeNotifications = [];
        this._recentKeys = new Set();
    }

    _applyBoxSpacing(box, spacing) {
        if (typeof box.set_spacing === 'function') {
            box.set_spacing(spacing);
        } else {
            box.spacing = spacing;
        }
    }

    show(source, notification) {
        try {
            if (!notification) {
                console.warn('[Oldstyle Notifications] show called with null notification');
                return;
            }

            // Defensively get properties that might fail if object is disposed
            let appName = 'System';
            let summary = '';
            let body = '';
            let nTitle = '';

            try {
                nTitle = notification.title || '';
                summary = notification.title || '';
                body = (notification.bannerBody || notification.body) || '';
                if (source) {
                    appName = source.title || (source.app && source.app.get_name()) || 'System';
                }
            } catch (e) {
                console.debug(`[Oldstyle Notifications] Error accessing notification properties: ${e.message}`);
                if (e.message.indexOf('disposed') !== -1) return;
            }

            let duration = 5;
            try {
                duration = this._getDuration(appName, notification);
            } catch (e) {
                console.warn(`[Oldstyle Notifications] Error calling _getDuration: ${e.message}`);
            }

            if (duration === null)
                return;

            let startGIcon = null;
            let iconName = null;
            try {
                startGIcon = notification.gicon || null;
                iconName = notification.iconName || null;
            } catch (e) {
                console.debug(`[Oldstyle Notifications] Notification icon missing: ${e.message}`);
            }

            console.log(`[Oldstyle Notifications] Preparing banner for ${appName}: ${nTitle}`);

            const key = `${appName}:${summary}:${body}`;
            if (this._recentKeys.has(key)) return;

            this._recentKeys.add(key);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._recentKeys.delete(key);
                return GLib.SOURCE_REMOVE;
            });

            const bannerData = this._buildBanner(source, notification, appName, summary, body, startGIcon, iconName);
            const banner = bannerData.banner;

            // Interaction: Click to open/activate app
            banner.connect('button-release-event', () => {
                if (this._activeNotifications.indexOf(bannerData) === -1 || bannerData.dismissing) {
                    return Clutter.EVENT_PROPAGATE;
                }

                try {
                    if (source) {
                        if (source.app && typeof source.app.activate === 'function') {
                            console.log(`[Oldstyle Notifications] Activating window for app: ${source.app.get_name()}`);
                            source.app.activate();
                        } else if (source.app && typeof source.app.open_new_window === 'function') {
                            source.app.open_new_window(-1);
                        } else if (typeof source.open === 'function') {
                            source.open(notification);
                        }
                    }

                    if (notification && typeof notification.activate === 'function') {
                        console.log(`[Oldstyle Notifications] Invoking default notification action`);
                        notification.activate();
                    }
                } catch (e) {
                    console.error(`[Oldstyle Notifications] Error activating app: ${e.message}`);
                }

                this._dismiss(bannerData);
                return Clutter.EVENT_STOP;
            });

            this._activeNotifications.push(bannerData);
            Main.layoutManager.addTopChrome(banner);

            const monitor = Main.layoutManager.primaryMonitor;

            // Manually trigger layout to get preferred size
            const [minW, natW] = banner.get_preferred_width(-1);
            const [minH, natH] = banner.get_preferred_height(natW);

            banner.width = natW;
            banner.height = natH;

            const x = monitor.x + monitor.width - natW - MARGIN_RIGHT;
            const y = monitor.y + monitor.height - MARGIN_BOTTOM - natH;

            console.log(`[Oldstyle Notifications] Banner position: x=${x}, y=${y}, width=${natW}, height=${natH}`);
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
                duration: ANIMATION_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            if (duration > 0) {
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, duration, () => {
                    if (banner && banner.get_parent() && !bannerData.dismissing)
                        this._dismiss(bannerData);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            console.error(`[Oldstyle Notifications] Critical error in show(): ${e.message}`);
            console.error(e.stack);
        }
    }

    _buildBanner(source, notification, appName, summary, body, startGIcon, iconName) {
        const banner = new St.BoxLayout({
            style_class: 'custom-notification',
            vertical: true,
            reactive: true,
            track_hover: true,
        });

        this._applyBoxSpacing(banner, BANNER_SPACING);

        const bannerData = { banner, dismissing: false };

        banner.add_child(this._buildHeaderRow(source, appName, bannerData));
        banner.add_child(this._buildContentRow(startGIcon, iconName, summary, body));

        const actionsBox = this._buildActionsRow(notification, bannerData);
        if (actionsBox) {
            banner.add_child(actionsBox);
        }

        return bannerData;
    }

    _buildHeaderRow(source, appName, bannerData) {
        const headerBox = new St.BoxLayout({
            style_class: 'custom-notification-header-box',
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._applyBoxSpacing(headerBox, BANNER_SPACING);

        // App Icon
        let appGIcon = null;
        if (source.icon) appGIcon = source.icon;
        else if (source.app && source.app.get_icon()) appGIcon = source.app.get_icon();
        else if (source.app && source.app.get_app_info() && source.app.get_app_info().get_icon()) appGIcon = source.app.get_app_info().get_icon();

        if (appGIcon) {
            const appIcon = new St.Icon({
                gicon: appGIcon,
                icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(appIcon);
        }

        // App Name
        const appLabel = new St.Label({
            text: appName,
            style_class: 'custom-notification-app-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(appLabel);

        // Spacer to push controls to the right
        const spacer = new St.Widget({ x_expand: true });
        headerBox.add_child(spacer);

        // Close Button (X)
        const closeBtn = new St.Button({
            child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 16 }),
            style_class: 'notification-icon-button',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        closeBtn.connect('clicked', () => this._dismiss(bannerData));
        headerBox.add_child(closeBtn);

        return headerBox;
    }

    _buildContentRow(startGIcon, iconName, summary, body) {
        const contentBox = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            y_expand: true,
        });
        this._applyBoxSpacing(contentBox, 0);

        let finalGIcon = startGIcon;
        if (!finalGIcon && iconName) {
            try {
                if (iconName.startsWith('/')) {
                    finalGIcon = Gio.File.new_for_path(iconName).get_icon();
                } else if (iconName.startsWith('file://')) {
                    finalGIcon = Gio.File.new_for_uri(iconName).get_icon();
                }
            } catch (e) {
                console.debug(`[Oldstyle Notifications] Error parsing icon path: ${e.message}`);
            }
        }

        const iconWidget = new St.Icon({
            style_class: 'custom-notification-icon',
            icon_size: 48,
            y_align: Clutter.ActorAlign.START,
            x_align: Clutter.ActorAlign.CENTER,
        });

        if (finalGIcon) {
            iconWidget.gicon = finalGIcon;
            contentBox.add_child(iconWidget);
        } else if (iconName) {
            iconWidget.icon_name = iconName;
            contentBox.add_child(iconWidget);
        }

        const textBox = new St.BoxLayout({
            style_class: 'custom-notification-text-box',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });
        this._applyBoxSpacing(textBox, TEXT_SPACING);

        const summaryLabel = new St.Label({
            text: summary,
            style_class: 'custom-notification-title',
        });
        textBox.add_child(summaryLabel);

        const bodyLabel = new St.Label({
            style_class: 'custom-notification-body',
        });
        bodyLabel.clutter_text.line_wrap = true;
        bodyLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        bodyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        try {
            bodyLabel.clutter_text.set_markup(this._parseMarkup(body));
        } catch (e) {
            console.debug(`[Oldstyle Notifications] Fallback on markup parsing: ${e.message}`);
            bodyLabel.text = body;
        }

        textBox.add_child(bodyLabel);
        contentBox.add_child(textBox);

        return contentBox;
    }

    _buildActionsRow(notification, bannerData) {
        let actions = [];
        try {
            if (Array.isArray(notification.actions) && notification.actions.length > 0) {
                if (typeof notification.actions[0] === 'string') {
                    for (let i = 0; i < notification.actions.length; i += 2) {
                        actions.push({
                            id: notification.actions[i],
                            label: notification.actions[i + 1] || notification.actions[i]
                        });
                    }
                } else {
                    actions = notification.actions;
                }
            } else if (typeof notification.get_actions === 'function') {
                const actionIds = notification.get_actions() || [];
                actions = actionIds.map(id => ({
                    id,
                    label: typeof notification.get_action_label === 'function' ? notification.get_action_label(id) : id,
                }));
            }
        } catch (e) {
            console.warn(`[Oldstyle Notifications] Error retrieving actions: ${e.message}`);
        }

        const otherActions = actions.filter(a => a.id !== 'default');

        if (otherActions.length === 0) return null;

        const actionsBox = new St.BoxLayout({
            style_class: 'custom-notification-actions-box',
            vertical: false,
            x_expand: true,
        });
        this._applyBoxSpacing(actionsBox, ACTIONS_SPACING);

        const spacer = new St.Widget({ x_expand: true });
        actionsBox.add_child(spacer);

        otherActions.forEach(action => {
            const actionId = action.id;
            const label = action.label || action._label || actionId || 'Action';

            const button = new St.Button({
                style_class: 'custom-notification-action-button',
                can_focus: true,
                reactive: true,
                child: new St.Label({
                    text: label,
                    style_class: 'custom-notification-action-label',
                    y_align: Clutter.ActorAlign.CENTER,
                }),
            });

            button.connect('clicked', () => {
                console.log(`[Oldstyle Notifications] Action button clicked. Label: ${label}`);
                try {
                    if (typeof action.activate === 'function') {
                        action.activate();
                    } else if (typeof action._callback === 'function') {
                        action._callback();
                    } else if (actionId) {
                        if (typeof notification.activate === 'function') {
                            notification.activate(actionId);
                        } else if (typeof notification.invokeAction === 'function') {
                            notification.invokeAction(actionId);
                        } else {
                            notification.emit('action-invoked', actionId);
                        }
                    }
                } catch (e) {
                    console.error(`[Oldstyle Notifications] Error activating action: ${e.message}`);
                }
                this._dismiss(bannerData);
            });

            actionsBox.add_child(button);
        });

        return actionsBox;
    }

    _getDuration(appName, notification) {
        let duration = 5;

        if (!this._settings)
            return duration;

        let urgency = 1;
        try {
            urgency = notification.urgency || 1;
        } catch (e) {
            console.debug(`[Oldstyle Notifications] Notification urgency missing: ${e.message}`);
        }

        if (urgency === 0)
            duration = this._settings.get_int('duration-low');
        else if (urgency === 2)
            duration = this._settings.get_int('duration-critical');
        else
            duration = this._settings.get_int('duration-normal');

        const configs = this._settings.get_value('app-configs').recursiveUnpack();
        if (configs[appName]) {
            const [enabled, configuredDuration] = configs[appName];
            if (!enabled) {
                console.log(`[Oldstyle Notifications] Notification from ${appName} suppressed by user setting.`);
                return null;
            }
            duration = configuredDuration;
        }

        return duration;
    }

    _parseMarkup(text) {
        if (!text) return '';
        let parsed = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        parsed = parsed.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
        parsed = parsed.replace(/`([^`]+)`/g, '<tt>$1</tt>');
        parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        return parsed;
    }


    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;

        // Start from the bottom of the screen
        let currentBottomY = monitor.y + monitor.height - MARGIN_BOTTOM;

        for (let i = this._activeNotifications.length - 1; i >= 0; i--) {
            const bannerData = this._activeNotifications[i];
            const banner = bannerData.banner;

            if (!banner || !banner.get_parent()) continue;

            const [minW, natW] = banner.get_preferred_width(-1);
            const [minH, natH] = banner.get_preferred_height(natW);

            banner.width = natW;
            banner.height = natH;

            const x = monitor.x + monitor.width - natW - MARGIN_RIGHT;
            const y = currentBottomY - natH;

            banner.ease({
                x: x,
                y: y,
                duration: ANIMATION_DURATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            currentBottomY = y - SPACING_BETWEEN;
        }
    }

    _dismiss(bannerData) {
        if (!bannerData || bannerData.dismissing) return;

        bannerData.dismissing = true;
        const banner = bannerData.banner;

        banner.ease({
            opacity: 0,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                const index = this._activeNotifications.indexOf(bannerData);
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
        this._activeNotifications.forEach(b => b.banner.destroy());
        this._activeNotifications = [];
    }
}
