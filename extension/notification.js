import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class NotificationDisplay {
    constructor(settings) {
        this._settings = settings;
        this._activeNotifications = [];
        this._recentKeys = new Set();
    }

    show(source, notification) {
        try {
            if (!notification) {
                console.log('[Oldstyle Notifications] show called with null notification');
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
                console.log(`[Oldstyle Notifications] Error accessing notification properties: ${e.message}`);
                if (e.message.indexOf('disposed') !== -1) return;
            }

            let duration = 5;
            try {
                duration = this._getDuration(appName, notification);
            } catch (e) {
                log(`[Oldstyle Notifications] Error calling _getDuration: ${e.message}`);
            }

            if (duration === null)
                return;

            let startGIcon = null;
            let iconName = null;
            try {
                startGIcon = notification.gicon || null;
                iconName = notification.iconName || null;
            } catch (e) { }

            log(`[Oldstyle Notifications] Preparing banner for ${appName}: ${nTitle}`);

            const key = `${appName}:${summary}:${body}`;
            if (this._recentKeys.has(key)) return;

            this._recentKeys.add(key);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._recentKeys.delete(key);
                return GLib.SOURCE_REMOVE;
            });

            // Main Container (Card) - Vertical Layout for Win11 style
            const banner = new St.BoxLayout({
                style_class: 'custom-notification',
                vertical: true,
                reactive: true,
                track_hover: true,
            });
            banner.spacing = 8; // Tighter vertical spacing

            // --- 1. Header Row: [App Icon] [App Name] ... [Menu] [Close] ---
            const headerBox = new St.BoxLayout({
                style_class: 'custom-notification-header-box',
                vertical: false,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.spacing = 8;

            // App Icon (Small)
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
            closeBtn.connect('clicked', () => this._dismiss(banner));
            headerBox.add_child(closeBtn);

            banner.add_child(headerBox);

            // --- 2. Content Row: [Large Icon] [Text Column] ---
            const contentBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                y_expand: true,
            });
            contentBox.spacing = 0;

            // Large Icon (Profile/Image)
            let finalGIcon = startGIcon;
            // If no direct GIcon, try to resolve from iconName
            if (!finalGIcon && iconName) {
                try {
                    if (iconName.startsWith('/')) {
                        finalGIcon = Gio.File.new_for_path(iconName).get_icon();
                    } else if (iconName.startsWith('file://')) {
                        finalGIcon = Gio.File.new_for_uri(iconName).get_icon();
                    }
                } catch (e) { }
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

            // Text Column
            const textBox = new St.BoxLayout({
                style_class: 'custom-notification-text-box',
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.START,
            });
            textBox.spacing = 2;

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

            // Support Markdown/HTML
            try {
                bodyLabel.clutter_text.set_markup(this._parseMarkup(body));
            } catch (e) {
                // Fallback if markup is invalid
                bodyLabel.text = body;
            }

            textBox.add_child(bodyLabel);
            contentBox.add_child(textBox);

            banner.add_child(contentBox);

            // --- 3. Actions Row ---
            // Notifications can have actions. 'default' is usually the body click.
            // We want to list OTHER actions as buttons.
            let actions = [];
            try {
                if (Array.isArray(notification.actions) && notification.actions.length > 0) {
                    log(`[Oldstyle Notifications] Actions array found. Length: ${notification.actions.length}`);
                    if (notification.actions.length > 0) {
                        const first = notification.actions[0];
                        log(`[Oldstyle Notifications] First action type: ${typeof first}`);
                        if (typeof first === 'object') {
                            log(`[Oldstyle Notifications] First action keys: ${Object.keys(first).join(', ')}`);
                            // Proto chain?
                            let p = Object.getPrototypeOf(first);
                            if (p) log(`[Oldstyle Notifications] First action proto keys: ${Object.getOwnPropertyNames(p).join(', ')}`);
                        }
                    }

                    if (typeof notification.actions[0] === 'string') {
                        // Handle flat array of [id, label, id, label]
                        log(`[Oldstyle Notifications] Actions detected as flat string array`);
                        for (let i = 0; i < notification.actions.length; i += 2) {
                            actions.push({
                                id: notification.actions[i],
                                label: notification.actions[i + 1] || notification.actions[i]
                            });
                        }
                    } else {
                        // Handle array of objects {id, label}
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
                log(`[Oldstyle Notifications] Error retrieving actions: ${e.message}`);
            }

            log(`[Oldstyle Notifications] Actions found: ${JSON.stringify(actions)}`);

            // Filter out default action if it coincides with body click
            const otherActions = actions.filter(a => a.id !== 'default');

            if (otherActions.length > 0) {
                const actionsBox = new St.BoxLayout({
                    style_class: 'custom-notification-actions-box',
                    vertical: false,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.START,
                });
                actionsBox.spacing = 12;

                otherActions.forEach(action => {
                    const actionId = action.id;
                    const label = action.label || actionId;

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
                        log(`[Oldstyle Notifications] Action button clicked. Label: ${label}`);
                        try {
                            // Priority 1: Call activate() on the action object itself (native wrapper)
                            if (typeof action.activate === 'function') {
                                log(`[Oldstyle Notifications] Calling action.activate() on action object`);
                                action.activate();
                            }
                            // Priority 2: Call _callback() (internal private method seen in logs)
                            else if (typeof action._callback === 'function') {
                                log(`[Oldstyle Notifications] Calling action._callback()`);
                                action._callback();
                            }
                            // Priority 3: Fallback to notification methods if we found an ID
                            else if (actionId) {
                                if (typeof notification.activate === 'function') {
                                    log(`[Oldstyle Notifications] Calling notification.activate("${actionId}")`);
                                    notification.activate(actionId);
                                } else if (typeof notification.invokeAction === 'function') {
                                    log(`[Oldstyle Notifications] Calling notification.invokeAction("${actionId}")`);
                                    notification.invokeAction(actionId);
                                } else {
                                    log(`[Oldstyle Notifications] Falling back to emit('action-invoked', "${actionId}")`);
                                    notification.emit('action-invoked', actionId);
                                }
                            } else {
                                log(`[Oldstyle Notifications] Unable to activate action: No activate method and no action ID found.`);
                            }
                        } catch (e) {
                            log(`[Oldstyle Notifications] Error activating action: ${e.message}`);
                        }
                        this._dismiss(banner);
                    });

                    actionsBox.add_child(button);
                });

                banner.add_child(actionsBox);
            }

            // Add to UI over everything else
            Main.layoutManager.addTopChrome(banner);
            this._activeNotifications.push(banner);

            const monitor = Main.layoutManager.primaryMonitor;
            const margin = 50;

            // Manually trigger layout to get height
            const [minH, natH] = banner.get_preferred_height(350);
            banner.height = natH;

            const x = monitor.x + monitor.width - 380;
            const y = monitor.y + monitor.height - margin - natH;

            console.log(`[Oldstyle Notifications] Banner position: x=${x}, y=${y}, height=${natH}`);
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
            console.log('[Oldstyle Notifications] Banner shown and animation started');

            // Interaction: Click to open/activate app
            banner.connect('button-release-event', () => {
                // If already dismissing (e.g. via Close button), do nothing
                if (this._activeNotifications.indexOf(banner) === -1 || banner._dismissing) {
                    return Clutter.EVENT_PROPAGATE;
                }

                // Try to activate the source app
                try {
                    // Always try to bring the window to front if possible
                    if (source) {
                        if (source.app && typeof source.app.activate === 'function') {
                            log(`[Oldstyle Notifications] Activating window for app: ${source.app.get_name()}`);
                            source.app.activate();
                        } else if (source.app && typeof source.app.open_new_window === 'function') {
                            // Some apps might need this if no window is open?
                            // But usually activate() handles it.
                            source.app.open_new_window(-1);
                        } else if (typeof source.open === 'function') {
                            // Fallback for non-app sources
                            source.open(notification);
                        }
                    }

                    // Also invoke the notification's default action
                    if (notification && typeof notification.activate === 'function') {
                        log(`[Oldstyle Notifications] Invoking default notification action`);
                        notification.activate();
                    }
                } catch (e) {
                    logError(e, 'NotificationInterceptor: Error activating app');
                }

                this._dismiss(banner);

                return Clutter.EVENT_STOP;
            });

            if (duration > 0) {
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, duration, () => {
                    if (banner && banner.get_parent() && !banner._dismissing)
                        this._dismiss(banner);
                    return GLib.SOURCE_REMOVE;
                });
            }
        } catch (e) {
            console.log(`[Oldstyle Notifications] Critical error in show(): ${e.message}`);
            console.log(e.stack);
        }
    }

    _getDuration(appName, notification) {
        let duration = 5; // Default fallback

        if (!this._settings)
            return duration;

        // Urgency Mapping: 0=Low, 1=Normal, 2=Critical
        let urgency = 1;
        try {
            urgency = notification.urgency || 1;
        } catch (e) { }

        // Get Global Defaults
        if (urgency === 0)
            duration = this._settings.get_int('duration-low');
        else if (urgency === 2)
            duration = this._settings.get_int('duration-critical');
        else
            duration = this._settings.get_int('duration-normal');

        // Apply Per-App Overrides
        const configs = this._settings.get_value('app-configs').recursiveUnpack();
        if (configs[appName]) {
            const [enabled, configuredDuration] = configs[appName];
            if (!enabled) {
                log(`[Oldstyle Notifications] Notification from ${appName} suppressed by user setting.`);
                return null;
            }
            duration = configuredDuration;
        }

        return duration;
    }

    _parseMarkup(text) {
        if (!text) return '';

        // Basic Markdown Replacements
        // Bold: **text** -> <b>text</b>
        let parsed = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        // Italic: *text* (careful with single asterisks in text) -> <i>text</i>
        // Using a slightly strict regex to avoid matching math or lists roughly
        parsed = parsed.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

        // Code: `text` -> <tt>text</tt>
        parsed = parsed.replace(/`([^`]+)`/g, '<tt>$1</tt>');

        // Links: [label](url) -> <a href="$2">$1</a>
        parsed = parsed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

        // Newlines to <br> if not already handled by Pango's line wrap? 
        // Pango handles \n fine.

        return parsed;
    }


    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        const margin = 50;
        const spacing = 15;

        // Start from the bottom of the screen
        let currentBottomY = monitor.y + monitor.height - margin;

        // Iterate backwards (newest is last in array, should be at bottom)
        for (let i = this._activeNotifications.length - 1; i >= 0; i--) {
            const banner = this._activeNotifications[i];
            if (!banner || !banner.get_parent()) continue;

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
