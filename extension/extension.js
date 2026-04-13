import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { NotificationDisplay } from './notification.js';

export default class OldstyleNotificationsExtension extends Extension {
    enable() {
        this._display = new NotificationDisplay(this.getSettings());

        this._patched = false;

        console.log('[Oldstyle Notifications] Native drawing extension enabled (Patching MessageTray)');

        // Patch MessageTray.prototype._showNotification
        // We look for the prototype on the instance constructor to be safe
        const TrayClass = Main.messageTray.constructor;

        if (TrayClass && TrayClass.prototype._showNotification) {
            this._origShowNotification = TrayClass.prototype._showNotification;
            this._TrayPrototype = TrayClass.prototype;

            const self = this;

            TrayClass.prototype._showNotification = function (notificationArg) {
                let notification = notificationArg;
                if (!notification && this._notificationQueue && this._notificationQueue.length > 0) {
                    notification = this._notificationQueue[0];
                }

                if (notification) {
                    let nTitle = '[No Title]';
                    try {
                        nTitle = notification.title;
                    } catch (e) {
                        console.debug(`[Oldstyle Notifications] Notification has no title: ${e.message}`);
                    }

                    console.log(`[Oldstyle Notifications] Trapped native notification: ${nTitle}`);

                    // Show our CUSTOM banner
                    // Ensure we pass source (notification.source is standard)
                    if (self._display) {
                        try {
                            self._display.show(notification.source, notification);
                        } catch (e) {
                            console.warn(`[Oldstyle Notifications] Error calling display.show: ${e.message}`);
                        }
                    }

                    // CRITICAL: Remove from queue to prevent stacking blockage
                    // Since we suppress the native show, the MessageTray never shifts this notification
                    // out of the queue, causing subsequent checks to pick the same one if not cleaned up.
                    if (this._notificationQueue) {
                        const index = this._notificationQueue.indexOf(notification);
                        if (index > -1) {
                            this._notificationQueue.splice(index, 1);
                            console.log(`[Oldstyle Notifications] Removed notification '${nTitle}' from queue to unblock next items.`);
                        }
                    }

                    // SUPPRESS NATIVE BANNER
                    return;
                }

                // Fallback: if no notification found (weird), call original just in case?
                self._origShowNotification.apply(this, arguments);
            };

            this._patched = true;
        } else {
            console.error('[Oldstyle Notifications] Could not find MessageTray prototype to patch');
        }
    }

    disable() {
        // Restore patch
        if (this._patched && this._TrayPrototype && this._origShowNotification) {
            this._TrayPrototype._showNotification = this._origShowNotification;
            this._patched = false;
        }

        if (this._display) {
            this._display.destroy();
            this._display = null;
        }
    }
}
